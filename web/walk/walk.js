const ROUTE_KEY = "marsWalkRoute";
const PROGRESS_KEY = "marsWalkProgress";
const MARS_RADIUS_M = 3_396_190;
const RAD = Math.PI / 180;
const $ = (id) => document.getElementById(id);
const backBtn = $("back"), enterVrBtn = $("enterVr"), prevBtn = $("prev"), nextBtn = $("next"), exitBtn = $("exitWalk");
const loading = $("loading"), error = $("error"), errorText = $("errorText");
const title = $("title"), meta = $("meta"), progress = $("progress");

backBtn.addEventListener("click", () => { location.href = "../#route"; });

let route;
try { route = JSON.parse(localStorage.getItem(ROUTE_KEY) || "null"); } catch {}
const stops = Array.isArray(route?.stops)
  ? route.stops.filter((s) => s && typeof s.scene === "string" && /^[A-Za-z0-9_]+$/.test(s.scene) && Number.isFinite(s.lat) && Number.isFinite(s.lon))
  : [];
const DUPLICATE_STOP_M = 30;
let index = 0;
const visitedIds = new Set();
try {
  const saved = JSON.parse(localStorage.getItem(PROGRESS_KEY) || "null");
  if (saved?.routeId === route?.generatedAt && Number.isInteger(saved.index)) {
    index = Math.max(0, Math.min(stops.length - 1, saved.index));
    for (const id of saved.visitedIds ?? stops.slice(0, index + 1).map((s) => s.id)) visitedIds.add(id);
  }
} catch {}

function distanceM(a, b) {
  const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * MARS_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}
function bearingDeg(a, b) {
  const lat1 = a.lat * RAD, lat2 = b.lat * RAD, dLon = (b.lon - a.lon) * RAD;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}
function distanceLabel(m) { return m < 995 ? `${Math.max(1, Math.round(m / 5) * 5)} m` : `${(m / 1000).toFixed(1)} km`; }
const marsMod = (n, m) => ((n % m) + m) % m;
const marsRad = (d) => d * RAD;
const marsSinD = (d) => Math.sin(marsRad(d));
const marsCosD = (d) => Math.cos(marsRad(d));
function marsClock(date = new Date()) {
  const jdTT = date.getTime() / 86_400_000 + 2_440_587.5 + 69.184 / 86_400;
  const dt = jdTT - 2_451_545.0;
  const M = 19.3871 + 0.52402073 * dt;
  const aFMS = 270.3871 + 0.524038496 * dt;
  const terms = [[0.0071,2.2353,49.409],[0.0057,2.7543,168.173],[0.0039,1.1177,191.837],
    [0.0037,15.7866,21.736],[0.0021,2.1354,15.704],[0.0020,2.4694,95.528],[0.0018,32.8493,49.095]];
  const pbs = terms.reduce((sum, [a,tau,phi]) => sum + a * marsCosD((0.985626 * dt) / tau + phi), 0);
  const vMinusM = (10.691 + 3e-7 * dt) * marsSinD(M) + 0.623 * marsSinD(2*M) + 0.050 * marsSinD(3*M) +
    0.005 * marsSinD(4*M) + 0.0005 * marsSinD(5*M) + pbs;
  const Ls = marsMod(aFMS + vMinusM, 360);
  const eot = 2.861 * marsSinD(2*Ls) - 0.071 * marsSinD(4*Ls) + 0.002 * marsSinD(6*Ls) - vMinusM;
  const msd = (jdTT - 2_405_522.0028779) / 1.0274912517;
  const mtc = marsMod(24 * msd, 24);
  const decl = Math.asin(0.42565 * marsSinD(Ls)) / RAD + 0.25 * marsSinD(Ls);
  return { Ls, eot, mtc, decl };
}
function localMarsConditions(clock, lat, lon) {
  const lmst = marsMod(clock.mtc + lon / 15, 24);
  const ltst = marsMod(lmst + clock.eot / 15, 24);
  const hourAngle = (ltst - 12) * 15;
  const sunElevation = Math.asin(marsSinD(clock.decl) * marsSinD(lat) +
    marsCosD(clock.decl) * marsCosD(lat) * marsCosD(hourAngle)) / RAD;
  return { lmst, ltst, sunElevation };
}
function formatMarsTime(hours) {
  const seconds = Math.floor(marsMod(hours, 24) * 3600);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((n) => String(n).padStart(2, "0")).join(":");
}
function marsSeason(Ls, lat) {
  const north = ["spring", "summer", "autumn", "winter"][Math.floor(Ls / 90) % 4];
  const south = { spring: "autumn", summer: "winter", autumn: "spring", winter: "summer" }[north];
  return `${lat < 0 ? "southern" : "northern"} ${lat < 0 ? south : north}`;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function saveProgress() {
  try { localStorage.setItem(PROGRESS_KEY, JSON.stringify({ routeId: route?.generatedAt, index, visitedIds: [...visitedIds] })); } catch {}
}
function nextStopIndex() {
  const visited = stops.filter((s) => visitedIds.has(s.id));
  for (let i = index + 1; i < stops.length; i++) {
    const candidate = stops[i];
    if (visitedIds.has(candidate.id)) continue;
    if (visited.some((s) => distanceM(s, candidate) < DUPLICATE_STOP_M)) { visitedIds.add(candidate.id); continue; }
    return i;
  }
  return -1;
}
function setFailure(message) {
  loading.hidden = true; error.hidden = false; errorText.textContent = message;
  prevBtn.disabled = nextBtn.disabled = true;
}
if (!stops.length) {
  setFailure("Choose a start and an end on the Path tab, then press “Walk this route.” No Jezero panorama stops were saved for this route.");
  throw new Error("No Jezero walk stops in saved route");
}

let krpano = null;
let ready = false;
let serial = 0;
let walkPanelCreated = false;
let vrHudCanvas = null;
let vrHudContext = null;
let domIntroShown = false;
let vrIntroShown = false;
let introAnimationUntil = 0;
let immersiveVr = false;
let lastVrHudKey = "";
// Headset panel placement: below the eye line (under the floor arrow at atv 25) so it never
// covers the arrow or the view ahead; it lazily follows the gaze yaw like web/vr.js's HUD.
const VR_PANEL_ATV = 44, VR_PANEL_FOLLOW_DEG = 35;
const wrapDeg = (d) => ((((d + 180) % 360) + 360) % 360) - 180;
function placeVrPanelAtGaze() {
  if (!krpano || !walkPanelCreated) return;
  krpano.set("hotspot[mars_walk_status_panel].ath", Number(krpano.get("view.hlookat")) || 0);
  krpano.set("hotspot[mars_walk_status_panel].atv", VR_PANEL_ATV);
}
function followGazeWithVrPanel() {
  if (!krpano || !walkPanelCreated || !immersiveVr) return;
  const gaze = Number(krpano.get("view.hlookat")) || 0;
  const ath = Number(krpano.get("hotspot[mars_walk_status_panel].ath")) || 0;
  const diff = wrapDeg(gaze - ath);
  if (Math.abs(diff) > VR_PANEL_FOLLOW_DEG) krpano.set("hotspot[mars_walk_status_panel].ath", ath + diff * 0.2);
}
window.marsWalkVrChanged = (active) => {
  immersiveVr = Boolean(active);
  lastVrHudKey = ""; // force a fresh texture on enter/exit
  const preview = $("walkStatusPreview");
  if (preview) preview.hidden = immersiveVr;
  if (krpano && walkPanelCreated) {
    if (immersiveVr) placeVrPanelAtGaze();
    updateWalkPanel();
  }
};
// The FU Berlin tour.xml calls these page hooks from its VR events and controller buttons.
// They exist on the FU site but not here; without them krpano logs a js() error on every VR
// enter/exit. Map scene prev/next (left controller X/Y) onto the walk, the rest are no-ops.
window._krpanoVrEnter ??= () => {};
window._krpanoVrExit ??= () => {};
window.setVrListMode ??= () => {};
window.toggleListMode ??= () => {};
window.navigateFilteredList ??= (dir) => {
  if (Number(dir) > 0) window.marsWalkAdvance?.();
  else if (index > 0) loadStop(index - 1);
};
function setupWalkPanel() {
  if (!krpano || walkPanelCreated) return;
  krpano.call("addhotspot(mars_walk_status_panel);");
  const panel = "hotspot[mars_walk_status_panel]";
  krpano.set(`${panel}.type`, "image");
  krpano.set(`${panel}.ath`, 0);
  krpano.set(`${panel}.atv`, VR_PANEL_ATV);
  krpano.set(`${panel}.edge`, "center");
  krpano.set(`${panel}.depth`, 900);
  // Must be distorted: krpano's WebVR/WebXR view only draws WebGL-rendered (distorted)
  // hotspots into the headset. A non-distorted hotspot is a flat screen overlay and simply
  // does not appear in VR — that was the "HUD vanishes in VR" bug. (The FU tour's own VR menu
  // and our floor arrow are distorted for the same reason.)
  krpano.set(`${panel}.distorted`, true);
  krpano.set(`${panel}.zorder`, 50);
  krpano.set(`${panel}.keep`, true);
  // Distorted size is in sphere pixels at depth 1000: 600 px ≈ 33° wide, readable on Quest
  // without filling the view. Aspect matches the 1000×780 canvas.
  krpano.set(`${panel}.width`, 600);
  krpano.set(`${panel}.height`, 468);
  krpano.set(`${panel}.enabled`, false);
  krpano.set(`${panel}.capture`, false);
  krpano.set(`${panel}.visible`, false);
  vrHudCanvas = document.createElement("canvas");
  vrHudCanvas.width = 1000;
  vrHudCanvas.height = 780;
  vrHudContext = vrHudCanvas.getContext("2d");
  walkPanelCreated = true;
}
function drawVrHud(data) {
  if (!vrHudContext || !vrHudCanvas) return;
  const ctx = vrHudContext;
  const w = vrHudCanvas.width, h = vrHudCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(4,19,29,0.78)";
  ctx.strokeStyle = "#42DFFF";
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.roundRect(4, 4, w - 8, h - 8, 24); ctx.fill(); ctx.stroke();
  ctx.textBaseline = "top";
  ctx.fillStyle = "#9AEFFF";
  ctx.font = "28px Orbitron, Arial, sans-serif";
  ctx.fillText(`⌖ ${data.name}`, 28, 24, w - 56);

  const drawGauge = (x, label, value) => {
    ctx.fillStyle = "#0A2937"; ctx.strokeStyle = "#42DFFF"; ctx.lineWidth = 2;
    ctx.fillRect(x, 82, 464, 126); ctx.strokeRect(x, 82, 464, 126);
    ctx.fillStyle = "#9AEFFF"; ctx.font = "bold 23px Orbitron, Arial, sans-serif";
    ctx.fillText(`${label} ${value}%`, x + 16, 96);
    const full = 20, gap = 4, bw = 18; // 20 × (18 + 4) − 4 = 436 px: fits inside the 464 px gauge box
    for (let i = 0; i < full; i++) {
      ctx.fillStyle = i < Math.round(value / 5) ? "#42DFFF" : "#174453";
      ctx.fillRect(x + 16 + i * (bw + gap), 151, bw, 24);
    }
  };
  drawGauge(24, "▣ BATTERY", data.battery);
  drawGauge(512, "◉ OXYGEN", data.oxygen);

  ctx.font = "23px Orbitron, Arial, sans-serif";
  ctx.fillStyle = "#9AEFFF";
  const rows = [
    [`Latitude: ${data.coordLat}`, `Longitude: ${data.coordLon}`],
    [`Solar time: ${data.solarTime}`, `Mean time: ${data.meanTime}`],
    [`Sun: ${data.sunElevation}° · ${data.sunWord}`, `Season: Ls ${data.ls}° · ${data.season}`],
    [`Suit temp: ${data.suitTemperature}°C`, `Suit pressure: ${data.suitPressure} psi`],
    [`Surface temp: ${data.surfaceTemp}°C`, `Surface pressure: ${data.surfacePressure} mbar`],
  ];
  rows.forEach((row, i) => {
    const y = 250 + i * 62;
    ctx.fillText(row[0], 28, y, 460);
    ctx.fillText(row[1], 512, y, 460);
  });
  ctx.font = "18px Orbitron, Arial, sans-serif";
  ctx.fillText("Suit sensor readings can be added later.", 28, 558);
  ctx.fillStyle = "rgba(255,138,36,0.12)";
  ctx.strokeStyle = "#FF8A24"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(24, 590, 952, 150, 12); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#FF8A24"; ctx.font = "bold 23px Orbitron, Arial, sans-serif";
  ctx.fillText("⚠ GENERAL CAUTION", 42, 610);
  ctx.font = "21px Orbitron, Arial, sans-serif";
  ctx.fillText("Loose regolith or small rocks may make footing uneven.", 42, 655, 910);
  return vrHudCanvas.toDataURL("image/png");
}
function updateWalkPanel() {
  if (!krpano) return;
  setupWalkPanel();
  const stop = stops[index];
  const clock = marsClock();
  const local = localMarsConditions(clock, stop.lat, stop.lon);
  const progress = stops.length > 1 ? index / (stops.length - 1) : 0;
  const battery = Math.round(98 - 15 * progress);
  const oxygen = Math.round(96 - 18 * progress);
  // Presentation-only suit readings: pressure follows the familiar EMU reference, while
  // temperature stays in a narrow comfortable range with a slight per-stop change.
  const suitPressure = 4.30 + (((index % 3) - 1) * 0.01);
  const suitTemperature = 20.8 + Math.sin(index * 0.9) * 0.5;
  const surfaceTemp = Math.round(-59 + Math.max(-45, Math.min(60, local.sunElevation)) * 0.28);
  const surfacePressure = 6.36 + 0.45 * Math.sin(clock.Ls * RAD) + 0.1 * Math.sin(stop.lat * RAD);
  const sunWord = local.sunElevation > 0 ? "day" : local.sunElevation > -6 ? "twilight" : "night";
  const coordLat = `${Math.abs(stop.lat).toFixed(5)}°${stop.lat < 0 ? "S" : "N"}`;
  const coordLon = `${Math.abs(stop.lon).toFixed(5)}°${stop.lon < 0 ? "W" : "E"}`;
  const bar = (value) => "■".repeat(Math.round(value / 10)) + "□".repeat(10 - Math.round(value / 10));
  let inVr = false;
  try {
    const vrEnabled = krpano.get("webvr.isenabled");
    inVr = immersiveVr || vrEnabled === true || vrEnabled === "true" || vrEnabled === 1 || vrEnabled === "1";
  } catch {}
  const animateIntro = inVr ? !vrIntroShown : !domIntroShown;
  if (animateIntro) {
    if (inVr) vrIntroShown = true;
    else domIntroShown = true;
    introAnimationUntil = Date.now() + 2400;
  }
  const cautionDelay = Date.now() % 800;
  const markup = `
    <div class="${animateIntro ? "walk-typewriter" : ""}" style="font-family:'Orbitron',sans-serif;font-size:13px;font-weight:400;color:#9AEFFF;line-height:1.2;-webkit-text-stroke:0.35px #04131D">
      <div style="margin-bottom:6px">⌖ ${escapeHtml(stop.name || stop.title || `Jezero viewpoint ${index + 1}`)}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
        <div style="padding:6px;border:1px solid #42DFFF;background-color:#0A2937">▣ BATTERY ${battery}%<br/>${bar(battery)}</div>
        <div style="padding:6px;border:1px solid #42DFFF;background-color:#0A2937">◉ OXYGEN ${oxygen}%<br/>${bar(oxygen)}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 8px">
        <div>Latitude: ${coordLat}</div><div>Longitude: ${coordLon}</div>
        <div>Solar time: ${formatMarsTime(local.ltst)}</div><div>Mean time: ${formatMarsTime(local.lmst)}</div>
        <div>Sun: ${local.sunElevation.toFixed(1)}° · ${sunWord}</div><div>Season: Ls ${clock.Ls.toFixed(1)}° · ${marsSeason(clock.Ls, stop.lat)}</div>
        <div>Suit temp: ${suitTemperature.toFixed(1)}°C</div><div>Suit pressure: ${suitPressure.toFixed(2)} psi</div>
        <div>Surface temp: ${surfaceTemp}°C</div><div>Surface pressure: ${surfacePressure.toFixed(2)} mbar</div>
      </div>
      <div style="margin-top:5px">Suit sensor readings can be added later.</div>
      <div class="walk-caution" style="margin-top:7px;padding:5px 7px;border:1px solid #FF8A24;color:#FF8A24;animation-delay:-${cautionDelay}ms">⚠ GENERAL CAUTION · Loose regolith or small rocks may make footing uneven.</div>
    </div>`;
  const panel = $("walkStatusPreview");
  if (panel) {
    panel.innerHTML = markup;
    if (animateIntro) panel.classList.add("walk-typewriter");
  }
  // Use the DOM panel in flat preview and a scene-anchored hotspot in the headset.
  if (panel) panel.hidden = inVr;
  krpano.set("hotspot[mars_walk_status_panel].visible", inVr);
  if (inVr) {
    // Hours:minutes only in the headset. Every new url makes krpano reload the texture, and
    // re-uploading it every second made the panel blink out; now it changes about once a
    // Mars minute or on a new stop.
    const hhmm = (hours) => formatMarsTime(hours).slice(0, 5);
    const data = {
      name: stop.name || stop.title || `Jezero viewpoint ${index + 1}`,
      battery, oxygen, coordLat, coordLon,
      solarTime: hhmm(local.ltst), meanTime: hhmm(local.lmst),
      sunElevation: local.sunElevation.toFixed(1), sunWord,
      ls: clock.Ls.toFixed(1), season: marsSeason(clock.Ls, stop.lat),
      suitTemperature: suitTemperature.toFixed(1), suitPressure: suitPressure.toFixed(2),
      surfaceTemp, surfacePressure: surfacePressure.toFixed(2),
    };
    const key = JSON.stringify(data);
    if (key !== lastVrHudKey) {
      const vrHudImage = drawVrHud(data);
      if (vrHudImage) { krpano.set("hotspot[mars_walk_status_panel].url", vrHudImage); lastVrHudKey = key; }
    }
  }
}
function updateHud() {
  const stop = stops[index], n = nextStopIndex(), next = n >= 0 ? stops[n] : null;
  title.textContent = stop.name || stop.title || `Jezero viewpoint ${index + 1}`;
  const coords = `${Math.abs(stop.lat).toFixed(3)}° ${stop.lat < 0 ? "S" : "N"}, ${Math.abs(stop.lon).toFixed(3)}° ${stop.lon < 0 ? "W" : "E"}`;
  meta.textContent = `${coords} · FU Berlin Jezero Virtual Hiking Map`;
  progress.textContent = next ? `Stop ${index + 1} / ${stops.length} · ${distanceLabel(distanceM(stop, next))} to next stop` : `Stop ${index + 1} / ${stops.length} · Point B reached`;
  prevBtn.disabled = index === 0 || !ready;
  nextBtn.disabled = !next || !ready;
  exitBtn.hidden = !!next;
  updateWalkPanel();
}
function setHotspot() {
  if (!krpano) return;
  krpano.call("try(removehotspot(mars_walk_arrow)); try(removehotspot(mars_walk_finish));");
  const n = nextStopIndex();
  if (n >= 0) {
    const stop = stops[index], next = stops[n];
    const bearing = bearingDeg(stop, next);
    const ath = (bearing + 180) % 360;
    // Large transparent arrow image, anchored on the floor in the next stop's bearing.
    krpano.call(`addhotspot(mars_walk_arrow); set(hotspot[mars_walk_arrow].url,'/walk/next-arrow.svg'); set(hotspot[mars_walk_arrow].ath,${ath}); set(hotspot[mars_walk_arrow].atv,25); set(hotspot[mars_walk_arrow].width,220); set(hotspot[mars_walk_arrow].height,260); set(hotspot[mars_walk_arrow].distorted,true); set(hotspot[mars_walk_arrow].edge,center); set(hotspot[mars_walk_arrow].onclick,js(window.marsWalkAdvance()));`);
  } else {
    krpano.call("addhotspot(mars_walk_finish); set(hotspot[mars_walk_finish].type,text); set(hotspot[mars_walk_finish].text,'ARRIVED · EXIT WALK'); set(hotspot[mars_walk_finish].css,'font-family:Arial;font-size:30px;font-weight:bold;color:#ffffff;text-align:center;background-color:#06252cf5;border:4px solid #75e8ff;border-radius:24px;padding:22px 28px;'); set(hotspot[mars_walk_finish].ath,0); set(hotspot[mars_walk_finish].atv,0); set(hotspot[mars_walk_finish].distorted,true); set(hotspot[mars_walk_finish].edge,center); set(hotspot[mars_walk_finish].onclick,js(window.marsWalkExit()));");
  }
}
function loadStop(target) {
  if (!krpano || target < 0 || target >= stops.length) return;
  index = target;
  const stop = stops[index];
  visitedIds.add(stop.id || stop.scene); saveProgress();
  ready = false; const thisLoad = ++serial;
  loading.hidden = false;
  loading.firstElementChild.textContent = `Loading original high-resolution panorama ${index + 1} of ${stops.length}…`;
  updateHud();
  krpano.call(`loadscene(${stop.scene},null,MERGE|KEEPVIEW,BLEND(0.45));`);
  // onnewscene is authoritative; this timeout also handles a same-scene revisit.
  setTimeout(() => {
    if (thisLoad !== serial) return;
    krpano.call("set(view.hlookat,0); set(view.vlookat,0);");
    if (immersiveVr) placeVrPanelAtGaze();
    ready = true; loading.hidden = true; updateHud(); setHotspot();
  }, 900);
}
window.marsWalkAdvance = () => { const n = nextStopIndex(); if (n >= 0) loadStop(n); };
window.marsWalkExit = () => { location.href = "../#route"; };
prevBtn.addEventListener("click", () => { if (index > 0) loadStop(index - 1); });
nextBtn.addEventListener("click", window.marsWalkAdvance);
exitBtn.addEventListener("click", window.marsWalkExit);
enterVrBtn.addEventListener("click", () => {
  if (!krpano) return;
  // Invoke the source tour's WebVR/WebXR action directly from the user's click.
  krpano.call("webvr.enterVR();");
});
addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight" || event.key === " ") { event.preventDefault(); window.marsWalkAdvance(); }
  else if (event.key === "ArrowLeft" && index > 0) loadStop(index - 1);
});

updateHud();
if (typeof window.embedpano !== "function") {
  setFailure("The original Jezero panorama viewer did not load. Check your connection and reload this walk.");
} else {
  window.embedpano({
    xml: "../fu-vtour/tour.xml", target: "viewer", html5: "only", webxr: "prefer", mobilescale: 1.0,
    initvars: { startscene: stops[index].scene },
    onready(api) {
      krpano = api;
      // Cancel the original tour's autorotation so the visitor keeps control in VR.
      api.call("stopallsounds(); set(autorotate.enabled,false);");
      // The source tour hides its own entry layer by default; expose it and provide a
      // clear page-level control for Quest Browser as well.
      api.call("set(layer[webvr_enterbutton].visible,true); set(layer[webvr_enterbutton].enabled,true); set(layer[webvr_enterbutton].alpha,1);");
      enterVrBtn.hidden = false;
      setupWalkPanel();
      updateWalkPanel();
      setInterval(updateWalkPanel, 1000);
      // setInterval, not requestAnimationFrame: window rAF is paused during an immersive WebXR session.
      setInterval(followGazeWithVrPanel, 50);
      api.set("events.onnewscene", "js(window.marsWalkSceneReady())");
      api.set("events.webvr_onentervr", "js(window.marsWalkVrChanged(true))");
      api.set("events.webvr_onexitvr", "js(window.marsWalkVrChanged(false))");
      ready = true; loading.hidden = true;
      visitedIds.add(stops[index].id || stops[index].scene); saveProgress();
      updateHud(); setHotspot();
    },
    onerror(message) { setFailure(`Could not load the Jezero multiresolution panorama: ${message}`); },
  });
}
window.marsWalkSceneReady = () => {
  const token = serial;
  setTimeout(() => {
    if (!krpano || token !== serial) return;
    ready = true; loading.hidden = true; updateHud(); setHotspot();
  }, 250);
};
