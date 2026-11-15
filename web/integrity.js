// Signed data manifest: BLAKE3 hash of every shipped data file, signed with Ed25519.
// Design of record: docs/integrity-assertions.md (flat signed hash list, no Merkle tree).
//
// What it checks: the data files the page loads are byte-identical to the files the team signed
// offline. What it does NOT check: the app code itself (assumed trusted, served by the same
// origin), NASA's live Trek tiles, or anything about the real surface of Mars. It is a file-
// integrity check, not a proof. Routes computed live in the browser are not signed.
//
// Same module in the browser and in Node (tests, scripts/sign-manifest.mjs):
//   BLAKE3  — @noble/hashes 1.8.0, vendored in ./vendor/noble-hashes (no custom hash code)
//   Ed25519 — WebCrypto (crypto.subtle), standard in Node 22 and current browsers
import { blake3 } from "./vendor/noble-hashes/blake3.js";

export const MANIFEST_SCHEMA = "happyfeet.manifest/1";
// Only these paths may appear in a manifest, and nothing is ever fetched from anywhere else.
export const PATH_ALLOW = /^public\/data\/[A-Za-z0-9_\-]+(\/[A-Za-z0-9_\-]+)*\.(json|geojson)$/;

const te = new TextEncoder();
export const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
export const b64 = (u8) => (typeof btoa === "function" ? btoa(String.fromCharCode(...u8)) : Buffer.from(u8).toString("base64"));
export const unb64 = (s) => Uint8Array.from(typeof atob === "function" ? atob(s) : Buffer.from(s, "base64").toString("binary"), (c) => c.charCodeAt(0));
export const blake3Hex = (bytes) => hex(blake3(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)));
export const keyId = (rawPub) => blake3Hex(rawPub).slice(0, 16);

// Deterministic manifest text: fixed key order, files sorted by path, one file per line.
// The signature covers exactly these bytes (UTF-8), never a re-serialisation.
export function canonicalManifest({ created, key_id, files }) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const lines = sorted.map((f) => `  {"path":${JSON.stringify(f.path)},"size":${f.size},"blake3":"${f.blake3}"}`);
  return `{"schema":"${MANIFEST_SCHEMA}","created":${JSON.stringify(created)},"key_id":"${key_id}","files":[\n${lines.join(",\n")}\n]}\n`;
}

export function parseManifest(text) {
  let m;
  try { m = JSON.parse(text); } catch { throw new IntegrityError("malformed", "manifest.json is not valid JSON"); }
  if (!m || m.schema !== MANIFEST_SCHEMA || !Array.isArray(m.files) || typeof m.key_id !== "string")
    throw new IntegrityError("malformed", "manifest.json does not follow happyfeet.manifest/1");
  const seen = new Set();
  for (const f of m.files) {
    if (typeof f?.path !== "string" || !PATH_ALLOW.test(f.path) || f.path.includes(".."))
      throw new IntegrityError("path", `manifest lists a path outside the allowlist: ${String(f?.path)}`);
    if (seen.has(f.path)) throw new IntegrityError("malformed", `duplicate path ${f.path}`);
    seen.add(f.path);
    if (!Number.isInteger(f.size) || f.size < 0 || !/^[0-9a-f]{64}$/.test(f.blake3))
      throw new IntegrityError("malformed", `bad size/hash for ${f.path}`);
  }
  if (canonicalManifest(m) !== text) throw new IntegrityError("malformed", "manifest.json is not in canonical form");
  return m;
}

export class IntegrityError extends Error {
  constructor(code, message, path = null) { super(message); this.code = code; this.path = path; }
}

const subtle = globalThis.crypto?.subtle;
export async function importPublicKey(rawB64) {
  if (!subtle) throw new IntegrityError("unsupported", "WebCrypto is not available");
  try { return await subtle.importKey("raw", unb64(rawB64), { name: "Ed25519" }, false, ["verify"]); }
  catch (e) { throw new IntegrityError("unsupported", `this browser cannot verify Ed25519 (${e.message})`); }
}

// Verify the manifest signature and return the parsed manifest.
export async function verifyManifest(manifestText, signatureB64, publicKeyB64) {
  const key = await importPublicKey(publicKeyB64);
  let sig;
  try { sig = unb64(signatureB64.trim()); } catch { throw new IntegrityError("signature", "manifest.sig is not base64"); }
  const ok = sig.length === 64 && await subtle.verify({ name: "Ed25519" }, key, sig, te.encode(manifestText));
  if (!ok) throw new IntegrityError("signature", "manifest signature invalid (manifest modified, or signed with a different key)");
  const m = parseManifest(manifestText);
  if (m.key_id !== keyId(unb64(publicKeyB64))) throw new IntegrityError("signature", "manifest key_id is not the pinned key");
  return m;
}

// Check one file's bytes against its manifest entry. Throws IntegrityError naming the file.
export function checkFile(manifest, path, bytes) {
  const entry = manifest.files.find((f) => f.path === path);
  if (!entry) throw new IntegrityError("unlisted", `${path} is not in the signed manifest`, path);
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length !== entry.size || blake3Hex(u8) !== entry.blake3)
    throw new IntegrityError("mismatch", `${path} does not match the signed manifest`, path);
  return entry;
}

// Verify everything: signature, then every listed file. readFile(path) -> Uint8Array | null.
// Returns { ok, files: [{path, status}], manifest, error }.
export async function verifyAll({ manifestText, signatureB64, publicKeyB64, readFile, override = {} }) {
  const report = { ok: false, files: [], manifest: null, error: null };
  try {
    report.manifest = await verifyManifest(manifestText, signatureB64, publicKeyB64);
  } catch (e) { report.error = e; return report; }
  for (const f of report.manifest.files) {
    let bytes = override[f.path];
    if (!bytes) { try { bytes = await readFile(f.path); } catch { bytes = null; } }
    if (!bytes) { report.files.push({ path: f.path, status: "missing" }); continue; }
    try { checkFile(report.manifest, f.path, bytes); report.files.push({ path: f.path, status: "ok" }); }
    catch (e) { report.files.push({ path: f.path, status: e.code }); }
  }
  const bad = report.files.find((f) => f.status !== "ok");
  if (bad) report.error = new IntegrityError(bad.status, `${bad.path}: ${bad.status === "missing" ? "missing" : "does not match the signed manifest"}`, bad.path);
  report.ok = !bad;
  return report;
}

// Flip one bit of one byte in a copy (tamper demo). Never touches the original buffer.
export function tamperedCopy(bytes, at = null) {
  const copy = new Uint8Array(bytes);
  const i = at ?? Math.floor(copy.length / 2);
  copy[i] ^= 0x01;
  return copy;
}
