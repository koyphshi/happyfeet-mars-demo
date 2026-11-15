import test from "node:test";
import assert from "node:assert/strict";
import { planTerrainRoute } from "../pathfinding.js";
import { walkingSpeed, segmentsOf } from "../survival.js";

// 81 x 41 cells of ~59 m near the equator, with a 150 m hill between start and goal
function hillGrid() {
  const width = 81, height = 41, step = 0.001;
  const heights = new Float32Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const r2 = ((x - 40) ** 2 + (y - 20) ** 2) / 120;
    heights[y * width + x] = 150 * Math.exp(-r2);
  }
  return { width, height, heights, westDeg: 0, northDeg: 0.02, lonStepDeg: step, latStepDeg: -step, level: 0 };
}
const walkTime = (path) => segmentsOf(path).reduce((s, g) => s + (g.t || 0), 0);

test("time mode never walks slower than the shortest-distance route", async () => {
  const grid = hillGrid(), start = { x: 2, y: 20 }, goal = { x: 78, y: 20 };
  const dist = await planTerrainRoute(grid, start, goal, { maxSlopeDeg: 30 });
  const fast = await planTerrainRoute(grid, start, goal, { maxSlopeDeg: 30, speedAt: (g) => walkingSpeed(g) });
  assert.ok(dist && fast);
  assert.ok(Number.isFinite(fast.travelTimeS) && fast.travelTimeS > 0);
  assert.equal(dist.travelTimeS, undefined);
  assert.ok(fast.terrainDistanceM >= dist.terrainDistanceM - 1, "distance mode is the shortest");
  assert.ok(walkTime(fast.path) <= walkTime(dist.path) + 1, "time mode is the fastest");
});

test("flat ground: time = distance / flat-ish speed", async () => {
  const grid = hillGrid(); grid.heights.fill(0);
  const r = await planTerrainRoute(grid, { x: 2, y: 5 }, { x: 78, y: 5 }, { speedAt: (g) => walkingSpeed(g) });
  assert.ok(Math.abs(r.travelTimeS - r.terrainDistanceM / walkingSpeed(0)) < 1);
});
