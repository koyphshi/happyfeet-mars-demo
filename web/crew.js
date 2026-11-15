// Crew & rovers: members that walk / drive a planned terrain route, with an ETA from their
// speed on each slope, oxygen / battery use, the longest safe stay at the destination
// (returning with the reserve set in Settings), the point of no return, line-of-sight comms
// to the base, and alerts when someone is out of contact or running low.
//
// Everything is a model (no live telemetry exists for this): speeds and consumption rates come
// from published figures and simple physiology, and every number can be edited per member.
// Current levels can be typed in at any time, as a stand-in for suit / rover telemetry.

import { SURVIVAL_PARAMS as SP, DEFAULT_CREW, walkingSpeed, metabolicPower } from "./survival.js";

const R_M = 3_396_190, RAD = Math.PI / 180, SOL_H = 24.6597;
const STORE = "mars-crew-v1", SET_STORE = "mars-crew-settings-v1";

// Presets. Sources: Curiosity ~0.14 km/h top speed, a few tens of m/h on average with hazard
// stops (NASA/JPL); Perseverance ~0.15 km/h top, AutoNav ~120 m/h; MMRTG power (battery not
// the limit); pressurized rover concept (NASA SEV): ~10 km/h, multi-day life support.
// The suited astronaut is NOT modelled here: speed, slope limit, metabolic curve and the
// default O2 / cooling-water / battery endurance all come from survival.js (SURVIVAL_PARAMS and
// a DEFAULT_CREW suit), so the crew panel and the survival card give the same numbers for the
// same walk. A member can carry its own suit (m.suit = a DEFAULT_CREW-like entry, e.g. Crew B).
const SUIT = DEFAULT_CREW[0];
const round1 = (x) => Math.round(x * 10) / 10;
// consumables, in the order shown; each is a % of a full tank
export const RES = Object.freeze([
  { key: "o2", flag: "o2", pct: "o2Pct", hours: "o2Hours", short: "O₂", name: "oxygen" },
  { key: "h2o", flag: "water", pct: "waterPct", hours: "waterHours", short: "H₂O", name: "cooling water" },
  { key: "bat", flag: "battery", pct: "batteryPct", hours: "batteryHours", short: "Batt", name: "battery" },
]);
const RES_BY = Object.fromEntries(RES.map((r) => [r.key, r]));
const zeroUse = () => ({ o2: 0, h2o: 0, bat: 0 });
// flat-walking endurance (h) of a survival.js suit
export function suitHours(c, p = SP, round = true) {
  const flat = p.metabolic_flat_w * c.metabolic_scale, r = round ? round1 : (x) => x;
  return {
    o2Hours: r(c.o2_kg * p.e_o2_j_per_kg / flat / 3600),
    waterHours: r(c.water_kg * p.l_sub_j_per_kg / (p.f_cool * flat + p.suit_power_w) / 3600),
    batteryHours: r(c.battery_wh / p.suit_power_w),
  };
}
export const PRESETS = {
  astronaut: { label: "Astronaut (suited EVA)", type: "astronaut", speedKmh: SP.v0_kmh, maxSlope: SP.max_slope_deg,
    o2: true, water: true, battery: true, ...suitHours(SUIT), dutyHours: 24, rtg: false, color: "#4fc3f7" },
  pressurized: { label: "Pressurized crew rover (concept)", type: "rover", speedKmh: 10, maxSlope: 20,
    o2: true, o2Hours: 72, water: false, waterHours: 0, battery: true, batteryHours: 12, dutyHours: 24, rtg: false, color: "#ffb74d" },
  perseverance: { label: "Perseverance (M2020)", type: "rover", speedKmh: 0.12, maxSlope: 30,
    o2: false, o2Hours: 0, water: false, waterHours: 0, battery: true, batteryHours: 6, dutyHours: 5, rtg: true, color: "#aed581" },
  curiosity: { label: "Curiosity (MSL)", type: "rover", speedKmh: 0.03, maxSlope: 30,
    o2: false, o2Hours: 0, water: false, waterHours: 0, battery: true, batteryHours: 6, dutyHours: 4, rtg: true, color: "#ce93d8" },
};

// ---------------------------------------------------------------- physics model
const suitOf = (m) => m.suit ?? SUIT;
function speedMs(m, grade) {
  const v0 = m.speedKmh / 3.6;
  if (m.type === "astronaut") // survival.js Tobler curve, with this member's flat speed
    return walkingSpeed(grade, { ...SP, v0_kmh: m.speedKmh });
  const deg = Math.atan(Math.abs(grade)) / RAD;   // rovers slow down on slopes
  return v0 * Math.max(0.25, 1 - 0.6 * deg / Math.max(1, m.maxSlope));
}
// percent per hour, moving or resting
function rates(m, grade, moving) {
  const up = Math.max(0, grade);
  const r = zeroUse();
  if (m.type === "astronaut") {
    // survival.js: O2 follows metabolic power M; sublimator water follows f_cool * M + suit
    // power; the battery draw is the constant suit power. Each is normalised so flat walking
    // empties a full tank in its "... lasts (h)"; resting = sampling work at a stop.
    const sv = suitOf(m), flat = SP.metabolic_flat_w * sv.metabolic_scale;
    const M = moving ? metabolicPower(grade, speedMs(m, grade), sv, SP) : SP.metabolic_stop_w * sv.metabolic_scale;
    if (m.o2) r.o2 = (100 / m.o2Hours) * (M / flat);
    if (m.water && m.waterHours > 0) r.h2o = (100 / m.waterHours) * ((SP.f_cool * M + SP.suit_power_w) / (SP.f_cool * flat + SP.suit_power_w));
    if (m.battery) r.bat = 100 / m.batteryHours;
  } else {
    if (m.o2) r.o2 = 100 / m.o2Hours;                                    // cabin life support
    if (m.battery && !m.rtg) r.bat = (100 / m.batteryHours) * (moving ? 1 + 2 * up : 0.15);
  }
  return r;
}
const segM = (a, b) => {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_M * Math.asin(Math.min(1, Math.sqrt(h)));
};
// cumulative moving time (h), distance (m) and consumables used (%) along pts
// dwell (optional): Map(point index -> hours spent there at rest, e.g. sampling at a science
// stop); the values at that index then include the dwell, and dwT / dw[key] hold the dwell part.
function profile(m, pts, dwell = null) {
  const n = pts.length, t = new Float64Array(n), d = new Float64Array(n), dwT = new Float64Array(n);
  const use = {}, dw = {};
  for (const { key } of RES) { use[key] = new Float64Array(n); dw[key] = new Float64Array(n); }
  const steep = [], rest = dwell?.size ? restRates(m) : null;
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1], b = pts[i], run = Math.max(0.01, segM(a, b)), grade = (b.e - a.e) / run;
    if (Math.atan(Math.abs(grade)) / RAD > m.maxSlope + 0.5 && run > 50) steep.push(i);
    const dt = run / speedMs(m, grade) / 3600, r = rates(m, grade, true);
    t[i] = t[i - 1] + dt; d[i] = d[i - 1] + run;
    for (const { key } of RES) use[key][i] = use[key][i - 1] + r[key] * dt;
    const h = dwell?.get(i);
    if (h > 0) {
      dwT[i] = h; t[i] += h;
      for (const { key } of RES) { dw[key][i] = rest[key] * h; use[key][i] += dw[key][i]; }
    }
  }
  return { pts, t, d, ...use, steep, dwT, dw };
}
// Split every path segment into <= stepM pieces with heights from heightAt(lon, lat), exactly
// as survival.js segmentsOf(path, p, { heightAt }) prices them, so the crew model sees the same
// bumps inside long segments as the survival card. Returns { pts, stopIdx } with remapped stops.
export function densifyPlan(pts, stopIdx, heightAt, stepM = 100) {
  if (typeof heightAt !== "function" || stepM <= 0 || pts.length < 2) return { pts, stopIdx };
  const out = [pts[0]], map = [0];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], n = Math.max(1, Math.ceil(segM(a, b) / stepM));
    let dLon = b.lon - a.lon;                       // shortest way round across the ±180° seam
    if (dLon > 180) dLon -= 360; else if (dLon < -180) dLon += 360;
    for (let k = 1; k < n; k++) {
      const f = k / n, lat = a.lat + (b.lat - a.lat) * f;
      let lon = a.lon + dLon * f;
      if (lon > 180) lon -= 360; else if (lon < -180) lon += 360;
      const h = heightAt(lon, lat);
      out.push({ lon, lat, e: Number.isFinite(h) ? h : a.e + (b.e - a.e) * f });
    }
    out.push(b);
    map.push(out.length - 1);
  }
  return { pts: out, stopIdx: stopIdx.map((i) => map[Math.max(0, Math.min(map.length - 1, i))]) };
}
// Sampling time at each science stop, as survival.js evaluateRoute(): SURVIVAL_PARAMS.stop_dwell_s
// (or the member's own m.dwellS, e.g. a "1 h per stop" scenario) at metabolic_stop_w for suited
// crew; 0 at the haven / turnaround and for rovers.
function scienceDwell(m, stopIdx, from, to, offset = 0) {
  const map = new Map();
  if (m.type !== "astronaut") return map;
  const h = (m.dwellS ?? SP.stop_dwell_s) / 3600;
  for (let k = from; k < to; k++) if (stopIdx[k] - offset > 0) map.set(stopIdx[k] - offset, h);
  return map;
}
// moving hours -> calendar hours (rovers only drive dutyHours per sol)
const toCal = (m, h) => m.dutyHours >= 24 ? h : Math.floor(h / m.dutyHours) * SOL_H + (h % m.dutyHours);
const restRates = (m) => rates(m, 0, false);
const limiting = (m) => RES.filter((r) => m[r.flag] && !(r.key === "bat" && m.rtg) && m[r.hours] > 0).map((r) => r.key);

// The full analysis of a member on their assigned route.
function analyse(m, reservePct) {
  const P = m.plan;
  if (!P?.pts?.length) return null;
  const n = P.stopIdx.length;
  const destStop = P.loop ? n - 2 : n - 1;
  const outEnd = P.stopIdx[Math.max(0, destStop)];
  const outPts = P.pts.slice(0, outEnd + 1);
  const retPts = P.loop ? P.pts.slice(outEnd) : outPts.slice().reverse();
  // dwell at the intermediate science stops on the way out (and, on a loop, on the way back)
  const F = profile(m, outPts, scienceDwell(m, P.stopIdx, 1, Math.max(1, destStop)));
  const Rt = profile(m, retPts, P.loop ? scienceDwell(m, P.stopIdx, destStop + 1, n - 1, outEnd) : null);
  const Bk = P.loop ? profile(m, outPts.slice().reverse()) : profile(m, retPts); // backing out: no stops
  const N = outPts.length;
  const backAt = (key, i) => Bk[key][N - 1] - Bk[key][N - 1 - i];   // cost from out index i back to start
  const lev = Object.fromEntries(RES.map((r) => [r.key, m[r.pct] ?? 100]));
  const rest = restRates(m);
  const res = limiting(m);
  let stayMax = Infinity, stayLimit = null;
  const end = {};
  for (const k of res) {
    const avail = lev[k] - reservePct - F[k][N - 1] - Rt[k].at(-1);
    const s = rest[k] > 0 ? avail / rest[k] : Infinity;
    if (s < stayMax) { stayMax = s; stayLimit = k; }
  }
  // point of no return: the furthest point from which backing out still keeps the reserve
  let pnr = N - 1, pnrBy = null;
  for (let i = 0; i < N; i++) {
    const k = res.find((key) => F[key][i] + backAt(key, i) > lev[key] - reservePct);
    if (k) { pnr = Math.max(0, i - 1); pnrBy = k; break; }
  }
  // a planned stay is kept as planned (if it does not fit, the shortfall shows); no plan = max stay
  const stay = m.stayH != null ? Math.max(0, m.stayH) : Math.max(0, stayMax);
  const stayUsed = Number.isFinite(stay) ? stay : 0;
  for (const k of res) end[k] = lev[k] - F[k][N - 1] - Rt[k].at(-1) - rest[k] * stayUsed;
  const outCal = toCal(m, F.t[N - 1]), retCal = toCal(m, Rt.t.at(-1));
  // arrival times (before the stop's own sampling time)
  const stops = P.stopIdx.slice(0, destStop + 1).map((idx, k) => { const j = Math.min(idx, N - 1); return { name: P.stopNames[k], h: toCal(m, F.t[j] - F.dwT[j]), km: F.d[j] / 1000, dwellH: F.dwT[j] }; });
  // the planned stay itself must fit too (a fixed stay longer than the maximum is not safe)
  const stayFits = m.stayH == null || m.stayH <= stayMax + 1e-9;
  return {
    F, Rt, Bk, backAt, outCal, retCal, stayMax, stayLimit, stay: stayUsed, stops, pnr, pnrBy, end, res,
    destName: P.stopNames[Math.max(0, destStop)], outKm: F.d[N - 1] / 1000, retKm: Rt.d.at(-1) / 1000,
    steep: F.steep.length + (P.loop ? Rt.steep.length : 0),
    feasible: stayMax >= 0 && stayFits && !F.steep.length && !(P.loop && Rt.steep.length),
  };
}

// Timeline of an EVA: samples { c: calendar h, lon, lat, e, o2, h2o, bat, ph } with resources used (%).
function buildTimeline(m, A) {
  const out = [];
  const usedAt = (prof, i, base, minusDwell = false) =>
    Object.fromEntries(RES.map(({ key }) => [key, base[key] + prof[key][i] - (minusDwell ? prof.dw[key][i] : 0)]));
  const push = (prof, c0, ph, used0) => {
    let lastCal = c0;
    for (let i = 0; i < prof.pts.length; i++) {
      const p = prof.pts[i];
      if (prof.dwT?.[i] > 0) // arrive, then stay put while sampling
        out.push({ c: c0 + toCal(m, prof.t[i] - prof.dwT[i]), lon: p.lon, lat: p.lat, e: p.e, ...usedAt(prof, i, used0, true), ph, i });
      lastCal = c0 + toCal(m, prof.t[i]);
      out.push({ c: lastCal, lon: p.lon, lat: p.lat, e: p.e, ...usedAt(prof, i, used0), ph, i });
    }
    return lastCal;
  };
  let c = push(A.F, 0, "out", zeroUse());
  const last = out.at(-1), rest = restRates(m);
  if (A.stay > 0) {
    out.push({ ...last, c: c + A.stay, ...Object.fromEntries(RES.map(({ key }) => [key, last[key] + rest[key] * A.stay])), ph: "stay" });
    c += A.stay;
  }
  const s = out.at(-1);
  push(A.Rt, c, "back", Object.fromEntries(RES.map(({ key }) => [key, s[key]])));
  return out;
}
function sampleAt(tl, c) {
  if (c <= tl[0].c) return { ...tl[0], ph: "out" };
  if (c >= tl.at(-1).c) return { ...tl.at(-1), ph: "done" };
  let lo = 0, hi = tl.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (tl[mid].c <= c) lo = mid; else hi = mid; }
  const a = tl[lo], b = tl[hi], f = b.c > a.c ? (c - a.c) / (b.c - a.c) : 0;
  return { c, lon: a.lon + (b.lon - a.lon) * f, lat: a.lat + (b.lat - a.lat) * f, e: a.e + (b.e - a.e) * f,
    ...Object.fromEntries(RES.map(({ key }) => [key, (a[key] ?? 0) + ((b[key] ?? 0) - (a[key] ?? 0)) * f])),
    ph: b.ph === "stay" ? "stay" : a.ph, i: a.i + f };
}

// ---------------------------------------------------------------- formatting
const fmtDur = (h) => {
  if (!Number.isFinite(h)) return "unlimited";
  if (h < 0) return "—";
  if (h >= 48) return `${(h / SOL_H).toFixed(1)} sols`;
  const mins = Math.round(h * 60);
  return mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, "0")}`;
};
const fmtKm = (km) => (km >= 10 ? `${km.toFixed(1)} km` : km >= 1 ? `${km.toFixed(2)} km` : `${Math.round(km * 1000)} m`);
const clock = (ms) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------------------------------------------------------------- UI + map
export function initCrew(api) {
  const { Cesium, viewer, MARS, sampleTerrainHeights } = api;
  const $ = (id) => document.getElementById(id);
  const settings = Object.assign({ reserve: SP.reserve_frac * 100, commsKm: 10, mastM: SP.haven_antenna_m, scale: 60 }, (() => {
    try { return JSON.parse(localStorage.getItem(SET_STORE) || "{}"); } catch { return {}; }
  })());
  let members = [];
  try { members = JSON.parse(localStorage.getItem(STORE) || "[]"); } catch { members = []; }
  let selectedId = members[0]?.id ?? null, followId = null, pendingPlanFor = null;
  // "Walk from here": { id, phase: "pick" | "plan", dest } while waiting for a click / a route
  let fromHere = null;
  let pendingShowcase = null; // preset keys to add + assign when the next route is ready
  const save = () => { try { localStorage.setItem(STORE, JSON.stringify(members)); } catch { /* full: keep in memory */ } };
  const saveSettings = () => { try { localStorage.setItem(SET_STORE, JSON.stringify(settings)); } catch { /* ignore */ } };
  const byId = (id) => members.find((m) => m.id === id);
  const analyses = new Map(), timelines = new Map(), live = new Map(); // id -> derived state
  const ents = new Map(); // id -> { marker, path }

  // --- settings controls (Settings tab)
  const reserveEl = $("crewReserve"), reserveVal = $("crewReserveVal"), commsEl = $("crewComms"), mastEl = $("crewMast"), scaleEl = $("crewScale");
  reserveEl.value = settings.reserve; commsEl.value = settings.commsKm; mastEl.value = settings.mastM; scaleEl.value = settings.scale;
  reserveVal.textContent = `${settings.reserve}%`;
  const onSettings = () => {
    const now = Date.now();
    for (const m of members) if (m.eva) { m.eva.c0 = simHours(m, now); m.eva.t0 = now; } // keep the mission clock continuous
    settings.reserve = Number(reserveEl.value); settings.commsKm = Number(commsEl.value);
    settings.mastM = Math.max(0, Number(mastEl.value) || 0); settings.scale = Number(scaleEl.value);
    reserveVal.textContent = `${settings.reserve}%`;
    saveSettings(); save(); recomputeAll();
  };
  for (const el of [reserveEl, commsEl, mastEl, scaleEl]) el.addEventListener("input", onSettings);

  const simHours = (m, now = Date.now()) => m.eva ? m.eva.c0 + (now - m.eva.t0) / 3_600_000 * settings.scale : 0;

  // --- alerts
  const alertBox = $("crewAlerts"), logEl = $("crewLog");
  const active = new Map(); // "id|key" -> level
  let desktop = typeof Notification !== "undefined" && Notification.permission === "granted";
  function toast(level, text) {
    const d = document.createElement("div");
    d.className = `crewToast ${level}`;
    d.innerHTML = `<b>${level === "danger" ? "⚠ EMERGENCY" : level === "warn" ? "⚠ Warning" : "ℹ"}</b> ${esc(text)}<div class="to">→ sent to all crew &amp; base</div>`;
    d.addEventListener("click", () => d.remove());
    alertBox.prepend(d);
    setTimeout(() => d.remove(), level === "danger" ? 20000 : 9000);
    const row = document.createElement("div");
    row.className = `crewLogRow ${level}`;
    row.textContent = `${clock(Date.now())} · ${text}`;
    logEl.prepend(row);
    while (logEl.children.length > 60) logEl.lastChild.remove();
    if (desktop && level !== "info") try { new Notification(`Mars crew ${level === "danger" ? "EMERGENCY" : "warning"}`, { body: text }); } catch { /* ignore */ }
  }
  function raise(m, key, level, text) {
    const k = `${m.id}|${key}`;
    if (active.get(k) === level) return;
    const was = active.get(k);
    active.set(k, level);
    if (was !== "danger" || level === "danger") toast(level, `${m.name}: ${text}`);
  }
  function clear(m, key, text) {
    const k = `${m.id}|${key}`;
    if (!active.has(k)) return;
    active.delete(k);
    if (text) toast("info", `${m.name}: ${text}`);
  }
  $("crewDesktop").addEventListener("click", async () => {
    if (typeof Notification === "undefined") return;
    desktop = (await Notification.requestPermission()) === "granted";
    $("crewDesktop").textContent = desktop ? "Desktop alerts on" : "Desktop alerts blocked";
  });
  if (desktop) $("crewDesktop").textContent = "Desktop alerts on";

  // --- line of sight between two surface points (antenna heights in m), Mars curvature included
  async function lineOfSight(a, b, hA, hB) {
    const dist = segM(a, b);
    if (dist > settings.commsKm * 1000) return { ok: false, why: `out of radio range (${fmtKm(dist / 1000)})`, km: dist / 1000 };
    const om = dist / R_M, N = Math.max(8, Math.min(96, Math.ceil(dist / 300)));
    const va = [Math.cos(a.lat * RAD) * Math.cos(a.lon * RAD), Math.cos(a.lat * RAD) * Math.sin(a.lon * RAD), Math.sin(a.lat * RAD)];
    const vb = [Math.cos(b.lat * RAD) * Math.cos(b.lon * RAD), Math.cos(b.lat * RAD) * Math.sin(b.lon * RAD), Math.sin(b.lat * RAD)];
    const pts = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const s0 = om > 1e-9 ? Math.sin((1 - t) * om) / Math.sin(om) : 1 - t, s1 = om > 1e-9 ? Math.sin(t * om) / Math.sin(om) : t;
      const v = [0, 1, 2].map((j) => s0 * va[j] + s1 * vb[j]);
      pts.push({ lat: Math.asin(Math.max(-1, Math.min(1, v[2] / Math.hypot(...v)))) / RAD, lon: Math.atan2(v[1], v[0]) / RAD });
    }
    let H;
    try { H = await sampleTerrainHeights(pts, 6); } catch { return { ok: true, why: "terrain unavailable", km: dist / 1000 }; }
    const ra = R_M + H[0] + hA, rb = R_M + H[N] + hB;
    const A = [ra, 0], B = [rb * Math.cos(om), rb * Math.sin(om)], BA = [B[0] - A[0], B[1] - A[1]];
    for (let k = 1; k < N; k++) {
      const phi = om * k / N, u = [Math.cos(phi), Math.sin(phi)];
      const den = BA[0] * u[1] - BA[1] * u[0];
      if (Math.abs(den) < 1e-12) continue;
      const s = -(A[0] * u[1] - A[1] * u[0]) / den;
      const r = Math.hypot(A[0] + s * BA[0], A[1] + s * BA[1]);
      if (R_M + H[k] > r) return { ok: false, why: "terrain blocks line of sight to base", km: dist / 1000, at: pts[k] };
    }
    return { ok: true, km: dist / 1000 };
  }
  const base = (m) => m.plan?.pts?.[0];

  // comms coverage along the planned outbound path (sampled)
  async function coverage(m) {
    const A = analyses.get(m.id);
    if (!A || !base(m)) return;
    const pts = A.F.pts, n = Math.min(40, pts.length), lost = [];
    for (let k = 1; k < n; k++) {
      const i = Math.round(k / (n - 1) * (pts.length - 1));
      const r = await lineOfSight(base(m), pts[i], settings.mastM, SP.suit_antenna_m);
      if (!r.ok) lost.push(A.F.d[i] / 1000);
    }
    A.cover = { frac: 1 - lost.length / Math.max(1, n - 1), firstKm: lost[0] };
    if (selectedId === m.id) renderDetail();
  }

  // --- derive everything for one member
  function recompute(m) {
    const A = analyse(m, settings.reserve);
    if (A) analyses.set(m.id, A); else analyses.delete(m.id);
    if (!A) timelines.delete(m.id);
    else timelines.set(m.id, m.eva?.abortTimeline ?? buildTimeline(m, A));
    drawEntities(m);
    if (A) coverage(m);
  }
  function recomputeAll() { for (const m of members) recompute(m); renderList(); renderDetail(); }

  // --- map entities
  const iconCache = new Map();
  function icon(m) {
    const key = `${m.type}${m.color}`;
    if (!iconCache.has(key)) {
      const glyph = m.type === "astronaut"
        ? `<circle cx="19" cy="15" r="7.5" fill="#eee"/><rect x="13.5" y="12" width="11" height="6" rx="3" fill="${m.color}"/><path d="M11 30c0-5 3.6-8 8-8s8 3 8 8z" fill="#eee"/>`
        : `<rect x="9" y="11" width="20" height="10" rx="2.5" fill="#eee"/><rect x="21" y="7" width="2" height="5" fill="#eee"/><circle cx="21.5" cy="6.5" r="2" fill="${m.color}"/><circle cx="12" cy="24" r="3.4" fill="#eee"/><circle cx="19" cy="24" r="3.4" fill="#eee"/><circle cx="26" cy="24" r="3.4" fill="#eee"/>`;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="38" height="46" viewBox="0 0 38 46"><path d="M19 2C9.6 2 3 8.8 3 17.2 3 28 19 44 19 44s16-16 16-26.8C35 8.8 28.4 2 19 2Z" fill="#171614" fill-opacity=".96" stroke="${m.color}" stroke-width="2.6"/>${glyph}</svg>`;
      iconCache.set(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    }
    return iconCache.get(key);
  }
  function currentSample(m) {
    const tl = timelines.get(m.id);
    if (tl && m.eva) return sampleAt(tl, simHours(m));
    if (tl) return { ...tl[0], ph: "ready" };
    return m.home ? { lon: m.home.lon, lat: m.home.lat, e: m.home.e ?? 0, ph: "idle", ...zeroUse() } : null;
  }
  function drawEntities(m) {
    const old = ents.get(m.id);
    if (old?.path) { api.dropOnTop?.(old.path); viewer.entities.remove(old.path); }
    // the marker is kept (the camera may be following it); only its icon can change
    if (old) old.marker.billboard.image = icon(m);
    const marker = old?.marker ?? viewer.entities.add({
      position: new Cesium.CallbackProperty(() => {
        const s = live.get(m.id)?.s ?? currentSample(m);
        return s ? Cesium.Cartesian3.fromDegrees(s.lon, s.lat, api.visualHeight(s.e) + 4, MARS) : undefined;
      }, false),
      billboard: {
        image: icon(m), width: 34, height: 41, verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(2_000, 1.0, 4_000_000, 0.6),
      },
      label: {
        text: new Cesium.CallbackProperty(() => live.get(m.id)?.label ?? m.name, false),
        font: "600 12px system-ui, sans-serif", fillColor: Cesium.Color.WHITE, outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE, verticalOrigin: Cesium.VerticalOrigin.TOP, pixelOffset: new Cesium.Cartesian2(0, 4),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3_000_000),
      },
      viewFrom: new Cesium.Cartesian3(-1800, -1800, 1600), // Follow: camera offset (m)
      properties: { crewId: m.id },
    });
    let path = null;
    const tl = timelines.get(m.id);
    if (tl && tl.length > 1) {
      const step = Math.max(1, Math.floor(tl.length / 3000));
      const positions = [];
      for (let i = 0; i < tl.length; i += step) positions.push(Cesium.Cartesian3.fromDegrees(tl[i].lon, tl[i].lat, api.visualHeight(tl[i].e) + 12, MARS));
      const lastP = tl.at(-1);
      positions.push(Cesium.Cartesian3.fromDegrees(lastP.lon, lastP.lat, api.visualHeight(lastP.e) + 12, MARS));
      const col = Cesium.Color.fromCssColorString(m.color);
      path = viewer.entities.add({
        polyline: {
          positions, width: 3, arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineDashMaterialProperty({ color: col, gapColor: col.withAlpha(0.15), dashLength: 18 }),
        },
        properties: { crewId: m.id },
      });
      api.keepOnTop?.(path, col.withAlpha(0.8), 3); // never hidden by a hill
    }
    ents.set(m.id, { marker, path });
  }
  api.onReliefChange?.(() => { for (const m of members) drawEntities(m); });

  // --- list and detail UI
  const listEl = $("crewList"), detailEl = $("crewDetail");
  const bar = (label, pct, reserve) => `<div class="crewBar"><span>${label}</span><span class="track"><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%" class="${pct <= reserve ? "low" : pct <= reserve + 10 ? "mid" : ""}"></i><b style="left:${reserve}%"></b></span><span class="v">${Math.max(0, pct).toFixed(0)}%</span></div>`;
  function levels(m) {
    const s = live.get(m.id)?.s;
    const adj = { ...zeroUse(), ...(m.eva?.adj ?? {}) };
    const used = m.eva && s ? s : zeroUse();
    return Object.fromEntries(RES.map(({ key, pct }) => [key, key === "bat" && m.rtg ? (m[pct] ?? 100) : (m[pct] ?? 100) - (used[key] ?? 0) + adj[key]]));
  }
  function statusText(m) {
    const L = live.get(m.id), A = analyses.get(m.id);
    if (!A) return "No route assigned";
    if (!m.eva) return A.feasible ? `Ready · ${fmtDur(A.outCal)} to ${A.destName}` : (A.stayMax < 0 ? "Cannot return with reserve" : "Route too steep for this member");
    const s = L?.s;
    if (!s) return "";
    const remaining = timelines.get(m.id).at(-1).c - s.c;
    if (s.ph === "done") return "Back at base ✓";
    const phase = s.ph === "out" ? `→ ${A.destName}` : s.ph === "stay" ? `At ${A.destName}` : "Returning";
    const destC = timelines.get(m.id).find((p) => p.ph !== "out")?.c ?? 0;
    const eta = s.ph === "out" ? ` · ETA ${clock(Date.now() + (destC - s.c) / settings.scale * 3_600_000)}` : "";
    return `${phase}${eta} · home in ${fmtDur(remaining)} (mission time)`;
  }
  function renderList() {
    listEl.replaceChildren(...members.map((m) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = `crewRow${m.id === selectedId ? " on" : ""}`;
      row.style.setProperty("--k", m.color);
      row.dataset.id = m.id;
      row.innerHTML = `<div class="crewTop"><i></i><b>${esc(m.name)}</b><em>${m.type === "astronaut" ? "Astronaut" : "Rover"}</em>${followId === m.id ? '<span class="fol">following</span>' : ""}</div>` +
        `<div class="crewStat"></div><div class="crewBars"></div>`;
      row.addEventListener("click", () => { select(m.id); api.entitySelected?.(m.id); });
      return row;
    }));
    $("crewEmpty").hidden = members.length > 0;
    api.membersChanged?.(members.map((m) => ({ id: m.id, name: m.name, type: m.type })));
    refreshLive();
  }
  function refreshLive() {
    for (const row of listEl.children) {
      const m = byId(row.dataset.id);
      if (!m) continue;
      const L = levels(m);
      row.querySelector(".crewStat").textContent = statusText(m);
      row.querySelector(".crewBars").innerHTML = (m.o2 ? bar("O₂", L.o2, settings.reserve) : "") +
        (m.water && m.waterHours > 0 ? bar("H₂O", L.h2o, settings.reserve) : "") +
        (m.battery ? (m.rtg ? `<div class="crewBar"><span>Power</span><span class="rtg">RTG · not limiting</span></div>` : bar("Batt", L.bat, settings.reserve)) : "");
      const ac = [...active.entries()].filter(([k]) => k.startsWith(`${m.id}|`)).map(([, v]) => v);
      row.classList.toggle("danger", ac.includes("danger"));
      row.classList.toggle("warn", !ac.includes("danger") && ac.includes("warn"));
    }
  }
  const num = (label, key, m, attrs = "") => `<label class="crewF">${label}<input data-k="${key}" type="number" value="${m[key]}" ${attrs} /></label>`;
  function renderDetail() {
    const m = byId(selectedId);
    detailEl.hidden = !m;
    if (!m) return;
    const A = analyses.get(m.id), route = api.getRoute();
    const res = settings.reserve;
    let report = "";
    const waiting = fromHere?.id === m.id;
    if (waiting && fromHere.phase === "pick") {
      report = `<div class="crewVerdict wait">🧭 Click the destination on the map (any point or spot). Esc cancels.</div>`;
    } else if (waiting && fromHere.phase === "plan") {
      report = `<div class="crewVerdict wait">Planning ${esc(m.name)} → ${esc(fromHere.dest.name)} at ${m.maxSlope}°…</div>`;
    } else if (m.tripFail) {
      report = `<div class="crewVerdict bad">✗ Not feasible: no ${m.type === "astronaut" ? "walkable" : "drivable"} way to ${esc(m.tripFail.dest)} within ${m.tripFail.slope}°.</div>` +
        (m.tripFail.why ? `<div class="hint">Blocked by: ${esc(m.tripFail.why)}.</div>` : "") +
        `<div class="crewBtns"><button type="button" data-act="why">Show why on the map</button>` +
        `<button type="button" data-act="from">🧭 Try another destination</button></div>`;
    } else if (A && !A.res.length) {
      // nothing on board runs out (RTG rover without crew): only "can it get there?"
      const ok = A.feasible;
      report = `<div class="crewVerdict ${ok ? "ok" : "bad"}">${ok ? "✓ Feasible" : "✗ Not feasible"} · ${esc(A.destName)}` +
        `${!ok && A.steep ? ` · ${A.steep} stretch${A.steep === 1 ? "" : "es"} steeper than ${m.maxSlope}°` : ""}</div>` +
        `<table class="crewTab"><tr><td>There</td><td>${fmtKm(A.outKm)} · ${fmtDur(A.outCal)}</td></tr>` +
        `<tr><td>Back</td><td>${fmtKm(A.retKm)} · ${fmtDur(A.retCal)}</td></tr>` +
        `<tr><td>Endurance</td><td>not limiting (${m.rtg ? "RTG power" : "no consumables modelled"})</td></tr></table>`;
    } else if (A) {
      const ok = A.feasible;
      report = `<div class="crewVerdict ${ok ? "ok" : "bad"}">${ok ? `✓ Can go, stay up to ${fmtDur(A.stayMax)} at ${esc(A.destName)}, and come back` : "✗ Not safe as planned"}` +
        `${!ok && A.steep ? ` · ${A.steep} stretch${A.steep === 1 ? "" : "es"} steeper than ${m.maxSlope}°` : ""}` +
        `${!ok && A.stayMax < 0 ? ` · ${RES_BY[A.stayLimit]?.name ?? A.res.map((k) => RES_BY[k].name).join("/")} runs below ${res}% before getting back` : ""}</div>` +
        `<table class="crewTab">` +
        `<tr><td>Out to ${esc(A.destName)}</td><td>${fmtKm(A.outKm)} · ${fmtDur(A.outCal)}</td></tr>` +
        A.stops.slice(1, -1).map((s) => `<tr class="minor"><td>· ${esc(s.name)}</td><td>${fmtKm(s.km)} · +${fmtDur(s.h)}${s.dwellH ? ` · sample ${Math.round(s.dwellH * 60)} min` : ""}</td></tr>`).join("") +
        `<tr><td>Max stay there</td><td>${A.res.length ? fmtDur(A.stayMax) : "unlimited"}${A.res.length && Number.isFinite(A.stayMax) ? ` (back with ${res}%)` : ""}</td></tr>` +
        `<tr><td>Planned stay</td><td>${fmtDur(A.stay)}</td></tr>` +
        `<tr><td>Back to base</td><td>${fmtKm(A.retKm)} · ${fmtDur(A.retCal)}</td></tr>` +
        `<tr><td>Whole trip</td><td>${fmtDur(A.outCal + A.stay + A.retCal)}</td></tr>` +
        (A.res.length ? `<tr><td>Left at the end</td><td>${A.res.map((k) => `${RES_BY[k].short} ${A.end[k].toFixed(0)}%`).join(" · ")}</td></tr>` : "") +
        (A.res.length ? `<tr><td>Point of no return</td><td>${A.pnr >= A.F.pts.length - 1 ? "beyond the destination" : `${fmtKm(A.F.d[A.pnr] / 1000)} out (${fmtDur(toCal(m, A.F.t[A.pnr]))}) · ${RES_BY[A.pnrBy]?.name ?? ""}`}</td></tr>` : "") +
        `<tr><td>Comms with base</td><td>${A.cover ? (A.cover.frac >= 0.999 ? "line of sight all the way" : `${Math.round(A.cover.frac * 100)}% of the way · lost from ~${fmtKm(A.cover.firstKm)}`) : "checking…"}</td></tr>` +
        `</table>`;
    } else report = `<div class="hint">Press <b>🧭 Walk from here</b> and click where ${esc(m.name)} should go, or plan a route in the Path tab (stop 1 = base) and press <b>Assign current route</b>.</div>`;
    const presetOpts = Object.entries(PRESETS).map(([k, p]) => `<option value="${k}" ${m.preset === k ? "selected" : ""}>${p.label}</option>`).join("");
    detailEl.innerHTML =
      `<div class="crewHead"><input data-k="name" value="${esc(m.name)}" maxlength="40" aria-label="Name" /><input data-k="color" type="color" value="${m.color}" aria-label="Colour" /></div>` +
      `<label class="crewF wide">Type<select data-k="preset">${presetOpts}</select></label>` +
      `<div class="crewGrid">` +
      num(m.type === "astronaut" ? "Walk speed, flat (km/h)" : "Average speed (km/h)", "speedKmh", m, 'step="0.01" min="0.001"') +
      num("Max slope (°)", "maxSlope", m, 'min="1" max="45"') +
      (m.o2 ? num("O₂ now (%)", "o2Pct", m, 'min="0" max="100"') + num("O₂ full lasts (h)", "o2Hours", m, 'step="0.5" min="0.5"') : "") +
      (m.water ? num("Water now (%)", "waterPct", m, 'min="0" max="100"') + num("Water full lasts (h)", "waterHours", m, 'step="0.5" min="0.5"') : "") +
      (m.battery && !m.rtg ? num("Battery now (%)", "batteryPct", m, 'min="0" max="100"') + num("Battery lasts (h)", "batteryHours", m, 'step="0.5" min="0.5"') : "") +
      (m.type !== "astronaut" ? num("Driving h per sol", "dutyHours", m, 'step="0.5" min="0.5" max="24"') : "") +
      `<label class="crewF">Stay (h, empty = max)<input data-k="stayH" type="number" step="0.25" min="0" value="${m.stayH ?? ""}" /></label>` +
      `</div>` +
      report +
      `<div class="crewBtns">` +
      `<button type="button" data-act="from" class="primary" title="Start at this member's current position, then click any point on the map: you get how long they can last, or whether the way is feasible">🧭 Walk from here…</button>` +
      `<button type="button" data-act="assign" ${route ? "" : "disabled"} title="Give this member the route drawn in the Path tab">Assign current route</button>` +
      `<button type="button" data-act="plan" title="Re-plan the Path tab's stops with this member's slope limit, then assign it">Plan with my limits (${m.maxSlope}°)</button>` +
      `</div><div class="crewBtns">` +
      (m.eva ? `<button type="button" data-act="abort" class="warnBtn">Return now</button><button type="button" data-act="stop">End EVA</button>`
        : `<button type="button" data-act="start" class="primary" ${A ? "" : "disabled"}>Start EVA</button>`) +
      `<button type="button" data-act="follow">${followId === m.id ? "Stop following" : "Follow"}</button>` +
      `<button type="button" data-act="fly">Fly to</button>` +
      `<button type="button" data-act="del" class="danger">Remove</button></div>` +
      (m.eva ? `<div class="hint">Telemetry: type the real O₂ / battery level above at any time; the model continues from it.</div>` : "");
  }
  detailEl.addEventListener("change", (e) => {
    const m = byId(selectedId), k = e.target.dataset.k;
    if (!m || !k) return;
    let v = e.target.value;
    if (k === "preset") {
      const p = PRESETS[v];
      Object.assign(m, { preset: v, type: p.type, speedKmh: p.speedKmh, maxSlope: p.maxSlope, o2: p.o2, o2Hours: p.o2Hours,
        water: p.water, waterHours: p.waterHours, battery: p.battery, batteryHours: p.batteryHours, dutyHours: p.dutyHours, rtg: p.rtg, suit: null });
      iconCache.clear();
    } else if (k === "name") m.name = v.trim() || m.name;
    else if (k === "color") { m.color = v; }
    else if (k === "stayH") m.stayH = v === "" ? null : Math.max(0, Number(v));
    else if (RES.some((r) => r.pct === k) && m.eva) {
      // live telemetry while out: shift the model so "now" equals the typed value
      const key = RES.find((r) => r.pct === k).key;
      const L = levels(m);
      m.eva.adj[key] += Math.max(0, Math.min(100, Number(v))) - L[key];
      e.target.value = m[k];
    } else {
      v = Number(v);
      if (!Number.isFinite(v)) return;
      if (RES.some((r) => r.pct === k)) v = Math.max(0, Math.min(100, v));
      m[k] = v;
    }
    save(); recompute(m); renderList(); renderDetail();
  });
  detailEl.addEventListener("click", async (e) => {
    const act = e.target.dataset?.act, m = byId(selectedId);
    if (!act || !m) return;
    if (act === "assign") assignRoute(m);
    else if (act === "from") walkFromHere(m);
    else if (act === "why") api.showPathTab?.();
    else if (act === "plan") { pendingPlanFor = m.id; api.planWithSlope(m.maxSlope, m.id); }
    else if (act === "start") {
      m.eva = { t0: Date.now(), c0: 0, adj: zeroUse() };
      toast("info", `${m.name}: EVA started towards ${analyses.get(m.id)?.destName}.`);
      save(); recompute(m);
    } else if (act === "abort") abortReturn(m);
    else if (act === "stop") { m.eva = null; for (const k of [...active.keys()]) if (k.startsWith(`${m.id}|`)) active.delete(k); save(); recompute(m); }
    else if (act === "follow") follow(followId === m.id ? null : m.id);
    else if (act === "fly") { const s = live.get(m.id)?.s ?? currentSample(m); if (s) viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 9000, MARS), duration: 1.2 }); }
    else if (act === "del") {
      if (!confirm(`Remove ${m.name}?`)) return;
      const en = ents.get(m.id);
      if (en) { viewer.entities.remove(en.marker); if (en.path) viewer.entities.remove(en.path); }
      if (followId === m.id) follow(null);
      members = members.filter((x) => x !== m); selectedId = members[0]?.id ?? null; save();
    }
    renderList(); renderDetail();
  });
  // "Return now": head straight back along the way out, from where the member is
  function abortReturn(m) {
    const A = analyses.get(m.id), tl = timelines.get(m.id), s = live.get(m.id)?.s;
    if (!A || !tl || !s || s.ph === "done") return;
    const now = simHours(m);
    const kept = tl.filter((p) => p.c <= now);
    kept.push({ ...s, c: now });
    if (s.ph === "out") {
      const i = Math.min(A.F.pts.length - 1, Math.floor(s.i));
      const back = profile(m, A.F.pts.slice(0, i + 1).reverse());
      for (let k = 1; k < back.pts.length; k++) {
        const p = back.pts[k];
        kept.push({ c: now + toCal(m, back.t[k]), lon: p.lon, lat: p.lat, e: p.e, ...Object.fromEntries(RES.map(({ key }) => [key, s[key] + back[key][k]])), ph: "back", i: k });
      }
    } else {
      const rest = tl.filter((p) => p.c > now && p.ph === "back");
      const shift = s.ph === "stay" ? (tl.find((p) => p.ph === "back")?.c ?? now) - now : 0;
      const firstBack = tl.find((p) => p.ph === "back");
      const usedShift = s.ph === "stay" ? Object.fromEntries(RES.map(({ key }) => [key, (firstBack?.[key] ?? s[key]) - s[key]])) : zeroUse();
      for (const p of rest) kept.push({ ...p, c: p.c - shift, ...Object.fromEntries(RES.map(({ key }) => [key, p[key] - usedShift[key]])) });
    }
    m.eva.abortTimeline = kept;
    timelines.set(m.id, kept);
    toast("warn", `${m.name}: ordered back to base, ${fmtDur(kept.at(-1).c - now)} away.`);
    drawEntities(m);
  }
  // Start where the member is now (live position on an EVA, else start of their route, else
  // where they were placed), let the user click a destination, plan it with the member's
  // slope limit, then assign it: the report shows how long they can last there, or, for
  // members with nothing that runs out, only whether the way is feasible.
  function walkFromHere(m) {
    const s = live.get(m.id)?.s ?? currentSample(m) ?? m.home;
    if (!s) { toast("warn", `${m.name}: no position yet.`); return; }
    if (!api.pickPoint || !api.planFromTo) return;
    fromHere = { id: m.id, phase: "pick" };
    m.tripFail = null;
    renderDetail();
    api.pickPoint((dest) => {
      if (!dest || fromHere?.id !== m.id) { if (fromHere?.id === m.id) fromHere = null; renderDetail(); return; }
      const destName = dest.name ?? `${dest.lat.toFixed(3)}°, ${dest.lon.toFixed(3)}°`;
      // an EVA in progress continues from its current O2 / battery
      if (m.eva) {
        const L = levels(m);
        for (const { key, pct } of RES) if (!(key === "bat" && m.rtg)) m[pct] = Math.max(0, Math.round(L[key]));
        m.eva = null;
      }
      m.home = { lon: s.lon, lat: s.lat, e: s.e ?? m.home?.e ?? 0 };
      save();
      fromHere = { id: m.id, phase: "plan", dest: { ...dest, name: destName }, slope: m.maxSlope };
      pendingPlanFor = m.id;
      renderDetail();
      api.planFromTo({ lon: s.lon, lat: s.lat, name: `${m.name} (start)` }, { ...dest, name: destName }, m.maxSlope, m.id);
    });
  }
  function follow(id) {
    followId = id;
    viewer.trackedEntity = id ? ents.get(id)?.marker : undefined;
    renderList(); renderDetail();
  }

  function assignRoute(m) {
    const r = api.getRoute();
    if (!r) return;
    // keep at most ~4000 samples (storage); always keep the stops themselves
    let raw = r.path;
    if (raw.length < 2) raw = r.stops.map((s) => ({ lon: s.lon, lat: s.lat, elevationM: r.path[0]?.elevationM ?? 0 })); // stops in one cell
    const step = Math.max(1, Math.ceil(raw.length / 4000));
    const keepIdx = new Set();
    let from = 0;
    const stopsRaw = r.stops.map((s, k) => {
      let best = from, bd = Infinity;
      const last = k === r.stops.length - 1;
      for (let i = from; i < raw.length; i++) {
        const d = (raw[i].lon - s.lon) ** 2 + (raw[i].lat - s.lat) ** 2;
        if (d < bd) { bd = d; best = i; }
        else if (!last && d > bd * 4 + 1e-6 && bd < 1e-6) break;
      }
      if (last) best = raw.length - 1;
      from = best;
      keepIdx.add(best);
      return best;
    });
    const idx = [];
    for (let i = 0; i < raw.length; i++) if (i % step === 0 || keepIdx.has(i) || i === raw.length - 1) idx.push(i);
    const pos = new Map(idx.map((v, k) => [v, k]));
    m.plan = {
      pts: idx.map((i) => ({ lon: raw[i].lon, lat: raw[i].lat, e: raw[i].elevationM ?? 0 })),
      stopIdx: stopsRaw.map((i) => pos.get(i)), stopNames: r.stops.map((s, k) => s.name || `Stop ${k + 1}`), loop: r.loop,
    };
    m.eva = null;
    m.tripFail = null;
    save(); recompute(m); renderList(); renderDetail();
    toast("info", `${m.name}: route assigned (${r.stops.length} stops${r.loop ? ", back to start" : ""}).`);
  }

  function select(id) {
    selectedId = id;
    renderList(); renderDetail();
  }
  function addMember(preset, home = null, extra = {}) {
    const p = PRESETS[preset];
    const used = new Set(members.map((m) => m.color));
    const palette = ["#4fc3f7", "#ffb74d", "#aed581", "#ce93d8", "#f06292", "#fff176", "#80cbc4", "#ff8a65"];
    const color = used.has(p.color) ? palette.find((c) => !used.has(c)) ?? p.color : p.color;
    const n = members.filter((m) => m.preset === preset).length + 1; // "Curiosity 1", not "Curiosity 3"
    const c = home ?? api.viewCentre();
    const m = {
      id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name: p.type === "astronaut" ? `Astronaut ${n}` : `${p.label.split(" (")[0]} ${n}`,
      preset, type: p.type, color, speedKmh: p.speedKmh, maxSlope: p.maxSlope,
      o2: p.o2, o2Hours: p.o2Hours, o2Pct: 100, water: p.water, waterHours: p.waterHours, waterPct: 100,
      battery: p.battery, batteryHours: p.batteryHours, batteryPct: 100,
      dutyHours: p.dutyHours, rtg: p.rtg, stayH: null, plan: null, eva: null, home: c, ...extra,
    };
    members.push(m);
    selectedId = m.id;
    save(); recompute(m); renderList(); renderDetail();
    if (c) sampleTerrainHeights([c], 6).then(([e]) => { m.home.e = e; save(); }).catch(() => {});
  }
  // "＋ Add" opens a menu of every preset (astronauts first, then rovers); picking one adds it
  const addBtn = $("crewAdd"), addMenu = $("crewAddMenu");
  const group = (type, title) => {
    const items = Object.entries(PRESETS).filter(([, p]) => p.type === type);
    if (!items.length) return [];
    const head = document.createElement("div");
    head.className = "grp"; head.textContent = title;
    return [head, ...items.map(([key, p]) => {
      const b = document.createElement("button");
      b.type = "button"; b.setAttribute("role", "menuitem"); b.dataset.preset = key;
      b.innerHTML = `<i style="background:${p.color}"></i>${esc(p.label)}<em>${p.speedKmh >= 1 ? `${p.speedKmh} km/h` : `${Math.round(p.speedKmh * 1000)} m/h`}</em>`;
      return b;
    })];
  };
  addMenu.replaceChildren(...group("astronaut", "Crew"), ...group("rover", "Rovers"));
  const setMenu = (open) => {
    addMenu.hidden = !open;
    addBtn.setAttribute("aria-expanded", String(open));
    if (open) addMenu.querySelector("button")?.focus();
  };
  addBtn.addEventListener("click", (e) => { e.stopPropagation(); setMenu(addMenu.hidden); });
  addMenu.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-preset]");
    if (!b) return;
    setMenu(false);
    addMember(b.dataset.preset);
  });
  addMenu.addEventListener("keydown", (e) => {
    const items = [...addMenu.querySelectorAll("button")], i = items.indexOf(document.activeElement);
    if (e.key === "Escape") { setMenu(false); addBtn.focus(); e.preventDefault(); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      items[(i + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus(); e.preventDefault();
    }
  });
  document.addEventListener("click", (e) => { if (!addMenu.hidden && !e.target.closest(".crewAddWrap")) setMenu(false); });

  // --- the live loop: positions, levels, alerts (1 Hz), comms (every 4 s)
  let commsBusy = false, lastComms = 0;
  function tick() {
    const now = Date.now();
    for (const m of members) {
      const tl = timelines.get(m.id), A = analyses.get(m.id);
      if (!m.eva || !tl || !A) { live.set(m.id, { s: null, label: m.name }); continue; }
      const s = sampleAt(tl, simHours(m, now));
      live.set(m.id, { s, label: "" });
      const L = levels(m), res = settings.reserve;
      const destC = tl.find((p) => p.ph !== "out")?.c ?? 0;
      live.get(m.id).label = s.ph === "done" ? `${m.name} · home` :
        s.ph === "out" ? `${m.name} · ETA ${clock(now + (destC - s.c) / settings.scale * 3_600_000)}` :
        s.ph === "stay" ? `${m.name} · at ${A.destName}` : `${m.name} · back ${clock(now + (tl.at(-1).c - s.c) / settings.scale * 3_600_000)}`;
      for (const k of A.res) {
        const name = RES_BY[k].name, v = L[k];
        if (s.ph === "done") { clear(m, `low-${k}`); clear(m, `turn-${k}`); continue; } // safe at base
        if (v <= res / 2) raise(m, `low-${k}`, "danger", `${name} critical at ${v.toFixed(0)}%. Immediate rescue needed.`);
        else if (v < res - 0.5) raise(m, `low-${k}`, "danger", `${name} below the ${res}% reserve (${v.toFixed(0)}%).`);
        else clear(m, `low-${k}`);
        // can they still get back with the reserve from here?
        const need = s.ph === "back" ? tl.at(-1)[k] - s[k]
          : s.ph === "stay" ? A.Rt[k].at(-1)
          : A.backAt(k, Math.min(A.F.pts.length - 1, Math.floor(s.i)));
        const verb = s.ph === "back" ? "keep going, no stops" : s.ph === "stay" ? "leave NOW" : "turn back NOW";
        if (v - need < 0) raise(m, `turn-${k}`, "danger", `will NOT make it home: ${name} runs out ${(need - v).toFixed(0)}% short. Send help.`);
        else if (v - need <= res) raise(m, `turn-${k}`, "danger", `must ${verb}: ${name} only just covers the way home.`);
        else if (s.ph !== "back" && v - need <= res + 5) raise(m, `turn-${k}`, "warn", `close to the point of no return (${name}).`);
        else clear(m, `turn-${k}`);
      }
      if (s.ph === "stay") raise(m, "arrived", "info", `arrived at ${A.destName}.`);
      if (s.ph === "done") raise(m, "home", "info", "back at base.");
    }
    if (!commsBusy && now - lastComms > 4000) {
      commsBusy = true; lastComms = now;
      (async () => {
        for (const m of members) {
          const s = live.get(m.id)?.s;
          if (!m.eva || !s || !base(m)) continue;
          if (s.ph === "done") { clear(m, "comms"); continue; }
          const r = await lineOfSight(base(m), s, settings.mastM, SP.suit_antenna_m);
          live.get(m.id).comms = r;
          if (!r.ok) raise(m, "comms", "warn", `communication with base lost: ${r.why}.`);
          else clear(m, "comms", "communication with base restored.");
        }
      })().finally(() => { commsBusy = false; });
    }
    refreshLive();
    viewer.scene.requestRender?.();
  }
  setInterval(tick, 1000);

  // initial
  for (const m of members) recompute(m);
  renderList(); renderDetail();
  tick();

  return {
    // a map pick on a crew marker or path
    pick(id) { select(id); api.entitySelected?.(id); api.showCrewTab(); },
    // the Path tab planned a route for this member: assign it when it is ready (once)
    assignTo(id) { if (byId(id)) pendingPlanFor = id; },
    // called after the Path tab finished a route
    // showcase scenario: once its route exists, put these presets at the start and assign it
    showcase(presets) { pendingShowcase = presets; },
    // A route file (signed demo or route.json) with its survival.js team: every crew entry
    // (Crew A, Crew B, with this scenario's suits) becomes a real member on that route, so it
    // can be followed, started as an EVA and checked one by one. Replaces the previous team.
    loadTeam({ crew = DEFAULT_CREW, params = {}, route, label = "Demo", heightAt = null } = {}) {
      if (!route?.path?.length || !route.waypoints?.length) return;
      for (const old of members.filter((x) => x.team)) {
        const en = ents.get(old.id);
        if (en) { viewer.entities.remove(en.marker); if (en.path) viewer.entities.remove(en.path); ents.delete(old.id); }
        if (followId === old.id) follow(null);
      }
      members = members.filter((x) => !x.team);
      const P = { ...SP, ...params };
      const pts = route.path.map((q) => ({ lon: q.lon, lat: q.lat, e: q.elevation_m ?? q.elevationM ?? 0 }));
      const wps = route.waypoints;
      const dense = densifyPlan(pts, wps.map((w) => Math.max(0, Math.min(pts.length - 1, w.index ?? 0))), heightAt);
      const plan = {
        pts: dense.pts, stopIdx: dense.stopIdx,
        stopNames: wps.map((w, k) => w.name || `Stop ${k + 1}`),
        loop: wps.length > 2 && wps.at(-1).role === "haven",
      };
      const dwellS = P.stop_dwell_s;
      const colours = ["#4fc3f7", "#f06292", "#fff176", "#80cbc4"];
      crew.forEach((c, k) => {
        addMember("astronaut", { lon: pts[0].lon, lat: pts[0].lat, e: pts[0].e }, {
          team: true, name: `${label} · ${c.name}`, suit: { ...c }, ...suitHours(c, P, false), color: colours[k % colours.length],
          dwellS, stayH: dwellS / 3600, // the last science stop's sampling time is the stay there
        });
        const m = members.at(-1);
        m.plan = plan;
        save(); recompute(m);
      });
      selectedId = members.find((x) => x.team)?.id ?? selectedId;
      renderList(); renderDetail();
    },
    routeComputed(ok) {
      if (pendingShowcase) {
        const keys = pendingShowcase;
        pendingShowcase = null;
        const r = ok ? api.getRoute() : null;
        if (r) {
          for (const old of members.filter((x) => x.showcase)) {
            const en = ents.get(old.id);
            if (en) { viewer.entities.remove(en.marker); if (en.path) viewer.entities.remove(en.path); ents.delete(old.id); }
          }
          members = members.filter((x) => !x.showcase);
          const start = r.stops[0];
          for (const k of keys) {
            addMember(k, { lon: start.lon, lat: start.lat, e: r.path[0]?.elevationM ?? 0 }, { showcase: true });
            assignRoute(members.at(-1));
          }
          selectedId = members.find((x) => x.showcase)?.id ?? selectedId;
          renderList(); renderDetail();
          api.showCrewTab();
        }
      }
      const m = pendingPlanFor ? byId(pendingPlanFor) : null;
      if (m && ok) assignRoute(m);
      if (m && !ok && fromHere?.id === m.id) {
        m.tripFail = { dest: fromHere.dest.name, slope: fromHere.slope, why: api.lastWhy?.() ?? "" };
        save();
        toast("warn", `${m.name}: no way to ${fromHere.dest.name} within ${fromHere.slope}°.`);
      }
      if (fromHere?.id === m?.id) fromHere = null;
      pendingPlanFor = null;
      renderDetail();
    },
    // the Path tab's "Why this route" changed (the relaxation checks finish later)
    routeWhyChanged() {
      const why = api.lastWhy?.();
      let changed = false;
      for (const m of members) if (m.tripFail && why && m.tripFail.why !== why && m.id === selectedId) { m.tripFail.why = why; changed = true; }
      if (changed) { save(); renderDetail(); }
    },
    routeCleared() { renderDetail(); },
  };
}
