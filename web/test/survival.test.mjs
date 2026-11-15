import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateRoute, walkingSpeed, segmentsOf, commsVisibility, DEFAULT_CREW, SCENARIOS, SURVIVAL_PARAMS, surfaceDistanceM } from "../survival.js";

// Synthetic straight walk east along -4.787 lat (boxwork region), 3 km out, gentle climb.
function line(km, rise = 30, n = 61) {
  const lat = -4.787, lon0 = 137.393, dLon = km * 1000 / (3_396_190 * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI;
  return Array.from({ length: n }, (_, i) => ({ lon: lon0 + dLon * i / (n - 1), lat, elevationM: -4000 + rise * i / (n - 1) }));
}

test("speed is v0 on flat ground and slower uphill and on steep downhill", () => {
  assert.ok(Math.abs(walkingSpeed(0) - 2.5 / 3.6) < 1e-9);
  assert.ok(walkingSpeed(0.2) < walkingSpeed(0));
  assert.ok(walkingSpeed(-0.4) < walkingSpeed(0));
});

test("segment distances add up to the surface distance", () => {
  const p = line(3);
  const total = segmentsOf(p).reduce((s, g) => s + g.d, 0);
  assert.ok(Math.abs(total - surfaceDistanceM(p[0], p.at(-1))) < 1);
});

test("a short out-and-back is feasible with a reserve and a walk-back limit", () => {
  const p = line(3);
  const r = evaluateRoute(p, [{ name: "Ridge crest", index: 30 }, { name: "Hollow floor", index: 60 }]);
  assert.equal(r.feasible, true, r.verdict);
  assert.ok(r.verdict.startsWith("GO"));
  assert.ok(r.limiting.reserve_frac >= SURVIVAL_PARAMS.reserve_frac);
  assert.equal(r.crew.length, 2);
  for (const c of r.crew) assert.equal(c.walk_back.index, 60);
  assert.ok(Math.abs(r.distance_m - 6000) < 20);
  assert.equal(r.timeline.at(-1).name, "Haven (return)");
});

test("a long walk is refused and the reason names a crew member and a consumable", () => {
  const p = line(30, 200, 301);
  const r = evaluateRoute(p, [{ name: "Ridge crest", index: 100 }, { name: "Hollow floor", index: 200 }, { name: "Layer contact", index: 300 }]);
  assert.equal(r.feasible, false);
  assert.match(r.verdict, /^REFUSED — Crew [AB] (runs out of|would return with)/);
  assert.match(r.verdict, /oxygen|cooling water|battery/);
  // the walk-back limit is somewhere before the end
  for (const c of r.crew) assert.ok(c.walk_back.index < 300);
});

test("degraded scenario refuses the same route because of crew B's water", () => {
  const p = line(3);
  const stops = [{ name: "Ridge crest", index: 30 }, { name: "Hollow floor", index: 60 }];
  const crew = SCENARIOS.degraded_b_water.apply(DEFAULT_CREW);
  const r = evaluateRoute(p, stops, { crew });
  assert.equal(r.feasible, false);
  assert.match(r.verdict, /Crew B .*cooling water/);
});

test("steep segment is refused by the hard mask", () => {
  const p = line(0.2, 0, 3);
  p[1].elevationM += 60; // 100 m run, 60 m rise = 31 degrees
  const r = evaluateRoute(p, []);
  assert.equal(r.feasible, false);
  assert.ok(r.warnings.some((w) => w.code === "slope"));
});

test("a loop is not walked back again", () => {
  const out = line(1.5, 0, 31);
  const p = [...out, ...out.slice(0, -1).reverse()];
  const r = evaluateRoute(p, [{ name: "Turnaround", index: 30 }]);
  assert.equal(r.loop, true);
  assert.ok(Math.abs(r.distance_m - 3000) < 20);
});

test("line of sight: a wall between haven and walker creates a blackout warning", () => {
  const p = line(3, 0, 61);
  const wallLon = p[10].lon;
  const heightAt = (lon) => (Math.abs(lon - wallLon) < 0.002 ? -3900 : -4000);
  const vis = commsVisibility(p, heightAt);
  assert.equal(vis[0], true);
  assert.equal(vis[5], true);
  assert.equal(vis[40], false);
  const r = evaluateRoute(p, [], { visible: vis });
  assert.ok(r.blackout.length >= 1);
  assert.ok(r.warnings.some((w) => w.code === "blackout"));
});

// ---- environment (temperature) and densified pricing (added for agent:ahmed, #29) ----
import { environmentCheck } from "../survival.js";

test("environment: ground hotter than the suit limit refuses, colder only warns", () => {
  const p = line(3);
  const stops = [{ name: "Ridge crest", index: 30 }, { name: "Hollow floor", index: 60 }];
  const hot = evaluateRoute(p, stops, { environment: { groundMinC: -84, groundMaxC: 4, suitMinC: -129, suitMaxC: 0, source: "REMS sol 4995" } });
  assert.equal(hot.feasible, false);
  assert.match(hot.verdict, /^REFUSED — Too hot for the suit: ground -84…4 °C \(REMS sol 4995\), suit limit 0 °C\./);
  const cold = evaluateRoute(p, stops, { environment: { groundMinC: -84, groundMaxC: 4, suitMinC: -60, suitMaxC: 39 } });
  assert.equal(cold.feasible, true);
  assert.ok(cold.warnings.some((w) => w.code === "temperature_cold" && w.level === "warn"));
  const ok = evaluateRoute(p, stops, { environment: { groundMinC: -84, groundMaxC: 4, suitMinC: -129, suitMaxC: 39 } });
  assert.equal(ok.warnings.filter((w) => /temperature/.test(w.code)).length, 0);
  assert.equal(environmentCheck(null), null);
  assert.equal(environmentCheck({ groundMaxC: undefined, suitMaxC: 0 }), null); // missing data is not a refusal
});

test("densify: bumps inside a long segment cost time that end-to-end pricing misses", () => {
  const lat = -4.787, lon0 = 137.393, dLon = 3000 / (3_396_190 * Math.cos(lat * Math.PI / 180)) * 180 / Math.PI;
  const p = [{ lon: lon0, lat, elevationM: 0 }, { lon: lon0 + dLon, lat, elevationM: 0 }]; // one 3 km segment, flat end to end
  const bumpy = (lon) => 40 * Math.sin(((lon - lon0) / dLon) * Math.PI * 6);       // ±40 m hills inside it
  const coarse = segmentsOf(p)[0], fine = segmentsOf(p, undefined, { heightAt: (lon) => bumpy(lon) })[0];
  assert.equal(coarse.pieces.length, 1);
  assert.equal(fine.pieces.length, 30);
  assert.ok(fine.t > coarse.t * 1.05, `densified ${fine.t} vs ${coarse.t}`);
  assert.ok(fine.slopeDeg > coarse.slopeDeg);
  const r0 = evaluateRoute(p, []), r1 = evaluateRoute(p, [], { heightAt: (lon) => bumpy(lon) });
  assert.ok(r1.eta_s > r0.eta_s);
  assert.ok(r1.crew[1].used.o2_kg > r0.crew[1].used.o2_kg);
});

test("densify keeps indices on the original path (route.json / VR stay valid)", () => {
  const p = line(3, 30, 7);
  const r = evaluateRoute(p, [{ name: "Turn", index: 6 }], { heightAt: (lon, lat) => -4000 + 5 * Math.sin(lon * 1e4) });
  assert.equal(r.timeline[1].index, 6);
  for (const c of r.crew) assert.ok(c.walk_back.index <= 6);
});

test("densify across the ±180° seam samples the short way round", () => {
  const p = [{ lon: 179.99, lat: 0, elevationM: 0 }, { lon: -179.99, lat: 0, elevationM: 0 }]; // ~1.2 km apart
  const seen = [];
  const s = segmentsOf(p, undefined, { heightAt: (lon) => { seen.push(lon); return 0; }, densifyM: 100 })[0];
  assert.ok(s.d < 2000, `segment is short (${s.d} m)`);
  assert.ok(seen.length >= 10);
  for (const lon of seen) assert.ok(Math.abs(lon) > 179.98 && Math.abs(lon) <= 180, `sample ${lon} stays near the seam`);
});

test("densify: a vertex height from a coarser grid does not create an artificial cliff", () => {
  const p = line(1, 0, 11);                       // flat ground at -4000 m, 100 m segments
  for (let i = 0; i < p.length; i++) p.splice(i, 1, { ...p[i] });
  const q = [p[0], p[10]];                        // one 1 km segment, densified into 10 pieces
  q[1] = { ...q[1], elevationM: -3900 };          // the far vertex carries a coarse-cell height 100 m off
  const r1 = evaluateRoute(q, [], { heightAt: () => -4000 }); // sampler says flat: the last piece must not be a 45° cliff
  assert.ok(!r1.warnings.some((w) => w.code === "slope"), JSON.stringify(r1.warnings));
  const r2 = evaluateRoute([{ ...q[0] }, { ...q[1], elevationM: -3400 }], []); // no sampler: a real 31° grade is still refused
  assert.ok(r2.warnings.some((w) => w.code === "slope"));
});
