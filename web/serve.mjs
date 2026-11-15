// Minimal local web server for the Mars viewer (no dependencies).
//   - serves this folder at http://localhost:8080
//   - forwards /trek/* to NASA Trek's tile server, so the browser only ever talks
//     to localhost and cross-origin (CORS) rules can't block the Mars imagery.
// Usage: node serve.mjs [--no-open]      (PORT=9000 node serve.mjs to change the port)
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat, mkdir, readFile, writeFile, rename, open, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { createGzip } from "node:zlib";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT) || 8080;
// 127.0.0.1 by default (only this machine). A hosted deploy sets HOST=0.0.0.0 (see Dockerfile).
const host = process.env.HOST || "127.0.0.1";
const TREK_TILES = "https://trek.nasa.gov/tiles";
const JEZERO_VTOUR_HOST = "https://maps.planet.fu-berlin.de/vtour";
// Mastcam-Z full panoramas live on an ASU host that does not send CORS headers, so the
// Quest/browser cannot use them as WebGL textures directly. Proxy the untouched JPEGs
// through this origin (and cache them) instead of re-encoding them.
const PANO_HOST = "mastcamz.asu.edu";
const PANO_CACHE = path.join(root, ".pano-cache");
// Trek is slow (2-10 s per tile), so every tile we fetch is kept on disk and served
// instantly next time. Delete the folder to clear it.
const CACHE_DIR = path.join(root, ".tile-cache");

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function send(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

const tileType = (p) =>
  p.endsWith(".png") ? "image/png" : p.endsWith(".jpg") ? "image/jpeg"
  : p.endsWith(".xml") ? "application/xml" : "application/octet-stream";
const inflight = new Map(); // same tile requested twice at once -> one upstream fetch

// Returns { status, body, type }. 200s are cached on disk; 404s are not (cheap to repeat).
async function getTile(rest) {
  const file = path.join(CACHE_DIR, rest);
  try {
    return { status: 200, body: await readFile(file), type: tileType(rest), cached: true };
  } catch {}
  if (inflight.has(rest)) return inflight.get(rest);
  const job = (async () => {
    // Trek sometimes drops connections; retry twice before giving up (502 to the browser).
    let upstream;
    for (let attempt = 1; ; attempt++) {
      try {
        upstream = await fetch(TREK_TILES + rest, { signal: AbortSignal.timeout(30_000) });
        if (upstream.status < 500 || attempt === 3) break;
      } catch (err) {
        if (attempt === 3) throw err;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
    const body = Buffer.from(await upstream.arrayBuffer());
    const type = upstream.headers.get("content-type") ?? tileType(rest);
    // images, plus the per-layer WMTSCapabilities.xml (Trek answers missing ones with HTML)
    const keep = type.startsWith("image/") || (rest.endsWith(".xml") && type.includes("xml"));
    if (upstream.status === 200 && keep) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body).catch(() => {});
    }
    return { status: upstream.status, body, type };
  })().finally(() => inflight.delete(rest));
  inflight.set(rest, job);
  return job;
}

async function proxyTrek(url, res) {
  // /trek/Mars/EQ/<layer>/1.0.0/default/default028mm/<z>/<row>/<col>.jpg
  const rest = url.pathname.slice("/trek".length);
  if (!/^\/[A-Za-z0-9_\-./]+$/.test(rest) || rest.includes("..")) {
    return send(res, 400, "Bad tile path");
  }
  try {
    const t = await getTile(rest);
    res.writeHead(t.status, { "Content-Type": t.type, "Cache-Control": t.status === 200 ? "public, max-age=2592000, immutable" : "no-store" });
    res.end(t.body);
  } catch (err) {
    send(res, 502, `Could not reach NASA Trek: ${err.message}`);
  }
}

async function proxyPano(url, res) {
  const raw = url.searchParams.get("u");
  let target;
  try {
    target = new URL(raw);
  } catch {
    return send(res, 400, "Bad panorama URL");
  }
  if (target.protocol !== "https:" || target.hostname !== PANO_HOST) {
    return send(res, 403, "Panorama host not allowed");
  }
  const key = createHash("sha1").update(target.href).digest("hex");
  const file = path.join(PANO_CACHE, key + ".jpg");
  const headers = {
    "Content-Type": "image/jpeg",
    "Cache-Control": "public, max-age=2592000, immutable",
    "Access-Control-Allow-Origin": "*",
  };
  try {
    const info = await stat(file);
    if (info.isFile()) {
      res.writeHead(200, { ...headers, "Content-Length": info.size });
      return createReadStream(file).pipe(res);
    }
  } catch {}

  const upstream = await fetch(target.href, {
    headers: { "User-Agent": "happyfeet-mars-trip/1.0" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!upstream.ok) return send(res, upstream.status, `Panorama HTTP ${upstream.status}`);
  const body = Buffer.from(await upstream.arrayBuffer());
  await mkdir(PANO_CACHE, { recursive: true });
  await writeFile(file, body);
  res.writeHead(200, {
    ...headers,
    "Content-Type": upstream.headers.get("content-type") ?? headers["Content-Type"],
    "Content-Length": body.length,
  });
  res.end(body);
}

// Fetch the low-zoom global tiles in the background so the whole planet appears at once
// (levels 0-3 of Viking = 170 tiles, ~8 MB). Runs once; later starts hit the disk cache.
async function warmCache() {
  const base = "/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm";
  const todo = [];
  for (let z = 0; z <= 3; z++)
    for (let y = 0; y < 2 ** z; y++)
      for (let x = 0; x < 2 ** (z + 1); x++) todo.push(`${base}/${z}/${y}/${x}.jpg`);
  let fetched = 0;
  const worker = async () => {
    while (todo.length) {
      const t = await getTile(todo.shift()).catch(() => null);
      if (t && !t.cached) fetched++;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (fetched) console.log(`Cached ${fetched} global Viking tiles in .tile-cache/`);
}

// ---------------------------------------------------------------- layer catalog
// Every Mars product Trek offers in the equirectangular projection, from Trek's own search
// index. Fetched once a week into .tile-cache/catalog.json and trimmed for the page.
const CATALOG_URL =
  "https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?start=0&rows=5000" +
  "&proj=urn:ogc:def:crs:EPSG::104905";
const CATALOG_FILE = path.join(CACHE_DIR, "catalog.json");
const CATALOG_MAX_AGE = 7 * 24 * 3600 * 1000;
let catalogJob = null;

// Whole-planet layer: all longitudes and at least ±60° latitude (THEMIS stops at ±65°).
// Some index entries carry nonsense extents (east edge past 180°); those are not global.
const isGlobal = ([w, s, e, n]) =>
  w >= -180.5 && e <= 180.5 && e - w >= 350 && s <= -60 && n >= 60;

function trimCatalog(raw) {
  const out = [];
  for (const d of raw.response?.docs ?? []) {
    if (d.itemType !== "product" || !d.productLabel) continue;
    const types = d.serviceTypes ?? [];
    // Feature layers are vector data (points/outlines) without image tiles
    if (types.some((t) => /^Feature/.test(t))) continue;
    const bbox = String(d.bbox ?? "-180,-90,180,90").split(",").map(Number);
    if (bbox.length !== 4 || bbox.some((v) => !Number.isFinite(v))) continue;
    out.push({
      id: d.productLabel,
      title: d.title ?? d.productLabel,
      cat: d.productCat1 ?? "Other",
      sub: d.productCat2 ?? "",
      mission: d.mission ?? "",
      instrument: d.instrument ?? "",
      bbox,
      // the index's "coverage" field calls many regional mosaics Global; trust the extent
      global: isGlobal(bbox),
      desc: (d.description ?? "").slice(0, 400),
    });
  }
  return out.sort((a, b) => b.global - a.global || a.title.localeCompare(b.title));
}

async function getCatalog() {
  try {
    const info = await stat(CATALOG_FILE);
    if (Date.now() - info.mtimeMs < CATALOG_MAX_AGE) return trimCatalog(JSON.parse(await readFile(CATALOG_FILE, "utf8")));
  } catch {}
  catalogJob ??= (async () => {
    try {
      const r = await fetch(CATALOG_URL, {
        headers: { "User-Agent": "Mozilla/5.0 (mars-viewer)" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      const list = trimCatalog(JSON.parse(text));
      await mkdir(CACHE_DIR, { recursive: true });
      await writeFile(CATALOG_FILE, text).catch(() => {});
      return list;
    } catch (err) { // offline: an old copy is better than nothing
      try { return trimCatalog(JSON.parse(await readFile(CATALOG_FILE, "utf8"))); } catch { throw err; }
    } finally {
      catalogJob = null;
    }
  })();
  return catalogJob;
}

// ---------------------------------------------------------------- terrain (MOLA heights)
// Source: MGS MOLA MEGDR topography from NASA PDS Geosciences, at five resolutions.
// Each file is raw big-endian int16, metres above the Mars areoid, line 0 at the file's
// north edge, sample 0 at its west edge, pixel centres at +0.5. Lines are stored one after
// another, so any band of latitudes is one contiguous byte range: we fetch only the chunks a
// tile needs (HTTP Range), keep them in a sparse file under web/data/, and resume after a
// restart. Only fetched chunks are held in memory.
//   4 px/deg  (2 MB)        : fetched whole at startup, serves the global view (levels 0-3)
//  16 px/deg (33 MB)        : on demand for levels 4-5
//  32 px/deg (133 MB)       : on demand for level 6 (~1.85 km/px)
//  64 px/deg (4 x 133 MB)   : on demand for level 7 (~925 m/px), four 90 x 180 degree files
// 128 px/deg (16 x 130 MB)  : on demand for level 8 (~463 m/px), sixteen 44 x 90 degree
//                             files covering 88N-88S (the poles fall back to 64 px/deg)
// Finer still, for levels 9+: the USGS HRSC + MOLA blended DEM, ~200 m/px (BlendDem below).
// While a tile's chunks are missing the server answers 202 and the page keeps showing the
// coarser parent tile until it asks again.
const MEGDR = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x";
const DATA_DIR = path.join(root, "data");
const TILE_N = 65; // heights per tile edge (64 cells), Cesium's usual heightmap size

// The archive gives ~100 KB/s per connection: at most 6 at once, newest request first,
// so the place on screen now wins over places flown past.
const net = { active: 0, max: 6, stack: [] };
function netRun(fn) {
  return new Promise((resolve, reject) => {
    net.stack.push({ fn, resolve, reject });
    pumpNet();
  });
}
function pumpNet() {
  while (net.active < net.max && net.stack.length) {
    const job = net.stack.pop();
    net.active++;
    job.fn().then(job.resolve, job.reject).finally(() => { net.active--; pumpNet(); });
  }
}

// One MEGDR file covering a lat/lon box: north edge, west edge (0-360 E) and spans in degrees.
class LazyDem {
  constructor({ dir, file, ppd, chunk, north = 90, west = 0, latSpan = 180, lonSpan = 360 }) {
    this.url = `${MEGDR}/${dir}/${file}`;
    this.file = path.join(DATA_DIR, file);
    this.part = this.file + ".part";
    this.doneFile = this.part + ".json"; // indices of chunks already in .part
    this.ppd = ppd;
    this.north = north;
    this.south = north - latSpan;
    this.west = west;
    this.lonSpan = lonSpan;
    this.global = lonSpan === 360;
    this.w = lonSpan * ppd;
    this.h = latSpan * ppd;
    this.bytes = this.w * this.h * 2;
    this.chunk = chunk; // even, so a chunk never splits a sample
    this.chunkSamples = chunk / 2;
    this.nChunks = Math.ceil(this.bytes / chunk);
    this.chunks = new Map(); // chunk index -> Int16Array, only for chunks fetched so far
    this.done = new Set();
    this.pending = new Map(); // chunk index -> promise
    this.saving = Promise.resolve();
    this.fh = null;
  }

  get complete() { return this.done.size === this.nChunks; }
  get progress() { return this.done.size / this.nChunks; }

  // `buf` starts on a chunk boundary and holds one or more whole chunks (the last may be short).
  decode(buf, byteOffset) {
    for (let off = 0; off < buf.length; off += this.chunk) {
      const part = buf.subarray(off, Math.min(buf.length, off + this.chunk));
      const arr = new Int16Array(part.length / 2);
      for (let i = 0; i < arr.length; i++) arr[i] = part.readInt16BE(2 * i);
      this.chunks.set((byteOffset + off) / this.chunk, arr);
    }
  }

  sample(row, col) {
    const idx = row * this.w + col;
    const ci = Math.floor(idx / this.chunkSamples);
    const arr = this.chunks.get(ci);
    return arr ? arr[idx - ci * this.chunkSamples] : 0;
  }

  containsLon(lon) { // lon in degrees east, any range
    if (this.global) return true;
    const x = (((lon - this.west) % 360) + 360) % 360;
    return x < this.lonSpan;
  }

  async init() {
    await mkdir(DATA_DIR, { recursive: true });
    try { // already fully downloaded
      const raw = await readFile(this.file);
      if (raw.length === this.bytes) {
        this.decode(raw, 0);
        for (let i = 0; i < this.nChunks; i++) this.done.add(i);
        if (!this.dropEmptyChunks()) return;
        // damaged: turn it back into a partial download so the empty chunks are fetched again
        await rename(this.file, this.part);
        await writeFile(this.doneFile, JSON.stringify([...this.done]));
        this.fh = await open(this.part, "r+");
        return;
      }
    } catch {}
    try { this.done = new Set(JSON.parse(await readFile(this.doneFile, "utf8"))); } catch {}
    if (this.done.size) {
      try {
        const raw = await readFile(this.part);
        for (const i of this.done) {
          const start = i * this.chunk, end = Math.min(this.bytes, start + this.chunk);
          if (raw.length < end) { this.done.delete(i); continue; }
          this.decode(raw.subarray(start, end), start);
        }
        if (this.dropEmptyChunks()) await writeFile(this.doneFile, JSON.stringify([...this.done]));
      } catch {
        this.done.clear();
        this.chunks.clear();
      }
    }
    // Never open with "w": that empties the file, and a second server sharing web/data (another
    // port) would wipe chunks the first one already recorded as done.
    if (!this.fh) {
      await (await open(this.part, "a")).close(); // create if missing, keep contents
      this.fh = await open(this.part, "r+");
    }
    if (this.done.size) console.log(`MOLA ${this.ppd} px/deg: ${Math.round(this.progress * 100)}% cached`);
  }

  // A chunk that is all zeros was never really written (heights are never exactly 0 m across
  // ~20 lines of a planet): forget it so it is downloaded again. Returns how many were dropped.
  dropEmptyChunks() {
    let dropped = 0;
    for (const i of [...this.done]) {
      const arr = this.chunks.get(i);
      if (arr && arr.every((v) => v === 0)) {
        this.done.delete(i);
        this.chunks.delete(i);
        dropped++;
      }
    }
    if (dropped) console.warn(`MOLA ${this.ppd} px/deg ${path.basename(this.file)}: ${dropped} empty chunk(s) will be fetched again`);
    return dropped;
  }

  // Chunk indices covering DEM lines r0..r1 that are not on disk yet.
  missing(r0, r1) {
    const c0 = Math.floor((r0 * this.w * 2) / this.chunk);
    const c1 = Math.floor(((r1 + 1) * this.w * 2 - 1) / this.chunk);
    const out = [];
    for (let i = c0; i <= c1; i++) if (!this.done.has(i)) out.push(i);
    return out;
  }

  ensureChunk(i) {
    if (this.done.has(i)) return Promise.resolve();
    if (this.pending.has(i)) return this.pending.get(i);
    const p = netRun(() => this.fetchChunk(i))
      .then(() => {
        this.done.add(i);
        this.saving = this.saving.then(() => this.save()).catch(() => {});
      })
      .finally(() => this.pending.delete(i));
    this.pending.set(i, p);
    return p;
  }

  async fetchChunk(i) {
    const start = i * this.chunk, end = Math.min(this.bytes, start + this.chunk) - 1;
    for (let attempt = 1; ; attempt++) {
      try {
        // the archive refuses requests without a browser-like User-Agent
        const r = await fetch(this.url, {
          headers: { "User-Agent": "Mozilla/5.0 (mars-viewer)", Range: `bytes=${start}-${end}` },
          signal: AbortSignal.timeout(120_000),
        });
        if (r.status !== 206) throw new Error(`HTTP ${r.status}`);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length !== end - start + 1) throw new Error(`short chunk ${buf.length}`);
        await this.fh.write(buf, 0, buf.length, start);
        this.decode(buf, start);
        return;
      } catch (err) {
        if (attempt >= 5) {
          console.warn(`MOLA ${this.ppd} px/deg chunk ${i} failed: ${err.message}`);
          throw err;
        }
        await new Promise((res) => setTimeout(res, 1000 * attempt));
      }
    }
  }

  async save() {
    if (!this.fh) return;
    if (!this.complete) return writeFile(this.doneFile, JSON.stringify([...this.done]));
    const fh = this.fh;
    this.fh = null;
    await fh.close();
    await rename(this.part, this.file);
    await rm(this.doneFile, { force: true });
    console.log(`MOLA ${this.ppd} px/deg fully cached.`);
  }

  // DEM line range touched by bilinear sampling between two latitudes.
  rows(north, south) {
    const clamp = (v) => Math.min(this.h - 1, Math.max(0, v));
    return [
      clamp(Math.floor((this.north - north) * this.ppd - 0.5)),
      clamp(Math.floor((this.north - south) * this.ppd - 0.5) + 1),
    ];
  }

  // Bilinear height (m) at a planetocentric lat/lon (lon -180..180 or 0..360). Outside a
  // regional file's box the nearest edge sample is used.
  height(lat, lon) {
    const { w, h, ppd } = this;
    let sx = ((((lon - this.west) % 360) + 360) % 360) * ppd - 0.5;
    if (!this.global) {
      if (sx > w - 0.5 + 180 * ppd) sx -= 360 * ppd; // just west of the box: clamp to its west edge
      sx = Math.min(w - 1, Math.max(0, sx));
    }
    const sy = Math.min(h - 1, Math.max(0, (this.north - lat) * ppd - 0.5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    const fx = sx - x0, fy = sy - y0;
    const xa = this.global ? (x0 + w) % w : x0;
    const xb = this.global ? (x0 + 1) % w : Math.min(w - 1, x0 + 1); // global files wrap at 0/360°
    const ya = y0, yb = Math.min(h - 1, y0 + 1);
    const h00 = this.sample(ya, xa), h10 = this.sample(ya, xb);
    const h01 = this.sample(yb, xa), h11 = this.sample(yb, xb);
    return (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
  }
}

// One resolution: a single global file or a grid of regional files.
class DemSet {
  constructor(ppd, files) {
    this.ppd = ppd;
    this.files = files;
    this.north = Math.max(...files.map((f) => f.north));
    this.south = Math.min(...files.map((f) => f.south));
  }
  async init() { for (const f of this.files) await f.init(); }
  get progress() { return this.files.reduce((s, f) => s + f.progress, 0) / this.files.length; }
  covers(north, south) { return north <= this.north && south >= this.south; }
  fileAt(lat, lon) {
    return this.files.find((f) => lat <= f.north && lat >= f.south && f.containsLon(lon)) ??
      this.files.find((f) => f.containsLon(lon)) ?? this.files[0];
  }
  // Chunks still to fetch for a lat/lon box ([file, chunk index] pairs).
  missing(north, south, west, east) {
    const out = [];
    for (const f of this.files) {
      if (f.south > north || f.north < south) continue;
      if (!f.global && !(f.containsLon(west) || f.containsLon(east) ||
        f.containsLon((west + east) / 2) || east - west >= 90)) continue;
      for (const i of f.missing(...f.rows(Math.min(north, f.north), Math.max(south, f.south)))) out.push([f, i]);
    }
    return out;
  }
  height(lat, lon) { return this.fileAt(lat, lon).height(lat, lon); }
}

// HRSC + MOLA blended DEM v2 (USGS Astrogeology; Fergason, Hare & Laura 2018), ~200 m/px global:
// HRSC stereo heights where Mars Express covered the ground, MOLA elsewhere, same areoid datum
// as the MEGDR files. One 11 GB uncompressed GeoTIFF on S3: int16 little-endian, one row per
// strip, rows stored back to back, origin 180W 90N. It is read in 1024 x 64 pixel blocks (one
// HTTP Range request per row, many at once), and blocks are kept under web/data/hrsc200/.
const s3 = { active: 0, max: 24, queue: [] };
function s3Run(fn) {
  return new Promise((resolve, reject) => {
    s3.queue.push({ fn, resolve, reject });
    pumpS3();
  });
}
function pumpS3() {
  while (s3.active < s3.max && s3.queue.length) {
    const job = s3.queue.pop(); // newest first, like the PDS queue
    s3.active++;
    job.fn().then(job.resolve, job.reject).finally(() => { s3.active--; pumpS3(); });
  }
}

class BlendDem {
  constructor(fallback) {
    this.url = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mars/HRSC_MOLA_Blend/" +
      "Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif";
    this.W = 106694;
    this.H = 53347;
    this.base = 854272;          // byte offset of row 0 (checked: rows are contiguous)
    this.ppd = this.W / 360;     // ~296.4 px/deg
    this.BW = 1024;              // block size in pixels
    this.BH = 64;
    this.nBlocks = Math.ceil(this.W / this.BW) * Math.ceil(this.H / this.BH);
    this.dir = path.join(DATA_DIR, "hrsc200");
    this.north = 90;
    this.south = -90;
    this.fallback = fallback;    // for no-data pixels
    this.blocks = new Map();     // "br_bc" -> { w, data }, oldest first; capped (~128 KB each)
    this.maxBlocks = 800;
    this.pending = new Map();
    this.onDisk = new Set();
  }

  async init() {
    await mkdir(this.dir, { recursive: true });
    for (const f of await readdir(this.dir)) if (f.endsWith(".bin")) this.onDisk.add(f.slice(0, -4));
    if (this.onDisk.size) console.log(`HRSC/MOLA 200 m: ${this.onDisk.size} blocks cached`);
  }

  get progress() { return this.onDisk.size / this.nBlocks; }
  covers() { return true; }

  // Blocks needed (with bilinear neighbours) for a lat/lon box that are not in memory yet.
  missing(north, south, west, east) {
    const { ppd, BW, BH, W, H } = this;
    const r0 = Math.max(0, Math.floor((90 - north) * ppd - 0.5) - 1);
    const r1 = Math.min(H - 1, Math.floor((90 - south) * ppd - 0.5) + 2);
    const c0 = Math.floor((west + 180) * ppd - 0.5) - 1;
    const c1 = Math.floor((east + 180) * ppd - 0.5) + 2;
    const cols = new Set();
    for (let c = c0; c <= c1; c += BW) cols.add(Math.floor((((c % W) + W) % W) / BW));
    cols.add(Math.floor((((c1 % W) + W) % W) / BW));
    const out = [];
    for (let br = Math.floor(r0 / BH); br <= Math.floor(r1 / BH); br++) {
      for (const bc of cols) {
        const key = `${br}_${bc}`;
        if (!this.blocks.has(key)) out.push([this, key]);
      }
    }
    return out;
  }

  ensureChunk(key) {
    if (this.blocks.has(key)) return Promise.resolve();
    if (this.pending.has(key)) return this.pending.get(key);
    const p = this.loadBlock(key)
      .then((block) => {
        this.blocks.set(key, block);
        while (this.blocks.size > this.maxBlocks) this.blocks.delete(this.blocks.keys().next().value);
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, p);
    return p;
  }

  async loadBlock(key) {
    const [br, bc] = key.split("_").map(Number);
    const c0 = bc * this.BW, w = Math.min(this.BW, this.W - c0);
    const r0 = br * this.BH, h = Math.min(this.BH, this.H - r0);
    const file = path.join(this.dir, `${key}.bin`);
    if (this.onDisk.has(key)) {
      try {
        const raw = await readFile(file);
        if (raw.length === w * h * 2) return { w, data: decodeLE(raw) };
      } catch {}
      this.onDisk.delete(key);
    }
    const buf = Buffer.alloc(w * h * 2);
    await Promise.all(Array.from({ length: h }, (_, i) => s3Run(async () => {
      const start = this.base + ((r0 + i) * this.W + c0) * 2, end = start + w * 2 - 1;
      for (let attempt = 1; ; attempt++) {
        try {
          const r = await fetch(this.url, { headers: { Range: `bytes=${start}-${end}` }, signal: AbortSignal.timeout(30_000) });
          if (r.status !== 206) throw new Error(`HTTP ${r.status}`);
          const row = Buffer.from(await r.arrayBuffer());
          if (row.length !== w * 2) throw new Error(`short row ${row.length}`);
          row.copy(buf, i * w * 2);
          return;
        } catch (err) {
          if (attempt >= 4) throw err;
          await new Promise((res) => setTimeout(res, 500 * attempt));
        }
      }
    })));
    await writeFile(file, buf);
    this.onDisk.add(key);
    return { w, data: decodeLE(buf) };
  }

  sample(row, col) {
    row = Math.min(this.H - 1, Math.max(0, row));
    col = ((col % this.W) + this.W) % this.W;
    const br = Math.floor(row / this.BH), bc = Math.floor(col / this.BW);
    const b = this.blocks.get(`${br}_${bc}`);
    if (!b) return NaN;
    const v = b.data[(row - br * this.BH) * b.w + (col - bc * this.BW)];
    return v === -32768 ? NaN : v;
  }

  height(lat, lon) {
    const sx = (((lon + 180) % 360) + 360) % 360 * this.ppd - 0.5;
    const sy = Math.min(this.H - 1, Math.max(0, (90 - lat) * this.ppd - 0.5));
    const x0 = Math.floor(sx), y0 = Math.floor(sy);
    const fx = sx - x0, fy = sy - y0;
    const h00 = this.sample(y0, x0), h10 = this.sample(y0, x0 + 1);
    const h01 = this.sample(y0 + 1, x0), h11 = this.sample(y0 + 1, x0 + 1);
    const v = (h00 * (1 - fx) + h10 * fx) * (1 - fy) + (h01 * (1 - fx) + h11 * fx) * fy;
    return Number.isFinite(v) ? v : this.fallback.height(lat, lon);
  }
}
function decodeLE(buf) {
  const out = new Int16Array(buf.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(2 * i);
  return out;
}

const MEG = (dir, ppd, chunk, n) => new LazyDem({ dir, ppd, chunk, ...n });
const tiles = (ppd, code, chunk, latEdges, latSpan, lonEdges, lonSpan) =>
  latEdges.flatMap((north) => lonEdges.map((west) => {
    const ns = `${String(Math.abs(north)).padStart(2, "0")}${north < 0 ? "s" : "n"}`;
    const file = `megt${ns}${String(west).padStart(3, "0")}${code}.img`;
    return MEG(`meg${String(ppd).padStart(3, "0")}`, ppd, chunk, { file, north, west, latSpan, lonSpan });
  }));
const DEMS = [
  new DemSet(4, [MEG("meg004", 4, 256 * 1024, { file: "megt90n000cb.img" })]),
  new DemSet(16, [MEG("meg016", 16, 1024 * 1024, { file: "megt90n000eb.img" })]),
  // 2 MB chunks: same layout as the old whole-file download, so a half-finished one is reused
  new DemSet(32, [MEG("meg032", 32, 2 * 1024 * 1024, { file: "megt90n000fb.img" })]),
  // regional files: smaller chunks (1 MB is ~45 lines at 64 px/deg, 512 KB ~22 lines at 128)
  new DemSet(64, tiles(64, "gb", 1024 * 1024, [90, 0], 90, [0, 180], 180)),
  new DemSet(128, tiles(128, "hb", 512 * 1024, [88, 44, 0, -44], 44, [0, 90, 180, 270], 90)),
];
DEMS.push(new BlendDem(DEMS[3])); // no-data pixels fall back to 64 px/deg MOLA
const terrain = { ready: false, error: null };

// Coarsest DEM that still has at least one sample per tile cell at this level, among those
// that cover the tile's latitudes (128 px/deg stops at 88 degrees).
function demFor(level, north, south) {
  const cellsPerDeg = ((TILE_N - 1) * 2 ** level) / 180;
  const cover = DEMS.filter((d) => d.covers(north, south));
  return cover.find((d) => d.ppd >= cellsPerDeg) ?? cover[cover.length - 1];
}

async function loadTerrain() {
  for (const d of DEMS) await d.init();
  const base = DEMS[0].files[0];
  if (!base.complete) {
    console.log("Fetching global MOLA elevation (2 MB)…");
    await Promise.all(Array.from({ length: base.nChunks }, (_, i) => base.ensureChunk(i)));
  }
  terrain.ready = true;
  console.log("MOLA terrain ready (finer detail is fetched as you zoom in).");
}

// /terrain/{z}/{x}/{y}  ->  65x65 little-endian float32 heights, row 0 = north edge (67x67 with ?b=1).
// Same tiling as the imagery: geographic, 2 x 1 tiles at level 0.
// 202 = this tile's data is being fetched, ask again shortly.
function serveTerrain(url, res) {
  // /terrain/point?lat=&lon=  ->  { height, ppd } from the finest DEM that has this spot on
  // disk; the 32 px/deg chunk is fetched in the background so the next click there is exact.
  if (url.pathname === "/terrain/point") {
    const lat = Number(url.searchParams.get("lat")), lon = Number(url.searchParams.get("lon"));
    if (!terrain.ready || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90)
      return send(res, terrain.ready ? 400 : 503, "lat/lon needed");
    let best = DEMS[0];
    const cover = DEMS.filter((d) => d.covers(lat, lat));
    for (const d of cover) {
      const miss = d.missing(lat, lat, lon, lon);
      if (!miss.length) best = d;
      else if (d === cover[cover.length - 1]) for (const [f, i] of miss) f.ensureChunk(i).catch(() => {});
    }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ height: Math.round(best.height(lat, lon)), ppd: best.ppd }));
  }
  if (url.pathname === "/terrain/status") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({
      ready: terrain.ready,
      progress: DEMS[0].progress,
      error: terrain.error,
      cached: Object.fromEntries(DEMS.map((d) => [d.ppd, d.progress])),
      // source data being fetched right now: chunks/blocks per dataset, and the two queues
      downloading: Object.fromEntries(DEMS.map((d) => [d.ppd,
        d.files ? d.files.reduce((n, f) => n + f.pending.size, 0) : d.pending?.size ?? 0]).filter(([, n]) => n > 0)),
      queues: { pds: { active: net.active, waiting: net.stack.length }, s3: { active: s3.active, waiting: s3.queue.length } },
    }));
  }
  const m = /^\/terrain\/(\d{1,2})\/(\d{1,8})\/(\d{1,8})$/.exec(url.pathname);
  if (!m) return send(res, 400, "Bad terrain path");
  if (!terrain.ready) return send(res, 503, "Terrain not ready yet");
  const [z, x, y] = m.slice(1).map(Number);
  const nx = 2 ** (z + 1), ny = 2 ** z;
  if (z > 22 || x >= nx || y >= ny) return send(res, 404, "No such tile");
  const dLon = 360 / nx, dLat = 180 / ny;
  const west = -180 + x * dLon, north = 90 - y * dLat;

  // ?b=1 adds a one-sample border on every side ((TILE_N + 2)^2 heights), so the page can
  // compute surface normals at tile edges that match the neighbouring tile's.
  const border = url.searchParams.get("b") === "1" ? 1 : 0;
  const n = TILE_N + 2 * border, step = dLat / (TILE_N - 1);

  const pad = border * step;
  const dem = demFor(z, Math.min(90, north + pad), Math.max(-90, north - dLat - pad));
  const missing = dem.missing(north + pad, north - dLat - pad, west - pad, west + dLon + pad);
  if (missing.length) {
    for (const [f, i] of missing) f.ensureChunk(i).catch(() => {});
    res.writeHead(202, { "Content-Type": "text/plain", "Cache-Control": "no-store", "Retry-After": "1" });
    return res.end(`fetching ${missing.length} chunk(s)`);
  }

  const out = new Float32Array(n * n);
  for (let r = 0; r < n; r++) {
    const lat = Math.max(-90, Math.min(90, north - ((r - border) / (TILE_N - 1)) * dLat));
    for (let c = 0; c < n; c++) out[r * n + c] = dem.height(lat, west + ((c - border) / (TILE_N - 1)) * dLon);
  }
  res.writeHead(200, {
    "Content-Type": "application/octet-stream",
    "Cache-Control": "public, max-age=2592000, immutable",
  });
  res.end(Buffer.from(out.buffer));
}

async function serveFile(url, res) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return send(res, 400, "Bad URL");
  }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(root, rel));
  if (file !== root && !file.startsWith(root + path.sep)) return send(res, 403, "Forbidden");

  let info;
  try {
    info = await stat(file);
  } catch {
    return send(res, 404, "Not found");
  }
  if (!info.isFile()) return send(res, 404, "Not found");

  const type = types[path.extname(file).toLowerCase()] ?? "application/octet-stream";
  const compressible = /\.(?:html|js|mjs|css|json|svg|xml)$/i.test(file);
  const acceptsGzip = /(?:^|,)\s*gzip(?:\s*;|\s*(?:,|$))/i.test(res.req.headers["accept-encoding"] ?? "");
  const gzip = compressible && acceptsGzip;
  res.writeHead(200, {
    "Content-Type": type,
    ...(gzip ? { "Content-Encoding": "gzip", "Vary": "Accept-Encoding" } : { "Content-Length": info.size }),
  });
  const stream = createReadStream(file).on("error", () => res.destroy());
  if (gzip) stream.pipe(createGzip()).pipe(res);
  else stream.pipe(res);
}

async function proxyJezeroVtour(url, res) {
  let rest;
  try { rest = decodeURIComponent(url.pathname.slice("/fu-vtour".length)); }
  catch { return send(res, 400, "Bad virtual-tour URL"); }
  if (!rest.startsWith("/") || rest.includes("..")) return send(res, 403, "Forbidden");
  const upstream = await fetch(`${JEZERO_VTOUR_HOST}${rest}${url.search}`, { signal: AbortSignal.timeout(60_000) });
  let body = Buffer.from(await upstream.arrayBuffer());
  const ext = path.extname(rest).toLowerCase();
  if (ext === ".xml" || ext === ".css") {
    const text = body.toString("utf8")
      .replaceAll("https://maps.planet.fu-berlin.de/vtour/", "/fu-vtour/")
      .replaceAll("http://maps.planet.fu-berlin.de/vtour/", "/fu-vtour/")
      .replaceAll("/vtour/", "/fu-vtour/");
    body = Buffer.from(text, "utf8");
  }
  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") ?? types[ext] ?? "application/octet-stream",
    "Content-Length": body.length,
    "Cache-Control": upstream.ok ? "public, max-age=3600" : "no-store",
  });
  res.end(body);
}

// ---------------------------------------------------------------- custom spots
// The viewer's "custom spots" (name, kind, colour, description, tags, images...) are kept in
// web/data/custom/spots.json, and uploaded images in web/data/custom/images/. Both are
// git-ignored: use the viewer's Export / Import to share them. Only this machine can reach the
// server (it listens on 127.0.0.1), and writes must come from the viewer page itself (Origin
// check), so another website open in the browser cannot change them.
const CUSTOM_DIR = path.join(root, "data", "custom");
const CUSTOM_FILE = path.join(CUSTOM_DIR, "spots.json");
const CUSTOM_IMG_DIR = path.join(CUSTOM_DIR, "images");
const IMAGE_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
const MAX_JSON = 2 * 1024 * 1024, MAX_IMAGE = 15 * 1024 * 1024;

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return req.headers["sec-fetch-site"] !== "cross-site";
  return origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`;
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error("Too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
async function customSpotsApi(req, res, url) {
  if (url.pathname === "/api/custom-spots" && req.method === "GET") {
    try { return sendJson(res, 200, JSON.parse(await readFile(CUSTOM_FILE, "utf8"))); }
    catch { return sendJson(res, 200, { version: 1, kinds: [], spots: [] }); }
  }
  if (!sameOrigin(req)) return send(res, 403, "Forbidden");
  if (url.pathname === "/api/custom-spots" && req.method === "PUT") {
    const doc = JSON.parse((await readBody(req, MAX_JSON)).toString("utf8"));
    if (!doc || !Array.isArray(doc.spots) || !Array.isArray(doc.kinds)) return send(res, 400, "Expected { kinds: [], spots: [] }");
    await mkdir(CUSTOM_DIR, { recursive: true });
    const tmp = CUSTOM_FILE + ".tmp";
    await writeFile(tmp, JSON.stringify({ version: 1, kinds: doc.kinds, spots: doc.spots }, null, 1));
    await rename(tmp, CUSTOM_FILE); // atomic: a crash never leaves half a file
    return sendJson(res, 200, { ok: true, spots: doc.spots.length });
  }
  if (url.pathname === "/api/custom-images" && req.method === "POST") {
    const ext = IMAGE_EXT[(req.headers["content-type"] || "").split(";")[0].trim()];
    if (!ext) return send(res, 415, "Images only: PNG, JPEG, WebP or GIF");
    const body = await readBody(req, MAX_IMAGE);
    await mkdir(CUSTOM_IMG_DIR, { recursive: true });
    const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await writeFile(path.join(CUSTOM_IMG_DIR, name), body);
    return sendJson(res, 200, { url: `./data/custom/images/${name}` });
  }
  return send(res, 405, "Method not allowed");
}

// ---------------------------------------------------------------- REMS (Curiosity weather)
// The public REMS JSON is not CORS-readable from every origin, so the page asks us; we keep
// the latest 30 sols in memory for an hour. The page falls back to a committed snapshot.
const REMS_URL = "https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json";
const rems = { at: 0, body: null, job: null };
async function serveRems(res) {
  try {
    if (!rems.body || Date.now() - rems.at > 3600_000) {
      rems.job ??= fetch(REMS_URL, { signal: AbortSignal.timeout(20000) })
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then((d) => { rems.body = JSON.stringify({ source: REMS_URL, fetched_utc: new Date().toISOString(), soles: d.soles.slice(0, 30) }); rems.at = Date.now(); })
        .finally(() => { rems.job = null; });
      await rems.job;
    }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" });
    res.end(rems.body);
  } catch (err) {
    if (rems.body) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(rems.body); }
    send(res, 502, `REMS feed unreachable: ${err.message}`);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/api/custom-")) {
    return customSpotsApi(req, res, url).catch((err) =>
      res.headersSent ? res.destroy() : send(res, err.status || (err instanceof SyntaxError ? 400 : 500), err.message));
  }
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed");
  if (url.pathname === "/__proxy") return send(res, 200, "ok"); // lets the page detect this server
  if (url.pathname === "/favicon.ico") {
    res.writeHead(204, { "Cache-Control": "public, max-age=86400" });
    return res.end();
  }
  if (url.pathname === "/pano") {
    return proxyPano(url, res).catch((err) => send(res, 502, `Could not load panorama: ${err.message}`));
  }
  if (url.pathname.startsWith("/fu-vtour/")) {
    return proxyJezeroVtour(url, res).catch((err) => send(res, 502, `Could not load Jezero panorama asset: ${err.message}`));
  }
  if (url.pathname === "/rems") return serveRems(res);
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify({ ok: true, terrain: terrain.ready, terrainError: terrain.error }));
  }
  if (url.pathname === "/catalog") {
    return getCatalog().then(
      (list) => {
        res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify(list));
      },
      (err) => send(res, 502, `Could not load the Trek catalog: ${err.message}`),
    );
  }
  if (url.pathname.startsWith("/terrain/")) {
    try { return serveTerrain(url, res); } catch (err) { return send(res, 500, String(err)); }
  }
  const job = url.pathname.startsWith("/trek/") ? proxyTrek(url, res) : serveFile(url, res);
  job.catch((err) => send(res, 500, String(err)));
});

server.on("error", (err) => {
  console.error(
    err.code === "EADDRINUSE"
      ? `Port ${port} is already in use. Close the other server, or run with PORT=9000.`
      : err,
  );
  process.exit(1);
});

server.listen(port, host, () => {
  const url = `http://localhost:${port}/`;
  console.log(`Mars viewer running at ${url}  (Ctrl+C to stop)`);
  if (process.platform === "win32" && !process.argv.includes("--no-open")) {
    exec(`start "" "${url}"`);
  } else if (process.platform === "linux" && !process.argv.includes("--no-open")) {
    exec(`xdg-open "${url}"`, (err) => {
      if (err) console.log(`Open ${url} in your browser.`);
    });
  }
  warmCache().catch((err) => console.warn("Tile warm-up failed:", err.message));
  loadTerrain().catch((err) => {
    terrain.error = err.message;
    console.warn("Terrain unavailable (the map still works, flat):", err.message);
  });
});
