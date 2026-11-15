// Local, terrain-only Theta* over numeric MOLA height tiles served by serve.mjs.
// Trek's MOLA/HRSC relief layer is color imagery; these heights come from numeric MOLA.
//
// Speed notes (results are identical to the straightforward version, see planTerrainRoute):
//  - height tiles are kept in memory (and requests de-duplicated), and assembled grids are
//    reused, so re-planning after adding a stop does not fetch or rebuild anything again;
//  - the sparse corridor grid keeps its ~65x65 tiles as they are instead of copying a
//    million cells into a Map;
//  - the search uses typed arrays, per-row trig computed once, no per-step allocations,
//    and yields to the browser every ~12 ms of work (not every 128 steps through
//    setTimeout, whose 4 ms minimum made long searches mostly idle).
const TILE_CELLS = 64;
const TILE_SAMPLES = TILE_CELLS + 1;
const MARS_RADIUS_M = 3_396_190;
const RAD = Math.PI / 180;

function tileColumns(level) { return 2 ** (level + 1); }
function tileRows(level) { return 2 ** level; }
function lonTile(lon, level) {
  const n = tileColumns(level), d = 360 / n;
  let normalized = ((lon + 180) % 360 + 360) % 360;
  return Math.min(n - 1, Math.floor(normalized / d));
}
function latTile(lat, level) {
  const n = tileRows(level), d = 180 / n;
  return Math.max(0, Math.min(n - 1, Math.floor((90 - lat) / d)));
}

export function estimateTerrainPatchCells(bounds, level = 6) {
  const dLat = 180 / tileRows(level);
  const westX = lonTile(bounds.west, level), eastX = lonTile(bounds.east - 1e-10, level);
  const nx = bounds.west <= bounds.east
    ? eastX - westX + 1
    : tileColumns(level) - westX + eastX + 1;
  const y0 = latTile(bounds.north, level);
  const y1 = Math.max(0, Math.min(tileRows(level) - 1, Math.floor((90 - bounds.south - 1e-10) / dLat)));
  return (nx * TILE_CELLS + 1) * ((y1 - y0 + 1) * TILE_CELLS + 1);
}

// Yield to the browser without setTimeout's 4 ms clamp.
const yieldQueue = [];
let yieldChannel = null;
function yieldToBrowser() {
  if (!yieldChannel && typeof MessageChannel !== "undefined") {
    yieldChannel = new MessageChannel();
    // Node: the port keeps the process alive only while a yield is pending (ref/unref are
    // Node-only; browsers have neither and need nothing).
    yieldChannel.port1.onmessage = () => {
      yieldQueue.shift()?.();
      if (!yieldQueue.length) yieldChannel.port1.unref?.();
    };
    yieldChannel.port1.unref?.();
  }
  if (!yieldChannel) return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => { yieldQueue.push(resolve); yieldChannel.port1.ref?.(); yieldChannel.port2.postMessage(0); });
}

// ---------------------------------------------------------------- height tiles (memory cache)
const TILE_CACHE_MAX = 2048;                 // ~35 MB of 65x65 float tiles
const tileCache = new Map();                 // "z/x/y" -> Float32Array (insertion order = LRU)
const tileInFlight = new Map();              // "z/x/y" -> Promise<Float32Array>

// onWait(true) the first time the server answers 202 ("still downloading this data"),
// onWait(false) once the tile arrives; used for the route planner's progress report.
async function fetchHeightTile(z, x, y, signal, onWait) {
  const key = `${z}/${x}/${y}`;
  const hit = tileCache.get(key);
  if (hit) { tileCache.delete(key); tileCache.set(key, hit); return hit; }
  let job = tileInFlight.get(key);
  if (!job) {
    job = downloadHeightTile(z, x, y, signal, onWait)
      .then((data) => {
        tileCache.set(key, data);
        while (tileCache.size > TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value);
        return data;
      })
      .finally(() => tileInFlight.delete(key));
    tileInFlight.set(key, job);
  }
  return job;
}
async function downloadHeightTile(z, x, y, signal, onWait) {
  let waited = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    const response = await fetch(`/terrain/${z}/${x}/${y}`, { signal, cache: "force-cache" });
    if (response.status === 202) {
      if (!waited) { waited = true; onWait?.(true); }
      const delay = Number(response.headers.get("Retry-After") || 1);
      await new Promise((resolve, reject) => {
        const finish = () => { signal?.removeEventListener("abort", abort); resolve(); };
        const timer = setTimeout(finish, delay * 1000);
        const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(signal.reason); };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
      });
      continue;
    }
    if (!response.ok) throw new Error(`MOLA height tile ${z}/${x}/${y}: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== TILE_SAMPLES * TILE_SAMPLES * 4)
      throw new Error(`MOLA height tile ${z}/${x}/${y}: unexpected byte count`);
    if (waited) onWait?.(false);
    return new Float32Array(bytes);
  }
  throw new Error(`MOLA height tile ${z}/${x}/${y} is still being prepared`);
}

// Fetch many tiles at once and report onProgress({ done, total, preparing, level }):
// preparing = tiles the server is still downloading source data for (it answered 202).
async function fetchTiles(level, list, signal, onProgress) {
  let done = 0, preparing = 0;
  const report = () => onProgress?.({ done, total: list.length, preparing, level });
  report();
  return Promise.all(list.map(async ([tx, ty]) => {
    const data = await fetchHeightTile(level, tx, ty, signal, (w) => { preparing += w ? 1 : -1; report(); });
    done++; report();
    return data;
  }));
}

// Terrain heights (m, MOLA) at arbitrary points, bilinear inside the 65x65 height tiles.
// Used for line-of-sight checks; shares the tile cache with the planner.
export async function sampleTerrainHeights(points, level = 6, signal) {
  const nx = tileColumns(level), ny = tileRows(level), dLon = 360 / nx, dLat = 180 / ny;
  const where = points.map(({ lon, lat }) => {
    const u = ((((lon + 180) % 360) + 360) % 360) / dLon, v = Math.max(0, Math.min(ny - 1e-9, (90 - lat) / dLat));
    const tx = Math.min(nx - 1, Math.floor(u)), ty = Math.min(ny - 1, Math.floor(v));
    return { tx, ty, fx: (u - tx) * TILE_CELLS, fy: (v - ty) * TILE_CELLS };
  });
  const keys = [...new Set(where.map((w) => `${w.tx},${w.ty}`))];
  const datas = await Promise.all(keys.map((k) => { const [x, y] = k.split(",").map(Number); return fetchHeightTile(level, x, y, signal); }));
  const byKey = new Map(keys.map((k, i) => [k, datas[i]]));
  return where.map(({ tx, ty, fx, fy }) => {
    const d = byKey.get(`${tx},${ty}`);
    const c = Math.min(TILE_CELLS - 1, Math.floor(fx)), r = Math.min(TILE_CELLS - 1, Math.floor(fy));
    const a = fx - c, b = fy - r, k = r * TILE_SAMPLES + c;
    return (d[k] * (1 - a) + d[k + 1] * a) * (1 - b) + (d[k + TILE_SAMPLES] * (1 - a) + d[k + TILE_SAMPLES + 1] * a) * b;
  });
}

// A few recent grids, so asking for the same patch / corridor again costs nothing (and the
// grid object stays the same, which keeps its slope cache and the page's overlay cache).
const gridCache = new Map();
function rememberGrid(key, grid) {
  gridCache.delete(key);
  gridCache.set(key, grid);
  while (gridCache.size > 4) gridCache.delete(gridCache.keys().next().value);
  return grid;
}

// Bounds are Mars longitude/latitude degrees. Keep the patch local; the source data is
// fetched only for intersecting Cesium tiles and no whole-planet raster is built.
export async function loadTerrainPatch({ west, south, east, north, level = 6, signal, maxCells = 4_000_000, onProgress }) {
  if (![west, south, east, north].every(Number.isFinite) || south >= north ||
      west < -180 || east > 180 || south < -90 || north > 90)
    throw new RangeError("Expected Mars bounds; west > east is allowed across the longitude seam");
  if (!Number.isInteger(level) || level < 0 || level > 22) throw new RangeError("Invalid terrain level");

  const tilesX = tileColumns(level), tilesY = tileRows(level);
  const tileLon = 360 / tilesX, tileLat = 180 / tilesY;
  const tileX = (lon) => Math.max(0, Math.min(tilesX - 1, Math.floor((lon + 180) / tileLon)));
  const x0 = tileX(west);
  const x1 = tileX(east - 1e-10);
  const xs = west <= east
    ? Array.from({ length: x1 - x0 + 1 }, (_, i) => x0 + i)
    : [...Array.from({ length: tilesX - x0 }, (_, i) => x0 + i), ...Array.from({ length: x1 + 1 }, (_, i) => i)];
  const y0 = Math.max(0, Math.floor((90 - north) / tileLat));
  const y1 = Math.min(tilesY - 1, Math.floor((90 - south - 1e-10) / tileLat));
  const nx = xs.length, ny = y1 - y0 + 1;
  const width = nx * TILE_CELLS + 1, height = ny * TILE_CELLS + 1;
  if (width * height > maxCells)
    throw new RangeError(`Terrain patch is too large (${width}×${height}); narrow the route area or lower level`);

  // the grid depends only on which tiles it covers, not on the exact bounds asked for
  const key = `patch|${level}|${xs[0]}|${nx}|${y0}|${ny}`;
  const cached = gridCache.get(key);
  if (cached) { onProgress?.({ done: nx * ny, total: nx * ny, preparing: 0, level }); return rememberGrid(key, cached); }

  const tiles = await fetchTiles(level,
    Array.from({ length: nx * ny }, (_, i) => [xs[i % nx], y0 + Math.floor(i / nx)]), signal, onProgress);
  const heights = new Float32Array(width * height);
  for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
    const tile = tiles[ty * nx + tx];
    for (let r = 0; r < TILE_SAMPLES; r++) {
      const dst = (ty * TILE_CELLS + r) * width + tx * TILE_CELLS;
      heights.set(tile.subarray(r * TILE_SAMPLES, r * TILE_SAMPLES + TILE_SAMPLES), dst);
    }
  }

  return rememberGrid(key, {
    width, height, heights,
    westDeg: -180 + xs[0] * tileLon,
    northDeg: 90 - y0 * tileLat,
    lonStepDeg: tileLon / TILE_CELLS,
    latStepDeg: -tileLat / TILE_CELLS,
    level,
    source: "NASA MGS MOLA numeric topography via PDS; streamed by local terrain service",
  });
}

// Heights of a sparse set of tiles in worldwide cell coordinates, read straight from the
// tiles (no per-cell copy). get(id) has the same meaning as a Map of id -> height; slot(id)
// numbers every stored cell 0..cellCount-1 so the planner can use typed arrays.
class TiledHeights {
  constructor(level, tiles) { // tiles: [{ x, y, data }]
    this.tilesX = tileColumns(level);
    this.worldWidth = this.tilesX * TILE_CELLS;
    this.slots = new Map(); // tile key -> slot number (kept for steepMask and callers)
    // same mapping as a flat array: the planner looks a cell's tile up on every height / slope
    // read, and an Int32Array index is several times cheaper than Map.get there
    this.slotArr = new Int32Array(this.tilesX * tileRows(level)).fill(-1);
    this.data = [];
    for (const { x, y, data } of tiles) {
      this.slots.set(y * this.tilesX + x, this.data.length);
      this.slotArr[y * this.tilesX + x] = this.data.length;
      this.data.push(data);
    }
    this.cellCount = this.data.length * TILE_SAMPLES * TILE_SAMPLES;
  }
  // world cell -> stored sample (tile slot, local index); a cell on a tile edge is stored by
  // both neighbours with the same value: prefer the tile it starts, else the one it ends
  locate(id) {
    const W = this.worldWidth, gx = id % W, gy = (id - gx) / W;
    const tx = Math.floor(gx / TILE_CELLS), ty = Math.floor(gy / TILE_CELLS);
    const lx = gx - tx * TILE_CELLS, ly = gy - ty * TILE_CELLS;
    const A = this.slotArr;
    let s = A[ty * this.tilesX + tx] ?? -1;
    if (s >= 0) return s * TILE_SAMPLES * TILE_SAMPLES + ly * TILE_SAMPLES + lx;
    if (lx === 0) {
      const px = (tx - 1 + this.tilesX) % this.tilesX;
      s = A[ty * this.tilesX + px] ?? -1;
      if (s >= 0) return s * TILE_SAMPLES * TILE_SAMPLES + ly * TILE_SAMPLES + TILE_CELLS;
    }
    if (ly === 0 && ty > 0) {
      s = A[(ty - 1) * this.tilesX + tx] ?? -1;
      if (s >= 0) return s * TILE_SAMPLES * TILE_SAMPLES + TILE_CELLS * TILE_SAMPLES + lx;
      if (lx === 0) {
        const px = (tx - 1 + this.tilesX) % this.tilesX;
        s = A[(ty - 1) * this.tilesX + px] ?? -1;
        if (s >= 0) return s * TILE_SAMPLES * TILE_SAMPLES + TILE_CELLS * TILE_SAMPLES + TILE_CELLS;
      }
    }
    return -1;
  }
  slot(id) { return this.locate(id); }
  get(id) {
    const k = this.locate(id);
    if (k < 0) return undefined;
    const n = TILE_SAMPLES * TILE_SAMPLES;
    return this.data[(k / n) | 0][k % n];
  }
  has(id) { return this.locate(id) >= 0; }
}

// Load only fine tiles touched by a coarse route and a one-tile buffer around it.
// The returned sparse grid lets fine Theta* explore only this local corridor.
export async function loadTerrainCorridor(coarsePath, { level = 6, bufferTiles = 1, maxTiles = 256, signal, onProgress } = {}) {
  if (!coarsePath?.length) throw new RangeError("A coarse route is required");
  if (!Number.isInteger(bufferTiles) || bufferTiles < 0) throw new RangeError("Invalid tile buffer");
  const nx = tileColumns(level), ny = tileRows(level), keys = new Set();
  for (const p of coarsePath) {
    const cx = lonTile(p.lon, level), cy = latTile(p.lat, level);
    for (let oy = -bufferTiles; oy <= bufferTiles; oy++) {
      const y = cy + oy;
      if (y < 0 || y >= ny) continue;
      for (let ox = -bufferTiles; ox <= bufferTiles; ox++) {
        const x = (cx + ox + nx) % nx;
        keys.add(`${x},${y}`);
      }
    }
  }
  if (keys.size > maxTiles)
    throw new RangeError(`Detailed route corridor needs ${keys.size} tiles (limit ${maxTiles})`);

  const coords = [...keys].sort().map((key) => key.split(",").map(Number));
  const cacheKey = `corridor|${level}|${coords.join(";")}`;
  const cached = gridCache.get(cacheKey);
  if (cached) { onProgress?.({ done: coords.length, total: coords.length, preparing: 0, level }); return rememberGrid(cacheKey, cached); }

  const datas = await fetchTiles(level, coords, signal, onProgress);
  const tiles = coords.map(([x, y], i) => ({ x, y, data: datas[i] }));
  const worldWidth = nx * TILE_CELLS, worldHeight = ny * TILE_CELLS;
  return rememberGrid(cacheKey, {
    width: worldWidth, height: worldHeight + 1, heights: new TiledHeights(level, tiles), wrapX: true,
    tileKeys: coords,
    westDeg: -180, northDeg: 90,
    lonStepDeg: 360 / worldWidth, latStepDeg: -180 / worldHeight,
    level,
    source: "NASA MGS MOLA numeric topography via PDS; sparse fine tile corridor",
  });
}

export function lonLatToTerrainCell(grid, lonDeg, latDeg) {
  let lon = lonDeg;
  while (lon < grid.westDeg) lon += 360;
  while (lon >= grid.westDeg + grid.width * grid.lonStepDeg) lon -= 360;
  const x = Math.round((lon - grid.westDeg) / grid.lonStepDeg);
  const y = Math.round((latDeg - grid.northDeg) / grid.latStepDeg);
  if (x < 0 || x >= grid.width || y < 0 || y >= grid.height) return null;
  return { x, y };
}

// ---------------------------------------------------------------- per-grid helpers (cached on the grid)
// Row geometry: cos(latitude) of each row and of the midpoint between each row and the next,
// so steps never call cos(); plus a cell index for the typed arrays and a slope cache.
function gridTools(grid) {
  if (grid._tools) return grid._tools;
  const { width, height, heights, wrapX, northDeg, latStepDeg, lonStepDeg } = grid;
  const dense = heights instanceof Float32Array;
  const cosRow = new Float64Array(height), cosMid = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    cosRow[y] = Math.cos((northDeg + y * latStepDeg) * RAD);
    cosMid[y] = Math.cos((northDeg + (y + 0.5) * latStepDeg) * RAD);
  }
  const lonM = lonStepDeg * RAD * MARS_RADIUS_M;          // metres per cell east at the equator (signed)
  const latM = latStepDeg * RAD * MARS_RADIUS_M;          // metres per cell north (signed)
  const cellCount = dense ? width * height : heights.cellCount;
  const slotOf = dense ? (id) => id : (id) => heights.slot(id);
  const heightAt = dense ? (id) => heights[id] : (id) => heights.get(id);
  const slopeCache = new Float32Array(cellCount).fill(NaN);
  const get = (x, y) => {
    if (wrapX) x = (x + width) % width;
    if (x < 0 || x >= width || y < 0 || y >= height) return undefined;
    return heightAt(y * width + x);
  };
  // Same formula as terrainCellSlopeDeg: central difference where both neighbours exist,
  // one-sided otherwise; Infinity where the cell or both neighbours on an axis are missing.
  const slopeAt = (x, y) => {
    const h = get(x, y);
    if (h === undefined) return Infinity;
    const hx = Math.abs(lonM * cosRow[y]), hy = Math.abs(latM);
    const w = get(x - 1, y), e = get(x + 1, y), n = get(x, y - 1), s = get(x, y + 1);
    const deriv = (a, b, d) => (a !== undefined && b !== undefined ? (b - a) / (2 * d)
      : b !== undefined ? (b - h) / d : a !== undefined ? (h - a) / d : undefined);
    const dx = deriv(w, e, hx), dy = deriv(n, s, hy);
    if (dx === undefined || dy === undefined) return Infinity;
    return Math.atan(Math.hypot(dx, dy)) / RAD;
  };
  const cellSlope = (id) => {
    const k = slotOf(id);
    if (k < 0) return Infinity;
    let v = slopeCache[k];
    if (v !== v) { const x = id % width; v = slopeCache[k] = slopeAt(x, (id - x) / width); }
    return v;
  };
  // horizontal distance of one raster step (dx, dy in -1..1) leaving row y
  const stepM = (dx, y, dy) => {
    const c = dy === 0 ? cosRow[y] : cosMid[dy > 0 ? y : y - 1];
    return Math.hypot(dx * lonM * c, dy * latM);
  };
  // Roughness: RMS of the 8 neighbours' heights about the local tilted plane (the plane of the
  // slope gradient), in metres. Flat or evenly tilted ground scores 0, bumpy ground (crater
  // rims, knobs, hummocky terrain) scores high: it catches what slope alone misses.
  const roughCache = new Float32Array(cellCount).fill(NaN);
  const roughAt = (x, y) => {
    const h = get(x, y);
    if (h === undefined) return Infinity;
    const hx = Math.abs(lonM * cosRow[y]), hy = Math.abs(latM);
    const w = get(x - 1, y), e = get(x + 1, y), n = get(x, y - 1), s = get(x, y + 1);
    const gx = w !== undefined && e !== undefined ? (e - w) / (2 * hx) : 0;
    const gy = n !== undefined && s !== undefined ? (s - n) / (2 * hy) : 0;
    let sum = 0, count = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      if (!i && !j) continue;
      const z = get(x + i, y + j);
      if (z === undefined) continue;
      const r = z - (h + gx * i * hx + gy * j * hy);
      sum += r * r; count++;
    }
    return count >= 4 ? Math.sqrt(sum / count) : 0;
  };
  const cellRoughness = (id) => {
    const k = slotOf(id);
    if (k < 0) return Infinity;
    let v = roughCache[k];
    if (v !== v) { const x = id % width; v = roughCache[k] = roughAt(x, (id - x) / width); }
    return v;
  };
  return (grid._tools = { dense, cellCount, slotOf, heightAt, cellSlope, cellRoughness, stepM, cosRow });
}

// ---------------------------------------------------------------- hazards
// A hazard is a per-cell field that can block a cell or make it slower / costlier to cross:
//   { id, label, unit, valueAt(cellId, lonDeg, latDeg) -> number | undefined,
//     blocks(v) -> bool, factor(v) -> cost multiplier >= 1, describe(v) -> text, limit -> text }
// The planner multiplies each step's cost by the factor of the cell it enters, and never
// enters a blocked cell. Factors >= 1 keep the A* heuristic admissible.

// Terrain roughness from the planner's own DEM (no extra data). Thresholds: docs/assumptions.md.
export function roughnessHazard(grid, { blockM = 400, slowFromM = 40, slowPerM = 1 / 160 } = {}) {
  const T = gridTools(grid);
  return {
    id: "roughness", label: "rough terrain", unit: "m",
    valueAt: (id) => { const v = T.cellRoughness(id); return Number.isFinite(v) ? v : undefined; },
    blocks: (v) => v > blockM,
    factor: (v) => 1 + Math.max(0, v - slowFromM) * slowPerM,
    describe: (v) => `roughness ${Math.round(v)} m`,
    limit: `limit ${blockM} m`,
  };
}

// Cell -> lon/lat of its centre (degrees), wrapped to -180..180.
function cellLonLat(grid, id) {
  const x = id % grid.width, y = (id - x) / grid.width;
  const lon = ((((grid.westDeg + x * grid.lonStepDeg) + 180) % 360) + 360) % 360 - 180;
  return { lon, lat: grid.northDeg + y * grid.latStepDeg };
}

// Per-planner cache of the combined hazard state of each cell: 0 = not computed yet,
// -1 = blocked, otherwise the cost factor (>= 1).
function hazardField(grid, hazards) {
  const list = (hazards || []).filter(Boolean);
  if (!list.length) return { any: false, factor: () => 1 };
  const T = gridTools(grid), state = new Float32Array(T.cellCount);
  const factor = (id) => {
    const k = T.slotOf(id);
    if (k < 0) return -1;
    let f = state[k];
    if (f === 0) {
      f = 1;
      const { lon, lat } = cellLonLat(grid, id);
      for (const h of list) {
        const v = h.valueAt(id, lon, lat);
        if (v === undefined || v === null || Number.isNaN(v)) continue;
        if (h.blocks?.(v)) { f = -1; break; }
        if (h.factor) f *= Math.max(1, h.factor(v));
      }
      state[k] = f;
    }
    return f;
  };
  return { any: true, factor };
}

// Steep-cell mask of a rectangle of grid cells: 1 where the slope is above limitDeg.
// Same slope formula as terrainCellSlopeDeg, but read straight from the height array /
// tile (only tile-edge cells take the general path), so a whole tile costs ~1 ms.
const tileMaskCache = new Map(); // "level/tx/ty/limit" -> Uint8Array(64*64), corridor tiles
export function steepMask(grid, limitDeg, x0, y0, w, h) {
  const T = gridTools(grid);
  const { width, height, heights } = grid;
  const out = new Uint8Array(w * h);
  const lonM = grid.lonStepDeg * RAD * MARS_RADIUS_M, hy = Math.abs(grid.latStepDeg * RAD * MARS_RADIUS_M);
  const slopeFrom = (hc, wv, ev, nv, sv, hx) => {
    const dx = (ev - wv) / (2 * hx), dy = (sv - nv) / (2 * hy);
    return Math.atan(Math.hypot(dx, dy)) / RAD;
  };
  if (T.dense) {
    for (let j = 0; j < h; j++) {
      const y = y0 + j;
      if (y >= height) break;
      const hx = Math.abs(lonM * T.cosRow[y]), row = y * width;
      for (let i = 0; i < w; i++) {
        const x = x0 + i;
        if (x >= width) break;
        let s;
        if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
          const id = row + x;
          s = slopeFrom(heights[id], heights[id - 1], heights[id + 1], heights[id - width], heights[id + width], hx);
        } else s = T.cellSlope(row + x);
        if (s > limitDeg) out[j * w + i] = 1;
      }
    }
    return out;
  }
  // sparse corridor: whole 64x64 tiles only (x0, y0 on tile corners, w = h = 64)
  const S = TILE_SAMPLES, tx = Math.floor((((x0 % width) + width) % width) / TILE_CELLS), ty = Math.floor(y0 / TILE_CELLS);
  const key = `${grid.level}/${tx}/${ty}/${limitDeg}`;
  const hit = tileMaskCache.get(key);
  if (hit && w === TILE_CELLS && h === TILE_CELLS) return hit;
  const slot = heights.slots?.get(ty * heights.tilesX + tx);
  const data = slot === undefined ? null : heights.data[slot];
  for (let j = 0; j < h; j++) {
    const y = y0 + j;
    if (y >= height) break;
    const hx = Math.abs(lonM * T.cosRow[y]);
    for (let i = 0; i < w; i++) {
      const x = ((x0 + i) % width + width) % width;
      let s;
      if (data && i > 0 && j > 0 && i < TILE_CELLS && j < TILE_CELLS) {
        const k = j * S + i;
        s = slopeFrom(data[k], data[k - 1], data[k + 1], data[k - S], data[k + S], hx);
      } else s = T.cellSlope(y * width + x);
      if (s > limitDeg) out[j * w + i] = 1;
    }
  }
  if (w === TILE_CELLS && h === TILE_CELLS) {
    tileMaskCache.set(key, out);
    while (tileMaskCache.size > 1024) tileMaskCache.delete(tileMaskCache.keys().next().value);
  }
  return out;
}

export function terrainCellSlopeDeg(grid, x, y) {
  const { width, height, wrapX } = grid;
  if (wrapX) x = (x + width) % width;
  if (x < 0 || x >= width || y < 0 || y >= height) return Infinity;
  return gridTools(grid).cellSlope(y * width + x);
}

// Weighted Basic Theta*: any-angle shortcuts are checked against the same cell slope
// mask as the overlay, while edge grades retain the configured climb limit.
// Same search, same costs and same tie-breaking as before; only the bookkeeping is faster.
// speedAt (optional): grade (rise/run, uphill positive) -> walking speed in m/s. When given, the
// planner minimises walking TIME instead of surface distance (e.g. survival.js walkingSpeed).
// hazards (optional): see "hazards" above; blocked cells are never entered, slow cells cost more.
export async function planTerrainRoute(grid, start, goal, { maxSlopeDeg = Infinity, signal, shouldCancel = () => false, onProgress, speedAt, hazards } = {}) {
  if (!(maxSlopeDeg === Infinity || (Number.isFinite(maxSlopeDeg) && maxSlopeDeg >= 0 && maxSlopeDeg < 90)))
    throw new RangeError("maxSlopeDeg must be between 0 and 90 degrees");
  const { width, height, heights, westDeg, northDeg, lonStepDeg, latStepDeg } = grid;
  const dense = heights instanceof Float32Array;
  if (dense ? heights.length !== width * height : typeof heights?.get !== "function")
    throw new TypeError("heights must be a matching Float32Array or sparse height set");
  const inBounds = (p) => Number.isInteger(p.x) && Number.isInteger(p.y) &&
    p.x >= 0 && p.x < width && p.y >= 0 && p.y < height;
  if (!inBounds(start) || !inBounds(goal)) throw new RangeError("start/goal outside terrain patch");

  const T = gridTools(grid);
  const { slotOf, heightAt, cellSlope, stepM } = T;
  const wrapX = !!grid.wrapX;
  const startId = start.y * width + start.x, goalId = goal.y * width + goal.x;
  if (heightAt(startId) === undefined || heightAt(goalId) === undefined) return null;
  const pos = (x, y) => ({ lat: (northDeg + y * latStepDeg) * RAD, lon: (westDeg + x * lonStepDeg) * RAD });
  const horizontal = (x0, y0, x1, y1) => {
    const a = pos(x0, y0), b = pos(x1, y1), midLat = (a.lat + b.lat) / 2;
    let dLon = b.lon - a.lon;
    if (dLon > Math.PI) dLon -= 2 * Math.PI;
    else if (dLon < -Math.PI) dLon += 2 * Math.PI;
    return Math.hypot(dLon * MARS_RADIUS_M * Math.cos(midLat), (b.lat - a.lat) * MARS_RADIUS_M);
  };
  const maxSlopeRatio = Math.tan(maxSlopeDeg * RAD);
  const HZ = hazardField(grid, hazards);
  // time mode: the heuristic divides distance by the fastest speed on any allowed grade, so it
  // stays admissible (never overestimates the remaining time)
  let vMax = 1;
  if (speedAt) {
    vMax = 0;
    const gMax = Number.isFinite(maxSlopeDeg) ? Math.min(maxSlopeRatio, 3) : 3; // tan(Infinity) is NaN
    for (let k = -1000; k <= 1000; k++) vMax = Math.max(vMax, speedAt((k / 1000) * gMax));
    if (!(vMax > 0) || !Number.isFinite(vMax)) throw new RangeError("speedAt must return a positive speed");
  }
  // great-circle distance to the goal (admissible: never longer than the surface path)
  const goalLat = (northDeg + goal.y * latStepDeg) * RAD, goalLon = (westDeg + goal.x * lonStepDeg) * RAD;
  const cosGoal = Math.cos(goalLat);
  const heuristic = (x, y) => {
    const lat = (northDeg + y * latStepDeg) * RAD;
    let dLon = goalLon - (westDeg + x * lonStepDeg) * RAD;
    if (dLon > Math.PI) dLon -= 2 * Math.PI;
    else if (dLon < -Math.PI) dLon += 2 * Math.PI;
    const dLat = goalLat - lat;
    const h = Math.sin(dLat / 2) ** 2 + T.cosRow[y] * cosGoal * Math.sin(dLon / 2) ** 2;
    return 2 * MARS_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h))) / vMax;
  };

  // g, parent and closed per cell, in typed arrays indexed by the grid's cell slot
  const n = T.cellCount;
  const g = new Float64Array(n).fill(Infinity);
  const parent = new Int32Array(n).fill(-1);   // world cell id of the parent, -1 = none
  const closed = new Uint8Array(n);

  // Binary min-heap of [f, g, id], ordered by estimated total terrain distance.
  const heap = [];
  const push = (item) => {
    let i = heap.length; heap.push(item);
    while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= item[0]) break; heap[i] = heap[p]; i = p; }
    heap[i] = item;
  };
  const pop = () => {
    const first = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (true) {
        let c = i * 2 + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
        if (heap[c][0] >= last[0]) break;
        heap[i] = heap[c]; i = c;
      }
      heap[i] = last;
    }
    return first;
  };

  // Walk the Bresenham line from -> to (as the old rasterLine did) and return its terrain
  // cost, or -1 if any cell is too steep / missing or any step climbs too fast. No arrays.
  const segmentCost = (from, to) => {
    let x0 = from % width, y0 = (from - x0) / width;
    let x1 = to % width;
    const y1 = (to - x1) / width;
    if (wrapX && Math.abs(x1 - x0) > width / 2) x1 += x1 < x0 ? width : -width;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, cost = 0;
    let prevId = -1, prevH = 0, prevY = 0;
    for (;;) {
      const id = y0 * width + ((x0 % width + width) % width);
      if (cellSlope(id) > maxSlopeDeg) return -1;
      const hf = HZ.any ? HZ.factor(id) : 1;
      if (hf < 0) return -1;
      const h = heightAt(id);
      if (prevId >= 0) {
        if (h === undefined || prevH === undefined) return -1;
        const d = stepM(stepX, prevY, y0 - prevY), rise = Math.abs(h - prevH);
        if (rise > d * maxSlopeRatio) return -1;
        cost += hf * (speedAt ? Math.hypot(d, rise) / speedAt((h - prevH) / d) : Math.hypot(d, rise));
      }
      prevId = id; prevH = h; prevY = y0;
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      stepX = 0;
      if (e2 >= dy) { err += dy; x0 += sx; stepX = sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return cost;
  };
  let stepX = 0; // x step of the last Bresenham move (used by segmentCost)
  // The cells of a line (only needed to rebuild the final path).
  const rasterLine = (from, to) => {
    let x0 = from % width, y0 = Math.floor(from / width), x1 = to % width;
    const y1 = Math.floor(to / width);
    if (wrapX && Math.abs(x1 - x0) > width / 2) x1 += x1 < x0 ? width : -width;
    const line = [], dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      line.push((y0 * width) + ((x0 % width + width) % width));
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return line;
  };

  if (cellSlope(startId) > maxSlopeDeg || cellSlope(goalId) > maxSlopeDeg) return null;
  // A start or goal inside a blocked hazard zone can never be joined: say so now, instead of
  // searching everything reachable from the start first (seconds on a large grid). Same result.
  if (HZ.any && (HZ.factor(startId) < 0 || HZ.factor(goalId) < 0)) return null;
  g[slotOf(startId)] = 0;
  push([heuristic(start.x, start.y), 0, startId]);
  const MX = [-1, 0, 1, -1, 1, -1, 0, 1], MY = [-1, -1, -1, 0, 0, 1, 1, 1];
  // Shortcuts are straight lines in lon/lat, which on the sphere drift away from the true
  // shortest (great-circle) line as they get longer. Capping their length makes a long leg a
  // chain of short straight pieces that can bend with the sphere and follow the great circle.
  const MAX_SHORTCUT_CELLS = 48;
  const shortSpan = (fromId, tx, ty) => {
    const fx = fromId % width;
    let ddx = Math.abs(tx - fx);
    if (wrapX && ddx > width / 2) ddx = width - ddx;
    return ddx <= MAX_SHORTCUT_CELLS && Math.abs(ty - (fromId - fx) / width) <= MAX_SHORTCUT_CELLS;
  };
  let expanded = 0, sliceStart = performance.now();
  while (heap.length) {
    if (signal?.aborted || shouldCancel()) return null;
    if ((++expanded & 255) === 0) {
      if ((expanded & 4095) === 0) onProgress?.({ expanded });
      if (performance.now() - sliceStart > 12) {          // keep the page responsive
        await yieldToBrowser();
        if (signal?.aborted || shouldCancel()) return null;
        sliceStart = performance.now();
      }
    }
    const [, currentCost, id] = pop();
    const sid = slotOf(id);
    if (closed[sid] || currentCost !== g[sid]) continue;
    if (id === goalId) {
      const anchors = [];
      for (let at = id; at !== -1; at = parent[slotOf(at)]) anchors.push(at);
      anchors.reverse();
      const ids = [];
      const displayPath = [];
      const turnIndices = [];
      for (let i = 1; i < anchors.length; i++) {
        const from = anchors[i - 1], to = anchors[i], line = rasterLine(from, to);
        if (i > 1) turnIndices.push(displayPath.length - 1);
        ids.push(...line.slice(ids.length ? 1 : 0));
        const ax = from % width, ay = Math.floor(from / width);
        let bx = to % width;
        const by = Math.floor(to / width);
        if (wrapX && Math.abs(bx - ax) > width / 2) bx += bx < ax ? width : -width;
        const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
        const a = pos(ax, ay), b = pos(to % width, by);
        let dLon = b.lon - a.lon;
        if (dLon > Math.PI) dLon -= 2 * Math.PI;
        else if (dLon < -Math.PI) dLon += 2 * Math.PI;
        for (let k = displayPath.length ? 1 : 0; k < line.length; k++) {
          const cell = line[k];
          let cx = cell % width;
          if (wrapX && Math.abs(cx - ax) > width / 2) cx += cx < ax ? width : -width;
          const cy = Math.floor(cell / width);
          const t = length2 ? Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy) / length2)) : 0;
          displayPath.push({
            x: cx, y: cy,
            lon: (a.lon + dLon * t) / RAD,
            lat: (a.lat + (b.lat - a.lat) * t) / RAD,
            elevationM: heightAt(cell),
          });
        }
      }
      if (!ids.length) ids.push(startId);
      let horizontalDistanceM = 0, surfaceM = 0;
      const path = ids.map((at, i) => {
        const x = at % width, y = Math.floor(at / width);
        if (i) {
          const prev = ids[i - 1], dh = horizontal(prev % width, Math.floor(prev / width), x, y);
          horizontalDistanceM += dh; surfaceM += Math.hypot(dh, heightAt(at) - heightAt(prev));
        }
        const ll = pos(x, y);
        return { x, y, lon: ll.lon / RAD, lat: ll.lat / RAD, elevationM: heightAt(at) };
      });
      if (!displayPath.length) displayPath.push(path[0]);
      return { path, displayPath, turnIndices, horizontalDistanceM, expanded,
        terrainDistanceM: speedAt || HZ.any ? surfaceM : currentCost,
        ...(speedAt ? { travelTimeS: HZ.any ? undefined : currentCost } : {}), ...(HZ.any ? { weightedCost: currentCost } : {}) };
    }
    closed[sid] = 1;
    const x = id % width, y = (id - x) / width;
    const parentId = parent[sid];
    const parentG = parentId === -1 ? 0 : g[slotOf(parentId)];
    for (let m = 0; m < 8; m++) {
      let nx = x + MX[m];
      const ny = y + MY[m];
      if (wrapX) nx = (nx + width) % width;
      else if (nx < 0 || nx >= width) continue;
      if (ny < 0 || ny >= height) continue;
      const next = ny * width + nx;
      const nsid = slotOf(next);
      if (nsid < 0 || closed[nsid]) continue;
      if (cellSlope(next) > maxSlopeDeg) continue;
      if (HZ.any && HZ.factor(next) < 0) continue;
      let via = id, stepCost = segmentCost(id, next);
      if (parentId !== -1 && shortSpan(parentId, nx, ny)) {
        const shortcut = segmentCost(parentId, next);
        if (shortcut >= 0 && parentG + shortcut < currentCost + (stepCost >= 0 ? stepCost : Infinity)) {
          via = parentId; stepCost = shortcut;
        }
      }
      if (stepCost < 0) continue;
      const tentative = (via === id ? currentCost : parentG) + stepCost;
      if (tentative >= g[nsid]) continue;
      g[nsid] = tentative; parent[nsid] = via;
      push([tentative + heuristic(nx, ny), tentative, next]);
    }
  }
  return null;
}

// Remove grid zig-zags only when a terrain-sampled shortcut respects the slope limit
// and costs no more surface distance than the original path section.
export function smoothTerrainPath(grid, path, maxSlopeDeg) {
  if (path.length < 3) return path;
  const { width, heights, wrapX, westDeg, northDeg, lonStepDeg, latStepDeg } = grid;
  const dense = heights instanceof Float32Array;
  const heightAt = (x, y) => {
    if (wrapX) x = (x + width) % width;
    if (x < 0 || x >= width || y < 0 || y >= grid.height) return undefined;
    const id = y * width + x;
    return dense ? heights[id] : heights.get(id);
  };
  const horizontal = (a, b) => {
    const latA = (northDeg + a.y * latStepDeg) * RAD;
    const latB = (northDeg + b.y * latStepDeg) * RAD;
    let dLon = (b.x - a.x) * lonStepDeg * RAD;
    if (dLon > Math.PI) dLon -= 2 * Math.PI;
    else if (dLon < -Math.PI) dLon += 2 * Math.PI;
    return Math.hypot(dLon * 3_396_190 * Math.cos((latA + latB) / 2),
      (latB - latA) * 3_396_190);
  };
  const rasterLine = (a, b) => {
    let x0 = a.x, y0 = a.y, x1 = b.x, y1 = b.y;
    if (wrapX && Math.abs(x1 - x0) > width / 2) x1 += x1 < x0 ? width : -width;
    const points = [], dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      points.push({ x: wrapX ? (x0 + width) % width : x0, y: y0 });
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return points;
  };
  const segmentCost = (a, b) => {
    const run = rasterLine(a, b);
    let cost = 0;
    for (let k = 1; k < run.length; k++) {
      const prev = run[k - 1], next = run[k];
      const h0 = heightAt(prev.x, prev.y), h1 = heightAt(next.x, next.y);
      if (h0 === undefined || h1 === undefined) return null;
      const d = horizontal(prev, next), rise = Math.abs(h1 - h0);
      if (rise > d * Math.tan(maxSlopeDeg * RAD)) return null;
      cost += Math.hypot(d, rise);
    }
    return { cost, run };
  };
  const prefix = new Float64Array(path.length);
  for (let i = 1; i < path.length; i++) {
    const d = horizontal(path[i - 1], path[i]);
    prefix[i] = prefix[i - 1] + Math.hypot(d, path[i].elevationM - path[i - 1].elevationM);
  }

  const output = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let chosen = i + 1, chosenRun = null;
    const furthest = Math.min(path.length - 1, i + 16);
    for (let j = furthest; j > i + 1; j--) {
      const shortcut = segmentCost(path[i], path[j]);
      if (shortcut && shortcut.cost <= prefix[j] - prefix[i] + 1e-3) {
        chosen = j; chosenRun = shortcut.run; break;
      }
    }
    if (chosenRun) {
      for (let k = 1; k < chosenRun.length; k++) {
        const p = chosenRun[k], elevationM = heightAt(p.x, p.y);
        const lon = westDeg + p.x * lonStepDeg;
        const lat = northDeg + p.y * latStepDeg;
        output.push({ x: p.x, y: p.y, lon, lat, elevationM });
      }
    } else output.push(path[chosen]);
    i = chosen;
  }
  return output;
}

// ---------------------------------------------------------------- route explanation
// Why does the route between two stops look the way it does? Walks the direct line from start
// to goal on the grid and reports every constraint that line breaks (blocked) or pays for
// (slowed), with the worst value and where it happens; then compares the planned route with
// that line (detour ratio) and lists the hazards the planned route itself crosses.
//   result: the planTerrainRoute result for this leg, or null when no route was found.
// Returns { straightM, blocked: [reason], slowed: [reason], onRoute: [reason], detourRatio }
//   reason = { id, label, count, km, worst, worstText, limit, at: { lon, lat } }
export function explainLeg(grid, start, goal, { maxSlopeDeg = Infinity, hazards = [], result = null } = {}) {
  const T = gridTools(grid);
  const { width } = grid;
  const list = (hazards || []).filter(Boolean);
  const maxSlopeRatio = Math.tan(maxSlopeDeg * RAD);
  const blocked = new Map(), slowed = new Map(), onRoute = new Map();
  const note = (map, id, label, value, worse, text, limit, cellId, stepLenM) => {
    let r = map.get(id);
    if (!r) map.set(id, r = { id, label, count: 0, km: 0, worst: value, worstText: text, limit, at: cellLonLat(grid, cellId) });
    r.count++; r.km += stepLenM / 1000;
    if (worse(value, r.worst)) { r.worst = value; r.worstText = text; r.at = cellLonLat(grid, cellId); }
  };
  const higher = (a, b) => a > b, lower = (a, b) => a < b;
  // classify one cell (and the step into it) against every constraint
  const classify = (id, prevId, stepLenM, target) => {
    const k = T.slotOf(id), h = k < 0 ? undefined : T.heightAt(id);
    if (h === undefined) { note(blocked, "nodata", "no terrain data", 1, higher, "no MOLA heights here", "", id, stepLenM); return; }
    const slope = T.cellSlope(id);
    if (slope > maxSlopeDeg) note(blocked, "slope", "slope too steep", slope, higher, `slope ${slope.toFixed(1)}°`, `limit ${maxSlopeDeg}°`, id, stepLenM);
    if (prevId >= 0 && stepLenM > 0) {
      const hp = T.heightAt(prevId);
      if (hp !== undefined && Math.abs(h - hp) > stepLenM * maxSlopeRatio) {
        const deg = Math.atan(Math.abs(h - hp) / stepLenM) / RAD;
        note(blocked, "climb", "climb / drop too steep", deg, higher, `${deg.toFixed(1)}° between cells`, `limit ${maxSlopeDeg}°`, id, stepLenM);
      }
    }
    const { lon, lat } = cellLonLat(grid, id);
    for (const hz of list) {
      const v = hz.valueAt(id, lon, lat);
      if (v === undefined || v === null || Number.isNaN(v)) continue;
      const worse = hz.lowIsBad ? lower : higher;
      if (hz.blocks?.(v)) note(target ?? blocked, hz.id, hz.label, v, worse, hz.describe(v), hz.limit ?? "", id, stepLenM);
      else if (hz.factor && hz.factor(v) >= 1.1) note(target ?? slowed, hz.id, `${hz.label} (slower)`, v, worse, hz.describe(v), `×${hz.factor(v).toFixed(2)} cost`, id, stepLenM);
    }
  };
  // direct line (Bresenham, wrap-aware), same raster the planner uses for its shortcuts
  let x0 = start.x, y0 = start.y, x1 = goal.x;
  const y1 = goal.y;
  if (grid.wrapX && Math.abs(x1 - x0) > width / 2) x1 += x1 < x0 ? width : -width;
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1, dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, prevId = -1, prevY = y0, straightM = 0, stepX = 0;
  for (;;) {
    const id = y0 * width + ((x0 % width + width) % width);
    const len = prevId >= 0 ? T.stepM(stepX, prevY, y0 - prevY) : 0;
    straightM += len;
    classify(id, prevId, len);
    prevId = id; prevY = y0;
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    stepX = 0;
    if (e2 >= dy) { err += dy; x0 += sx; stepX = sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  // hazards the planned route itself still crosses (slowed cells it accepted)
  if (result?.path?.length && list.length) {
    let prev = null;
    for (const p of result.path) {
      const id = p.y * width + p.x;
      const len = prev ? T.stepM(Math.sign(p.x - prev.x), prev.y, p.y - prev.y) : 0;
      const { lon, lat } = cellLonLat(grid, id);
      for (const hz of list) {
        const v = hz.valueAt(id, lon, lat);
        if (v === undefined || v === null || Number.isNaN(v) || !hz.factor || hz.factor(v) < 1.1) continue;
        note(onRoute, hz.id, hz.label, v, hz.lowIsBad ? lower : higher, hz.describe(v), `×${hz.factor(v).toFixed(2)} cost`, id, len);
      }
      prev = p;
    }
  }
  const sorted = (m) => [...m.values()].sort((a, b) => b.count - a.count);
  return {
    straightM,
    blocked: sorted(blocked), slowed: sorted(slowed), onRoute: sorted(onRoute),
    // horizontal vs horizontal, so climbing does not count as a detour
    detourRatio: result && straightM > 0 ? (result.horizontalDistanceM ?? result.terrainDistanceM) / straightM : null,
  };
}
