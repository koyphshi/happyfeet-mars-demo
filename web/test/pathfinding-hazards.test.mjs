import test from "node:test";
import assert from "node:assert/strict";
import { planTerrainRoute, explainLeg, roughnessHazard } from "../pathfinding.js";
import { rasterHazard, temperatureCheck, tiFromIndex, indexFromTi, HAZARD_DEFAULTS } from "../hazards.js";

// 61 x 31 flat cells of ~59 m near Gale, with optional features
function grid(fill = () => 0) {
  const width = 61, height = 31, step = 0.001;
  const heights = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) heights[y * width + x] = fill(x, y);
  return { width, height, heights, westDeg: 137.37, northDeg: -4.78, lonStepDeg: step, latStepDeg: -step, level: 0 };
}
const S = { x: 2, y: 15 }, G = { x: 58, y: 15 };
// a hazard that blocks a vertical band x = 28..32 except a gap near the top (y < 4)
const band = {
  id: "band", label: "test band", valueAt: (id) => { const x = id % 61, y = Math.floor(id / 61); return x >= 28 && x <= 32 && y >= 4 ? 1 : 0; },
  blocks: (v) => v === 1, factor: () => 1, describe: (v) => `band ${v}`, limit: "no band",
};

test("a blocking hazard makes the route detour, and explainLeg says why", async () => {
  const g = grid();
  const direct = await planTerrainRoute(g, S, G, { maxSlopeDeg: 25 });
  const detour = await planTerrainRoute(g, S, G, { maxSlopeDeg: 25, hazards: [band] });
  assert.ok(direct && detour);
  assert.ok(detour.terrainDistanceM > direct.terrainDistanceM * 1.1, "detours through the gap");
  assert.ok(detour.path.every((p) => !(p.x >= 28 && p.x <= 32 && p.y >= 4)), "never enters a blocked cell");
  const E = explainLeg(g, S, G, { maxSlopeDeg: 25, hazards: [band], result: detour });
  assert.equal(E.blocked[0].id, "band");
  assert.equal(E.blocked[0].count, 5);
  assert.ok(E.detourRatio > 1.1);
  const clear = explainLeg(g, S, G, { maxSlopeDeg: 25, result: direct });
  assert.equal(clear.blocked.length, 0);
});

test("a steep wall with no gap: no route, and the reason is the slope", async () => {
  const g = grid((x) => (x >= 30 ? 400 : 0)); // 400 m cliff over one ~59 m cell
  const r = await planTerrainRoute(g, S, G, { maxSlopeDeg: 25 });
  assert.equal(r, null);
  const E = explainLeg(g, S, G, { maxSlopeDeg: 25, result: null });
  const ids = E.blocked.map((b) => b.id);
  assert.ok(ids.includes("slope") || ids.includes("climb"), `got ${ids}`);
  const worst = E.blocked.find((b) => b.id === "slope") ?? E.blocked[0];
  assert.ok(worst.worst > 25 && worst.at && Number.isFinite(worst.at.lon));
});

test("roughness is 0 on a tilted plane and high on bumps", () => {
  const plane = roughnessHazard(grid((x, y) => 3 * x + 2 * y));
  assert.ok(plane.valueAt(15 * 61 + 30) < 1e-3);
  const bumpy = roughnessHazard(grid((x, y) => ((x + y) % 2 ? 200 : 0)));
  assert.ok(bumpy.valueAt(15 * 61 + 30) > 90);
  assert.ok(bumpy.factor(100) > 1 && bumpy.factor(30) === 1 && bumpy.blocks(500) && !bumpy.blocks(200));
});

test("slow cells cost more but stay admissible: route still found, avoids them when cheap", async () => {
  const slow = { ...band, id: "slow", blocks: () => false, factor: (v) => (v ? 5 : 1) };
  const r = await planTerrainRoute(grid(), S, G, { maxSlopeDeg: 25, hazards: [slow] });
  assert.ok(r);
  const crossed = r.path.filter((p) => p.x >= 28 && p.x <= 32 && p.y >= 4).length;
  assert.equal(crossed, 0, "goes round through the gap rather than paying x5");
});

test("raster hazards: soft dust blocks low index, dust cover only slows", () => {
  const soft = rasterHazard({ id: "softDust", label: "soft dust", lowIsBad: true, blockBelow: 0.12, slowBelow: 0.25, slowMax: 1.6, sample: () => 0.05 });
  assert.ok(soft.blocks(0.05) && !soft.blocks(0.5));
  assert.equal(soft.factor(0.5), 1);
  assert.ok(soft.factor(0.25) > 1 && soft.factor(0.25) < 1.6, "between MSL block (100 TIU) and MER slow (150 TIU)");
  const dust = rasterHazard({ id: "dustCover", label: "dust", lowIsBad: false, slowAbove: 0.6, slowMax: 1.3, sample: () => 0.9 });
  assert.ok(!dust.blocks(1));
  assert.ok(Math.abs(dust.factor(1) - 1.3) < 1e-9);
});

test("temperature check: Gale uses REMS, elsewhere says no data", () => {
  const rems = { soles: [{ sol: "4995", min_gts_temp: "-84", max_gts_temp: "4" }] };
  assert.equal(temperatureCheck([{ lon: 137.4, lat: -4.8 }], rems).level, "ok");
  assert.equal(temperatureCheck([{ lon: 137.4, lat: -4.8 }], { soles: [{ sol: "1", min_gts_temp: "-90", max_gts_temp: "55" }] }).level, "refuse");
  assert.equal(temperatureCheck([{ lon: -110, lat: 0 }], rems).level, "info");
});

test("Settings thresholds override the defaults", () => {
  const raster = { id: "softDust", label: "soft dust", lowIsBad: true, sample: () => 0 };
  const strict = rasterHazard(raster, { softBlockTi: 300 }), loose = rasterHazard(raster, { softBlockTi: 20, softSlowTi: 40 });
  const gale = indexFromTi(330), meridiani = 0.36;
  assert.ok(!rasterHazard(raster).blocks(meridiani), "default lets every landed site through");
  assert.ok(strict.blocks(meridiani) && !strict.blocks(gale));
  assert.ok(!loose.blocks(0.1) && loose.factor(0.1) === 1);
  assert.ok(Math.abs(tiFromIndex(0.67) - 330) < 1e-9);
  const cold = temperatureCheck([{ lon: 137.4, lat: -4.8 }], { soles: [{ sol: "1", min_gts_temp: "-84", max_gts_temp: "4" }] }, { min: -50, max: 40 });
  assert.equal(cold.level, "warn");
  assert.equal(HAZARD_DEFAULTS.tempMinC, -129);
  const rough = roughnessHazard(grid(), { blockM: 50, slowFromM: 0, slowPerM: 1 / 10 });
  assert.ok(rough.blocks(60) && rough.factor(20) === 3);
});
