// Surface hazard layers for the route planner, decoded from NASA Trek map tiles.
//
// Trek serves these TES maps as colour-ramped PNGs, not as numbers. The ramp runs from purple
// (low end of the layer's legend) through blue, green and yellow to red (high end); this was
// checked on 2026-11-15 against regions with well-known values (Tharsis / Amazonis = dusty,
// low thermal inertia, purple; Acidalia / Chryse = rocky, high thermal inertia, green-yellow).
// So a pixel's hue gives a RELATIVE index 0..1 along the legend, not a calibrated physical
// value. The UI says so. Thresholds are in docs/assumptions.md and editable in Settings.
//
// Thermal-inertia units, rough: agent:yasser decoded the tile at three landed sites with
// published values (#29, 2026-11-15): Meridiani index 0.36 ~ 211 TIU (Golombek et al. 2003),
// Gusev 0.45 ~ 307 TIU (Golombek et al. 2003; Jakosky et al. 2006), Gale 0.67 ~ 330 TIU
// (Fergason et al. 2012, THEMIS). Linear fit TI = 121 + 327 * index (rms 28 TIU); a log fit is
// as good, so the shape of the ramp is unknown, and the bottom of the ramp (index 0) is
// ~120-150 TIU, with no dust-low anchor. So the soft-dust hazard is defined on the index itself
// ("near the bottom of the colour ramp = dust-dominated"); TIU are shown only as a rough guide.
export const TI_FIT = Object.freeze({ a: 121, b: 327 });
export const tiFromIndex = (v) => TI_FIT.a + TI_FIT.b * v;

// Default thresholds; every one can be changed in Settings > Route hazards.
export const HAZARD_DEFAULTS = Object.freeze({
  roughBlockM: 400, roughFreeM: 40, roughDoubleM: 200,  // m, calibrated on MOLA z6 (assumptions.md)
  softBlockIdx: 10,    // % of the thermal-inertia colour ramp: bottom tenth = dust-dominated (qualitative)
  softSlowIdx: 25,     // % : below this, costlier (every landed site is above 35 %)
  softSlowMax: 1.6,    // cost multiplier just above the block line, ASSUMED
  dustSlowAbove: 60,   // % of the TES dust scale, ASSUMED (no calibration found)
  dustSlowMax: 1.3,    // ASSUMED
  tempMinC: -129,      // degC, coldest worst-case Mars surface temperature at EVA-realistic sites (ICES-2026-126 Table 3: 144 K)
  tempMaxC: 39,        // degC, hottest worst-case Mars surface temperature at those sites (ICES-2026-126 Table 3: 312 K)
});

export const HAZARD_LAYERS = Object.freeze({
  softDust: {
    dataset: "TES_Thermal_Inertia", level: 1,
    id: "softDust", label: "soft dust (low thermal inertia)", lowIsBad: true,
    source: "TES thermal inertia (Putzig et al. 2005) via NASA Trek, orbital ~3 km/px served at ~21 km/px; qualitative (decoded from map colours)",
    // low thermal inertia = loose fine dust / sand that can bog down a rover or a walker
    blockBelow: HAZARD_DEFAULTS.softBlockIdx / 100, slowBelow: HAZARD_DEFAULTS.softSlowIdx / 100, slowMax: HAZARD_DEFAULTS.softSlowMax,
  },
  dustCover: {
    dataset: "TES_Dust", level: 1,
    id: "dustCover", label: "dust-covered surface", lowIsBad: false,
    source: "TES dust cover index (Ruff & Christensen 2002) via NASA Trek, ~21 km/px; qualitative (decoded from map colours)",
    // dusty ground: poor footing, dust on suits and panels; never blocks, only costs more
    slowAbove: HAZARD_DEFAULTS.dustSlowAbove / 100, slowMax: HAZARD_DEFAULTS.dustSlowMax,
  },
});

function hueIndex(r, g, b, a) {
  if (a < 128) return undefined;                     // transparent = no data
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (max === 0 || d / max < 0.25) return undefined; // grey / black = background, not the ramp
  let h;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h > 300) return 0;                              // magenta tail = bottom of the ramp
  return Math.max(0, Math.min(1, (262 - h) / 262));  // purple (≈262°) = 0 … red (0°) = 1
}

async function decodeTile(url, signal) {
  const response = await fetch(url, { signal, cache: "force-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(bitmap.width, bitmap.height)
    : Object.assign(document.createElement("canvas"), { width: bitmap.width, height: bitmap.height });
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) {
    const v = hueIndex(data[4 * i], data[4 * i + 1], data[4 * i + 2], data[4 * i + 3]);
    out[i] = v === undefined ? NaN : v;
  }
  return { width, height, values: out };
}

const tileCache = new Map(); // url -> Promise<tile>

// Load the tiles of one layer that cover bounds {west, south, east, north} and return a
// sampler sample(lon, lat) -> relative index 0..1, or undefined where there is no data.
export async function loadHazardRaster(key, bounds, { tileBase, signal } = {}) {
  const L = HAZARD_LAYERS[key];
  if (!L) throw new Error(`unknown hazard layer ${key}`);
  const z = L.level, cols = 2 ** (z + 1), rows = 2 ** z, tw = 360 / cols, th = 180 / rows;
  const urlOf = (tx, ty) => `${tileBase}/Mars/EQ/${L.dataset}/1.0.0/default/default028mm/${z}/${ty}/${tx}.png`;
  const txs = new Set();
  let w = bounds.west, e = bounds.east;
  if (e < w) e += 360;
  for (let lon = w; lon <= e + tw; lon += tw) txs.add(((Math.floor((((lon + 180) % 360) + 360) % 360 / tw)) % cols));
  const ty0 = Math.max(0, Math.floor((90 - bounds.north) / th)), ty1 = Math.min(rows - 1, Math.floor((90 - bounds.south) / th));
  const tiles = new Map();
  const jobs = [];
  for (const tx of txs) for (let ty = ty0; ty <= ty1; ty++) {
    const url = urlOf(tx, ty);
    if (!tileCache.has(url)) tileCache.set(url, decodeTile(url, signal).catch((err) => { tileCache.delete(url); throw err; }));
    jobs.push(tileCache.get(url).then((t) => tiles.set(`${tx},${ty}`, t)));
  }
  await Promise.all(jobs);
  const sample = (lon, lat) => {
    const u = ((((lon + 180) % 360) + 360) % 360) / tw, v = (90 - lat) / th;
    const tx = Math.min(cols - 1, Math.floor(u)), ty = Math.max(0, Math.min(rows - 1, Math.floor(v)));
    const t = tiles.get(`${tx},${ty}`);
    if (!t) return undefined;
    const px = Math.min(t.width - 1, Math.floor((u - tx) * t.width)), py = Math.min(t.height - 1, Math.floor((v - ty) * t.height));
    const val = t.values[py * t.width + px];
    return Number.isNaN(val) ? undefined : val;
  };
  return { ...L, sample };
}

// Planner hazard (see pathfinding.js "hazards") from a loaded raster.
//   t: thresholds from Settings (HAZARD_DEFAULTS keys); missing keys use the defaults.
export function rasterHazard(raster, t = {}) {
  const T = { ...HAZARD_DEFAULTS, ...t };
  const L = raster.id === "softDust"
    ? { ...raster, blockBelow: T.softBlockIdx / 100, slowBelow: Math.max(T.softBlockIdx / 100 + 1e-6, T.softSlowIdx / 100), slowMax: T.softSlowMax }
    : raster.id === "dustCover"
      ? { ...raster, slowAbove: Math.min(0.999, T.dustSlowAbove / 100), slowMax: T.dustSlowMax }
      : raster;
  const pct = (v) => `${Math.round(v * 100)}% of the map's scale`;
  if (L.lowIsBad) return {
    id: L.id, label: L.label, unit: "index", lowIsBad: true,
    valueAt: (_id, lon, lat) => raster.sample(lon, lat),
    blocks: (v) => v < L.blockBelow,
    factor: (v) => v >= L.slowBelow ? 1 : 1 + (L.slowMax - 1) * (L.slowBelow - v) / (L.slowBelow - L.blockBelow),
    describe: (v) => v < 0.02 ? "below the map's lowest colour (dust-dominated)"
      : `thermal inertia index ${Math.round(v * 100)}% (\u2248${Math.round(tiFromIndex(v))} TIU, rough)`,
    limit: `blocked below ${Math.round(L.blockBelow * 100)}% of the colour ramp`,
    source: L.source,
  };
  return {
    id: L.id, label: L.label, unit: "index", lowIsBad: false,
    valueAt: (_id, lon, lat) => raster.sample(lon, lat),
    blocks: () => false,
    factor: (v) => v <= L.slowAbove ? 1 : 1 + (L.slowMax - 1) * (v - L.slowAbove) / (1 - L.slowAbove),
    describe: (v) => `dust index ${pct(v)}`,
    limit: "",
    source: L.source,
  };
}

// Whole-route temperature check. There is no global surface-temperature map in the data the
// app uses; the only measured temperatures are Curiosity REMS at Gale. So: near Gale, compare
// the latest sol's ground-temperature range with the suit limits; elsewhere, say there is no data.
// Default limits = the Mars EVA design envelope, not a rating of any real suit: the worst-case
// cold / hot surface temperatures that NASA's Mars PLSS study found at EVA-realistic sites
// (ICES-2026-126, Table 3: 144 K to 312 K). Editable in Settings.
export const SUIT_GROUND_TEMP_C = Object.freeze({ min: HAZARD_DEFAULTS.tempMinC, max: HAZARD_DEFAULTS.tempMaxC });
const GALE = { lon: 137.4, lat: -5.4, radiusKm: 90 };
export function temperatureCheck(path, rems, limits = SUIT_GROUND_TEMP_C) {
  if (!path?.length) return null;
  const R = 3396.19, rad = Math.PI / 180;
  const near = path.every((p) => {
    const dLat = (p.lat - GALE.lat) * rad, dLon = (p.lon - GALE.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(p.lat * rad) * Math.cos(GALE.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))) <= GALE.radiusKm;
  });
  if (!near) return { level: "info", text: "Temperature: no measured surface temperatures here (REMS covers Gale only), so temperature was not used." };
  const sol = rems?.soles?.find((s) => Number.isFinite(Number(s.min_gts_temp)) && Number.isFinite(Number(s.max_gts_temp)));
  if (!sol) return { level: "info", text: "Temperature: REMS data unavailable, so temperature was not checked." };
  const lo = Number(sol.min_gts_temp), hi = Number(sol.max_gts_temp), L = limits;
  const where = `REMS ground ${lo}…${hi} °C on sol ${sol.sol}`;
  if (hi > L.max) return { level: "refuse", text: `Temperature too high: ${where}, suit limit ${L.max} °C.` };
  if (lo < L.min) return { level: "warn", text: `Temperature too low at night: ${where}, suit limit ${L.min} °C. Daytime EVA only.` };
  return { level: "ok", text: `Temperature OK: ${where} (suit limits ${L.min}…${L.max} °C). Same for the whole route: one weather station.` };
}
