// Verify-on-load chip + tamper demo for the signed data manifest (see integrity.js).
import { verifyAll, checkFile, tamperedCopy, IntegrityError } from "./integrity.js";
import { MANIFEST_PUBLIC_KEY, MANIFEST_KEY_ID } from "./integrity-pubkey.js";

const CSS = `
.intChip{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:12px;margin:6px 0;padding:4px 8px;border-radius:6px;border:1px solid #475569;background:rgba(15,23,42,.6)}
.intChip b{font-weight:700}.intChip.ok{border-color:#2f8f5b}.intChip.ok b{color:#6ee7a8}
.intChip.bad{border-color:#dc2626;background:rgba(69,10,10,.6)}.intChip.bad b{color:#fca5a5}
.intChip.wait b{color:#cbd5e1}.intChip button{font-size:11px;margin-left:auto}
.intChip small{flex-basis:100%;color:#94a3b8;font-size:10.5px}`;

const state = { status: "unchecked", report: null, bytes: new Map(), tampered: null, manifest: null };
let chipEl = null, listeners = [];
const fetchBytes = async (p) => { const r = await fetch(`./${p}`, { cache: "no-cache" }); if (!r.ok) return null; return new Uint8Array(await r.arrayBuffer()); };

function render() {
  if (!chipEl) return;
  const r = state.report, files = r?.files ?? [];
  const okCount = files.filter((f) => f.status === "ok").length;
  let cls = "wait", text = "Data integrity: checking…";
  if (state.status === "ok") { cls = "ok"; text = `<b>✓ Data verified</b> ${okCount}/${files.length} files match the signed manifest (key ${MANIFEST_KEY_ID.slice(0, 8)})`; }
  else if (state.status === "bad") { cls = "bad"; text = `<b>✗ Integrity mismatch</b> ${r.error?.message ?? "unknown"}${state.tampered ? " — tamper test (one bit flipped in memory)" : ""}`; }
  else if (state.status === "unsupported") { text = `<b>Not checked</b> ${r?.error?.message ?? ""}`; }
  chipEl.className = `intChip ${cls}`;
  chipEl.innerHTML = `<span>${text}</span>
    <button type="button" data-act="${state.tampered ? "reset" : "tamper"}" title="${state.tampered ? "Re-verify the real files" : "Flip one bit of route.json in memory and re-verify: the demo route must be refused"}">${state.tampered ? "Reset" : "Tamper test"}</button>
    <small>Detects modified or corrupted data files relative to an offline-signed manifest (BLAKE3 + Ed25519). Assumes the app code is trusted; does not protect against a compromised server or verify NASA's live tiles. Live routes computed here are a live check, not signed.</small>`;
}

export async function verifyNow(override = {}) {
  state.status = "checking"; render();
  try {
    const [m, s] = await Promise.all([fetch("./public/integrity/manifest.json", { cache: "no-cache" }), fetch("./public/integrity/manifest.sig", { cache: "no-cache" })]);
    if (!m.ok || !s.ok) throw new IntegrityError("missing", "manifest.json / manifest.sig not found");
    const report = await verifyAll({
      manifestText: await m.text(), signatureB64: await s.text(), publicKeyB64: MANIFEST_PUBLIC_KEY, override,
      readFile: async (p) => { if (!state.bytes.has(p)) state.bytes.set(p, await fetchBytes(p)); return state.bytes.get(p); },
    });
    state.report = report; state.manifest = report.manifest;
    state.status = report.ok ? "ok" : report.error?.code === "unsupported" ? "unsupported" : "bad";
  } catch (e) {
    state.report = { files: [], error: e }; state.status = e.code === "unsupported" ? "unsupported" : "bad";
  }
  render();
  for (const fn of listeners) fn(state);
  return state;
}

export function mountIntegrity(el, { onChange } = {}) {
  if (!document.getElementById("intChipCss")) { const st = document.createElement("style"); st.id = "intChipCss"; st.textContent = CSS; document.head.append(st); }
  chipEl = el;
  if (onChange) listeners.push(onChange);
  el.addEventListener("click", async (ev) => {
    const act = ev.target?.dataset?.act;
    if (act === "tamper") {
      const p = "public/data/route.json";
      const bytes = state.bytes.get(p) ?? await fetchBytes(p);
      state.tampered = { [p]: tamperedCopy(bytes) };
      await verifyNow(state.tampered);
    } else if (act === "reset") { state.tampered = null; await verifyNow(); }
  });
  render();
  return verifyNow();
}

// Bytes of a signed data file, checked against the verified manifest (the tampered copy while the
// tamper test is on). Throws IntegrityError naming the file when it does not match.
export async function signedBytes(path) {
  if (state.status === "checking" || !state.report) await verifyNow(state.tampered ?? {});
  const bytes = state.tampered?.[path] ?? state.bytes.get(path) ?? await fetchBytes(path);
  if (!state.manifest) throw state.report?.error ?? new IntegrityError("unchecked", "manifest not verified");
  checkFile(state.manifest, path, bytes);
  return bytes;
}
export const integrityState = () => state;
