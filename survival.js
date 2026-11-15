// Survival budget for one suited walking excursion: oxygen, cooling water and battery per crew
// member, a reserve at return, a walk-back (point-of-no-return) limit, and a refusal that names
// the limiting consumable. Pure functions, no Cesium, no DOM: the route panel, route.json and the
// VR page all call the same code.
//
// Every coefficient lives in SURVIVAL_PARAMS (mirrored in public/data/params.json) and is
// documented in docs/assumptions.md with a source or the label ASSUMED.
//
// Model (time is the common currency):
//   speed     v(grade)  = Tobler hiking function, normalised so v(0) = v0           [ASSUMED v0]
//   power     M(grade)  = M_flat * k_crew + uphill work m g v_up / eta_muscle        [physics + ASSUMED]
//   oxygen    dO2/dt    = M / E_O2                     (E_O2 = 20.1 kJ per litre O2)
//   water     dH2O/dt   = (f_cool * M + P_suit) / L_sub (sublimator; L_sub = 2.83 MJ/kg)
//   battery   dE/dt     = P_suit
// The return leg is the outbound path walked backwards (an upper bound on the best way home,
// labelled as such): the walk-back limit is the furthest point from which that return still
// leaves every consumable above the reserve.

export const MARS_RADIUS_M = 3_396_190; // same radius as pathfinding.js

export const SURVIVAL_PARAMS = Object.freeze({
  version: 1,
  g_mars: 3.71,               // m/s^2      NASA Mars fact sheet
  v0_kmh: 2.5,                // km/h       ASSUMED suited walking speed on flat ground
  tobler_a: 3.5,              // -          Tobler 1993 hiking function exponent
  tobler_b: 0.05,             // -          Tobler 1993 offset (fastest at -2.86 deg)
  max_slope_deg: 25,          // deg        ASSUMED suit mobility limit (hard mask)
  metabolic_flat_w: 272,      // W          CITED: Apollo lunar EVA average 234 kcal/h (NASA TN D-7883 range 228-352 W)
  metabolic_stop_w: 230,      // W          ASSUMED sampling work at a stop
  eta_muscle: 0.25,           // -          ASSUMED muscular efficiency for climbing (~0.2-0.25)
  suit_mass_kg: 60,           // kg         ASSUMED suit + life support carried
  e_o2_j_per_kg: 14.07e6,     // J/kg O2    20.1 kJ/L at 1.429 g/L (indirect calorimetry)
  l_sub_j_per_kg: 2.83e6,     // J/kg       latent heat of sublimation of water ice
  f_cool: 0.8,                // -          ASSUMED share of metabolic heat rejected by the sublimator
  suit_power_w: 49,           // W          DERIVED: 390 Wh battery over the 8 h Apollo 15-17 design EVA
  stop_dwell_s: 1200,         // s          ASSUMED 20 min of sampling per science stop
  reserve_frac: 0.2,          // -          design decision (FIXED)
  blackout_grace_s: 60,       // s          design decision (FIXED)
  blackout_k: 1,              // s/s        ASSUMED risk-cost seconds per blackout second beyond grace
  haven_antenna_m: 3,         // m          ASSUMED relay mast height at the haven
  suit_antenna_m: 2,          // m          ASSUMED suit antenna height
});

// Two suited crew members. Cooling water and battery follow the Apollo 15-17 PLSS (8 h EVA
// design: 11.5 lb = 5.2 kg feedwater, 390 Wh battery); usable O2 mass is ASSUMED
// (docs/assumptions.md).
export const DEFAULT_CREW = Object.freeze([
  Object.freeze({ id: "A", name: "Crew A", body_mass_kg: 72, metabolic_scale: 1.0, o2_kg: 0.54, water_kg: 5.2, battery_wh: 390 }),
  Object.freeze({ id: "B", name: "Crew B", body_mass_kg: 88, metabolic_scale: 1.15, o2_kg: 0.54, water_kg: 5.2, battery_wh: 390 }),
]);

export const CONSUMABLES = Object.freeze([
  { key: "o2", label: "oxygen", cap: "o2_kg", unit: "kg" },
  { key: "water", label: "cooling water", cap: "water_kg", unit: "kg" },
  { key: "battery", label: "battery", cap: "battery_wh", unit: "Wh" },
]);

const RAD = Math.PI / 180;

export function surfaceDistanceM(a, b) {
  const la = a.lat * RAD, lb = b.lat * RAD;
  let dLon = (b.lon - a.lon) * RAD;
  if (dLon > Math.PI) dLon -= 2 * Math.PI; else if (dLon < -Math.PI) dLon += 2 * Math.PI;
  const s = Math.sin((lb - la) / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

// Walking speed (m/s) on a signed grade (rise/run, uphill positive).
export function walkingSpeed(grade, p = SURVIVAL_PARAMS) {
  const norm = Math.exp(-p.tobler_a * p.tobler_b);
  return (p.v0_kmh / 3.6) * Math.exp(-p.tobler_a * Math.abs(grade + p.tobler_b)) / norm;
}

// Metabolic power (W) while walking at speed v (m/s) on a signed grade.
export function metabolicPower(grade, v, crew, p = SURVIVAL_PARAMS) {
  const mass = crew.body_mass_kg + p.suit_mass_kg;
  const vUp = Math.max(0, grade) * v / Math.sqrt(1 + grade * grade);
  return p.metabolic_flat_w * crew.metabolic_scale + (mass * p.g_mars * vUp) / p.eta_muscle;
}

// Consumption rates per second for a given metabolic power.
export function rates(metabolicW, p = SURVIVAL_PARAMS) {
  return {
    o2: metabolicW / p.e_o2_j_per_kg,                                   // kg/s
    water: (p.f_cool * metabolicW + p.suit_power_w) / p.l_sub_j_per_kg, // kg/s
    battery: p.suit_power_w / 3600,                                     // Wh/s
  };
}

// Split a path into segments with distance, grade, slope and duration.
// opts.heightAt(lon, lat) -> metres (optional): long segments are then priced piece by piece,
// every opts.densifyM metres (default 100) along the segment, with interior heights sampled from
// the terrain. Without it a long any-angle segment is priced on its end-to-end grade only, which
// averages out the climbs and descents inside it. Segment indices always refer to the input path.
export function segmentsOf(path, p = SURVIVAL_PARAMS, opts = {}) {
  const heightAt = typeof opts.heightAt === "function" ? opts.heightAt : null;
  const step = opts.densifyM ?? 100;
  const segs = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const d = surfaceDistanceM(a, b);
    if (d === 0) { segs.push({ i, d: 0, grade: 0, slopeDeg: 0, t: 0, pieces: [] }); continue; }
    const za = a.elevationM ?? 0, zb = b.elevationM ?? 0;
    const n = heightAt && step > 0 ? Math.max(1, Math.ceil(d / step)) : 1;
    const z = [za];
    let dLon = b.lon - a.lon;                       // shortest way round across the ±180° seam
    if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360;
    for (let k = 1; k < n; k++) {
      const f = k / n, lat = a.lat + (b.lat - a.lat) * f;
      let lon = a.lon + dLon * f;
      if (lon > 180) lon -= 360; else if (lon < -180) lon += 360;
      const h = heightAt(lon, lat);
      z.push(Number.isFinite(h) ? h : za + (zb - za) * f);
    }
    z.push(zb);
    const pieces = [];
    let t = 0, steepest = 0;
    for (let k = 1; k <= n; k++) {
      const pd = d / n, grade = (z[k] - z[k - 1]) / pd;
      const v = walkingSpeed(grade, p);
      pieces.push({ d: pd, grade });
      t += pd / v;
      steepest = Math.max(steepest, Math.abs(grade));
    }
    const grade = (zb - za) / d;
    segs.push({ i, d, grade, slopeDeg: Math.atan(steepest) / RAD, v: d / t, t, pieces });
  }
  return segs;
}

function use(seg, crew, p, reverse = false) {
  const out = { t: 0, o2: 0, water: 0, battery: 0 };
  for (const piece of seg.pieces ?? [{ d: seg.d, grade: seg.grade }]) {
    if (!piece.d) continue;
    const grade = reverse ? -piece.grade : piece.grade;
    const v = walkingSpeed(grade, p), t = piece.d / v;
    const r = rates(metabolicPower(grade, v, crew, p), p);
    out.t += t; out.o2 += r.o2 * t; out.water += r.water * t; out.battery += r.battery * t;
  }
  return out;
}

// Surface temperature vs suit limits (°C). Ground hotter than the suit's limit refuses the EVA;
// colder at night only warns (a daytime EVA can still go). Same rule as hazards.js temperatureCheck.
export function environmentCheck(env) {
  if (!env) return null;
  const { groundMinC, groundMaxC, suitMinC, suitMaxC, source } = env;
  const where = `ground ${groundMinC ?? "?"}…${groundMaxC ?? "?"} °C${source ? ` (${source})` : ""}`;
  if (Number.isFinite(groundMaxC) && Number.isFinite(suitMaxC) && groundMaxC > suitMaxC)
    return { level: "refuse", code: "temperature_hot", text: `Too hot for the suit: ${where}, suit limit ${suitMaxC} °C.` };
  if (Number.isFinite(groundMinC) && Number.isFinite(suitMinC) && groundMinC < suitMinC)
    return { level: "warn", code: "temperature_cold", text: `Too cold at night: ${where}, suit limit ${suitMinC} °C. Daytime EVA only.` };
  return null;
}

// Line of sight from the haven antenna to each path point, sampled on the terrain.
// heightAt(lon, lat) -> metres or undefined. Returns a boolean per path point (true = in contact).
export function commsVisibility(path, heightAt, p = SURVIVAL_PARAMS, samplesPerKm = 20) {
  if (!path.length || typeof heightAt !== "function") return path.map(() => true);
  // endpoints use the same terrain sampler as the ray, so a point never hides behind itself
  const ground = (q) => heightAt(q.lon, q.lat) ?? q.elevationM ?? 0;
  const h0 = path[0], z0 = ground(h0) + p.haven_antenna_m;
  return path.map((q) => {
    const d = surfaceDistanceM(h0, q);
    if (d < 1) return true;
    const z1 = ground(q) + p.suit_antenna_m;
    const n = Math.max(2, Math.ceil((d / 1000) * samplesPerKm));
    for (let k = 1; k < n; k++) {
      const f = k / n;
      const lon = h0.lon + (q.lon - h0.lon) * f, lat = h0.lat + (q.lat - h0.lat) * f;
      const ground = heightAt(lon, lat);
      if (ground === undefined) continue;
      // curvature drop of the straight ray below the local horizon of the haven
      const x = d * f, drop = (x * (d - x)) / (2 * MARS_RADIUS_M);
      if (ground > z0 + (z1 - z0) * f + drop) return false;
    }
    return true;
  });
}

const pct = (x) => Math.round(x * 100);
const fmtKm = (m) => `${(m / 1000).toFixed(2)} km`;

// Evaluate a route.
//   path:      [{lon, lat, elevationM}] starting at the haven
//   stops:     [{name, index}] path indices of the science stops (and, if looped, the final haven)
//   options:   { crew, params, visible (bool per point, from commsVisibility), returnToHaven,
//                heightAt (lon, lat -> m; densifies long segments), densifyM (default 100),
//                environment: { groundMinC, groundMaxC, suitMinC, suitMaxC, source } }
// If the path does not end at the haven and returnToHaven is true (default), the return leg is
// the path walked backwards.
export function evaluateRoute(path, stops = [], options = {}) {
  const p = { ...SURVIVAL_PARAMS, ...(options.params || {}) };
  const crew = options.crew || DEFAULT_CREW;
  if (!Array.isArray(path) || path.length < 2) throw new RangeError("path needs at least two points");
  const segs = segmentsOf(path, p, { heightAt: options.heightAt, densifyM: options.densifyM });
  const loop = surfaceDistanceM(path[0], path.at(-1)) < 50;
  const returnLeg = !loop && options.returnToHaven !== false;
  const stopAt = new Map(stops.filter((s) => s.index > 0 && s.index < path.length).map((s) => [s.index, s]));
  const warnings = [];

  // steepest segment vs the hard mask
  const steep = segs.reduce((m, s) => (s.slopeDeg > m.slopeDeg ? s : m), { slopeDeg: 0 });
  if (steep.slopeDeg > p.max_slope_deg)
    warnings.push({ level: "refuse", code: "slope", text: `Segment ${fmtKm(cumDist(segs, steep.i))} into the route is ${steep.slopeDeg.toFixed(1)}° (suit limit ${p.max_slope_deg}°).` });

  // comms blackout runs (outbound)
  const blackout = [];
  if (Array.isArray(options.visible)) {
    let start = -1, t = 0, tStart = 0;
    for (let i = 0; i < path.length; i++) {
      if (i) t += segs[i - 1].t;
      const dark = !options.visible[i];
      if (dark && start < 0) { start = i; tStart = t; }
      if ((!dark || i === path.length - 1) && start >= 0) {
        const end = dark ? i : i - 1;
        blackout.push({ from: start, to: end, duration_s: Math.round(t - tStart), from_m: Math.round(cumDist(segs, start)), to_m: Math.round(cumDist(segs, end)) });
        start = -1;
      }
    }
    for (const b of blackout) if (b.duration_s > p.blackout_grace_s)
      warnings.push({ level: "warn", code: "blackout", text: `No line of sight to the haven for ${Math.round(b.duration_s / 60)} min between ${fmtKm(b.from_m)} and ${fmtKm(b.to_m)}.` });
  }
  const blackoutCost = blackout.reduce((s, b) => s + Math.max(0, b.duration_s - p.blackout_grace_s) * p.blackout_k, 0);

  // timeline (outbound, with dwell at stops)
  const timeline = [{ index: 0, name: "Haven", t_s: 0, dist_m: 0 }];
  let tAcc = 0, dAcc = 0;
  for (const s of segs) {
    tAcc += s.t; dAcc += s.d;
    const st = stopAt.get(s.i);
    if (st) { const dw = st.dwell_s ?? p.stop_dwell_s; timeline.push({ index: s.i, name: st.name, t_s: Math.round(tAcc), dist_m: Math.round(dAcc), ...(dw ? { dwell_s: dw } : {}) }); tAcc += dw; }
  }
  const outboundT = tAcc, outboundD = dAcc;
  const returnT = returnLeg ? segs.reduce((s, g) => s + use(g, crew[0], p, true).t, 0) : 0;
  const returnD = returnLeg ? outboundD : 0;
  if (returnLeg) timeline.push({ index: 0, name: "Haven (return)", t_s: Math.round(outboundT + returnT), dist_m: Math.round(outboundD + returnD) });

  const env = environmentCheck(options.environment);
  if (env) warnings.push(env);

  const members = crew.map((c) => evaluateMember(c, segs, stopAt, p, returnLeg, path));
  const failures = members.filter((m) => m.failure);
  for (const m of failures) warnings.unshift({ level: "refuse", code: m.failure.code, text: m.failure.text });

  const refused = warnings.some((w) => w.level === "refuse");
  const limiting = members.map((m) => ({ crew: m.name, ...m.limiting })).sort((a, b) => a.reserve_frac - b.reserve_frac)[0];
  return {
    feasible: !refused,
    verdict: refused ? `REFUSED — ${warnings.find((w) => w.level === "refuse").text}` : `GO — lowest reserve at return: ${limiting.crew} ${limiting.label} ${pct(limiting.reserve_frac)}% (min ${pct(p.reserve_frac)}%).`,
    distance_m: Math.round(outboundD + returnD),
    outbound_m: Math.round(outboundD),
    eta_s: Math.round(outboundT + returnT),
    risk_cost_s: Math.round(blackoutCost),
    loop, returnLeg,
    limiting,
    crew: members.map(({ failure, ...m }) => ({ ...m, failure: failure?.text ?? null })),
    timeline, blackout, warnings,
    params: p,
  };
}

function cumDist(segs, idx) { let d = 0; for (const s of segs) { if (s.i > idx) break; d += s.d; } return d; }

function evaluateMember(c, segs, stopAt, p, returnLeg, path) {
  const cap = { o2: c.o2_kg, water: c.water_kg, battery: c.battery_wh };
  const used = { o2: 0, water: 0, battery: 0 };
  // cost of walking home from point i along the path backwards: suffix sums from the haven
  const back = [{ t: 0, o2: 0, water: 0, battery: 0 }];
  for (const s of segs) {
    const u = use(s, c, p, true), prev = back.at(-1);
    back.push({ t: prev.t + u.t, o2: prev.o2 + u.o2, water: prev.water + u.water, battery: prev.battery + u.battery });
  }
  // ... and of finishing the remaining path instead, when the path itself ends at the haven
  const fwd = new Array(segs.length + 1);
  fwd[segs.length] = { t: 0, o2: 0, water: 0, battery: 0 };
  for (let k = segs.length - 1; k >= 0; k--) {
    const u = use(segs[k], c, p), n = fwd[k + 1];
    fwd[k] = { t: n.t + u.t, o2: n.o2 + u.o2, water: n.water + u.water, battery: n.battery + u.battery };
  }
  const home = (i) => (returnLeg ? back[i] : CONSUMABLES.reduce((o, { key }) => ({ ...o, [key]: Math.min(back[i][key], fwd[i][key]) }), {}));
  const stopRates = rates(p.metabolic_stop_w * c.metabolic_scale, p);
  let failure = null, walkBack = { index: 0, dist_m: 0 }, dist = 0, broken = false;
  let tightest = { margin: Infinity, index: 0, dist_m: 0, key: "o2" };
  const empty = (k) => used[k] > cap[k];
  const where = (i) => {
    const names = [...stopAt.entries()];
    const prev = names.filter(([j]) => j <= i).at(-1)?.[1]?.name ?? "the haven";
    const next = names.find(([j]) => j > i)?.[1]?.name;
    return next ? `between ${prev} and ${next}` : `after ${prev}`;
  };
  for (const s of segs) {
    const u = use(s, c, p);
    for (const k of ["o2", "water", "battery"]) used[k] += u[k];
    dist += s.d;
    const st = stopAt.get(s.i);
    if (st) { const dw = st.dwell_s ?? p.stop_dwell_s; used.o2 += stopRates.o2 * dw; used.water += stopRates.water * dw; used.battery += stopRates.battery * dw; }
    for (const { key, label } of CONSUMABLES) if (!failure && empty(key))
      failure = { code: `empty_${key}`, text: `${c.name} runs out of ${label} ${(dist / 1000).toFixed(2)} km out, ${where(s.i)}.` };
    // can this member still get home from here (back the way they came, or on along a loop)
    // with the reserve intact? The walk-back limit is the last point of the unbroken run of yes.
    const h = home(s.i);
    for (const { key } of CONSUMABLES) {
      const m = (cap[key] - used[key] - h[key]) / cap[key] - p.reserve_frac;
      if (m < tightest.margin) tightest = { margin: m, index: s.i, dist_m: Math.round(dist), key };
    }
    const ok = CONSUMABLES.every(({ key }) => cap[key] - used[key] - h[key] >= p.reserve_frac * cap[key]);
    if (ok && !failure && !broken) walkBack = { index: s.i, dist_m: Math.round(dist) };
    else broken = true;
  }
  if (returnLeg) {
    const home = back.at(-1);
    for (const k of ["o2", "water", "battery"]) used[k] += home[k];
    for (const { key, label } of CONSUMABLES) if (!failure && empty(key))
      failure = { code: `empty_${key}`, text: `${c.name} runs out of ${label} on the walk back to the haven.` };
  }
  const reserve = Object.fromEntries(CONSUMABLES.map(({ key }) => [key, (cap[key] - used[key]) / cap[key]]));
  const lim = CONSUMABLES.map((x) => ({ key: x.key, label: x.label, reserve_frac: reserve[x.key] })).sort((a, b) => a.reserve_frac - b.reserve_frac)[0];
  if (!failure && lim.reserve_frac < p.reserve_frac)
    failure = { code: `reserve_${lim.key}`, text: `${c.name} would return with ${Math.max(0, pct(lim.reserve_frac))}% ${lim.label} (needs ${pct(p.reserve_frac)}% reserve).` };
  return {
    id: c.id, name: c.name,
    used: { o2_kg: round(used.o2, 3), water_kg: round(used.water, 3), battery_wh: round(used.battery, 1) },
    reserve: Object.fromEntries(Object.entries(reserve).map(([k, v]) => [k, round(v, 3)])),
    limiting: lim,
    walk_back: walkBack,
    tightest: { margin_frac: round(tightest.margin, 3), index: tightest.index, dist_m: tightest.dist_m, consumable: CONSUMABLES.find((x) => x.key === tightest.key).label },
    failure,
  };
}

const round = (x, n) => Math.round(x * 10 ** n) / 10 ** n;

// Apply a named scenario to the crew (for the demo: show a refusal on the same route).
export const SCENARIOS = Object.freeze({
  standard: { label: "Standard suits", apply: (crew) => crew },
  degraded_b_water: {
    label: "Hypothetical: Crew B feedwater at 18 % (sublimator leak)",
    apply: (crew) => crew.map((c) => (c.id === "B" ? { ...c, water_kg: c.water_kg * 0.18 } : c)),
  },
  degraded_b_o2: {
    label: "Hypothetical: Crew B oxygen at 30 % (incomplete recharge)",
    apply: (crew) => crew.map((c) => (c.id === "B" ? { ...c, o2_kg: c.o2_kg * 0.3 } : c)),
  },
  long_dwell: {
    label: "Hypothetical: 1 h of sampling at each stop",
    apply: (crew) => crew, params: { stop_dwell_s: 3600 },
  },
});
