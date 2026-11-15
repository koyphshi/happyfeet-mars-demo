// route.json: the one artifact the map, the VR page and the integrity check all share.
// Schema: docs/route-schema.md (schema "happyfeet.route/1"). Pure functions, no Cesium, no DOM.
import { evaluateRoute, commsVisibility, SURVIVAL_PARAMS, DEFAULT_CREW, surfaceDistanceM } from "./survival.js";

export const ROUTE_SCHEMA = "happyfeet.route/1";

// Height lookup on a pathfinding.js grid (dense patch or sparse corridor), bilinear between
// samples. Returns undefined where the grid has no data.
export function gridHeightSampler(grid) {
  if (!grid) return () => undefined;
  const { width, height, heights, wrapX, westDeg, northDeg, lonStepDeg, latStepDeg } = grid;
  const dense = heights instanceof Float32Array;
  const at = (x, y) => {
    if (wrapX) x = ((x % width) + width) % width;
    if (x < 0 || x >= width || y < 0 || y >= height) return undefined;
    const id = y * width + x;
    return dense ? heights[id] : heights.get(id);
  };
  return (lon, lat) => {
    let fx = (lon - westDeg) / lonStepDeg;
    if (wrapX) fx = ((fx % width) + width) % width;
    const fy = (lat - northDeg) / latStepDeg;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const h00 = at(x0, y0), h10 = at(x0 + 1, y0), h01 = at(x0, y0 + 1), h11 = at(x0 + 1, y0 + 1);
    if ([h00, h10, h01, h11].some((h) => h === undefined)) return at(Math.round(fx), Math.round(fy));
    return (h00 * (1 - tx) + h10 * tx) * (1 - ty) + (h01 * (1 - tx) + h11 * tx) * ty;
  };
}

// A small regular height grid around the route (row 0 = north), for VR and offline replay.
export function terrainExcerpt(path, heightAt, { pad = 0.02, maxN = 128, source = "" } = {}) {
  const lons = path.map((p) => p.lon), lats = path.map((p) => p.lat);
  const west = Math.min(...lons) - pad, east = Math.max(...lons) + pad;
  const south = Math.min(...lats) - pad, north = Math.max(...lats) + pad;
  const wM = surfaceDistanceM({ lon: west, lat: (north + south) / 2 }, { lon: east, lat: (north + south) / 2 });
  const hM = surfaceDistanceM({ lon: west, lat: south }, { lon: west, lat: north });
  const cols = Math.max(2, Math.min(maxN, Math.round((maxN * wM) / Math.max(wM, hM))));
  const rows = Math.max(2, Math.min(maxN, Math.round((maxN * hM) / Math.max(wM, hM))));
  const heights = [];
  let missing = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const h = heightAt(west + ((east - west) * c) / (cols - 1), north - ((north - south) * r) / (rows - 1));
    if (h === undefined || !Number.isFinite(h)) { missing++; heights.push(null); } else heights.push(Math.round(h * 10) / 10);
  }
  return {
    bounds: { west, south, east, north }, cols, rows, width_m: Math.round(wM), height_m: Math.round(hM),
    heights, missing, units: "m above MOLA areoid", source,
    note: "Resampled from the planner's MOLA grid (km-scale). Visualization, not a surveyed DEM.",
  };
}

// Stop indices inside path for the waypoints (nearest path point, searched in order).
export function stopIndices(path, waypoints) {
  const out = [];
  let from = 0;
  for (const w of waypoints) {
    let best = from, bestD = Infinity;
    for (let i = from; i < path.length; i++) {
      const d = surfaceDistanceM(path[i], w);
      if (d < bestD) { bestD = d; best = i; }
    }
    out.push(best);
    from = best;
  }
  return out;
}

// Build the route.json object.
//   path: [{lon, lat, elevationM}]  waypoints: [{name, lon, lat, kind?}] (first = haven)
export function buildRoute({ path, waypoints, grid = null, heightAt = null, crew = DEFAULT_CREW, params = {}, scenario = "standard", meta = {} }) {
  const sampler = heightAt || gridHeightSampler(grid);
  const idx = stopIndices(path, waypoints);
  const stops = waypoints.slice(1).map((w, k) => ({ name: w.name ?? `Stop ${k + 1}`, index: idx[k + 1], ...(w.role === "haven" ? { dwell_s: 0 } : {}) }));
  const visible = commsVisibility(path, sampler, { ...SURVIVAL_PARAMS, ...params });
  const survival = evaluateRoute(path, stops, { crew, params, visible });
  const source = grid?.source ?? meta.terrain_source ?? "unknown";
  return {
    schema: ROUTE_SCHEMA,
    generated_at: meta.generated_at ?? new Date().toISOString(),
    generator: meta.generator ?? "happyfeet-mars-trip web/route-io.js",
    site: meta.site ?? "Gale crater, boxwork unit (Curiosity campaign area)",
    label: meta.label ?? "",
    profile: { mobility: "suited walking, crew of two", scenario, max_slope_deg: survival.params.max_slope_deg, grid_level: grid?.level ?? null, terrain_source: source },
    crew,
    params: survival.params,
    waypoints: waypoints.map((w, k) => ({ name: w.name ?? (k ? `Stop ${k}` : "Haven"), role: k === 0 ? "haven" : (w.role ?? "science"), lon: w.lon, lat: w.lat, index: idx[k] })),
    path: path.map((p) => ({ lon: round(p.lon, 6), lat: round(p.lat, 6), elevation_m: round(p.elevationM ?? sampler(p.lon, p.lat) ?? 0, 1) })),
    distance_m: survival.distance_m,
    eta_s: survival.eta_s,
    timeline: survival.timeline,
    blackout: survival.blackout,
    warnings: survival.warnings,
    survival: { feasible: survival.feasible, verdict: survival.verdict, limiting: survival.limiting, crew: survival.crew, risk_cost_s: survival.risk_cost_s, return_leg: survival.returnLeg ? "outbound path reversed (upper bound)" : "loop" },
    reports: [],
    terrain: terrainExcerpt(path, sampler, { source }),
    honesty: [
      "Terrain is MOLA at kilometre scale: route geometry is indicative, not walk-scale.",
      "Consumable coefficients are ASSUMED unless docs/assumptions.md cites a source.",
    ],
  };
}

const round = (x, n) => Math.round(x * 10 ** n) / 10 ** n;

// Parse and minimally validate a route.json text/object. Throws with a readable reason.
export function parseRoute(input) {
  const r = typeof input === "string" ? JSON.parse(input) : input;
  if (!r || r.schema !== ROUTE_SCHEMA) throw new Error(`not a ${ROUTE_SCHEMA} file`);
  if (!Array.isArray(r.path) || r.path.length < 2) throw new Error("path must have at least two points");
  for (const p of r.path) if (![p.lon, p.lat, p.elevation_m].every(Number.isFinite)) throw new Error("path points need lon, lat, elevation_m");
  if (!Array.isArray(r.waypoints) || r.waypoints.length < 2) throw new Error("waypoints must have a haven and at least one stop");
  return r;
}

// Path in the planner's shape ({lon, lat, elevationM}) from a parsed route.json.
export const plannerPath = (route) => route.path.map((p) => ({ lon: p.lon, lat: p.lat, elevationM: p.elevation_m }));

// Height sampler over route.terrain (bilinear), for re-evaluating a loaded route offline.
export function excerptSampler(t) {
  if (!t?.heights) return () => undefined;
  const { west, east, south, north } = t.bounds;
  return (lon, lat) => {
    const fx = ((lon - west) / (east - west)) * (t.cols - 1), fy = ((north - lat) / (north - south)) * (t.rows - 1);
    if (fx < 0 || fy < 0 || fx > t.cols - 1 || fy > t.rows - 1) return undefined;
    const x0 = Math.min(t.cols - 2, Math.floor(fx)), y0 = Math.min(t.rows - 2, Math.floor(fy)), tx = fx - x0, ty = fy - y0;
    const g = (x, y) => t.heights[y * t.cols + x];
    const hs = [g(x0, y0), g(x0 + 1, y0), g(x0, y0 + 1), g(x0 + 1, y0 + 1)];
    if (hs.some((h) => h == null)) return undefined;
    return (hs[0] * (1 - tx) + hs[1] * tx) * (1 - ty) + (hs[2] * (1 - tx) + hs[3] * tx) * ty;
  };
}
