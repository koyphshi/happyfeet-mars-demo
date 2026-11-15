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
function updateHud() {
  const stop = stops[index], n = nextStopIndex(), next = n >= 0 ? stops[n] : null;
  title.textContent = stop.name || stop.title || `Jezero viewpoint ${index + 1}`;
  const coords = `${Math.abs(stop.lat).toFixed(3)}° ${stop.lat < 0 ? "S" : "N"}, ${Math.abs(stop.lon).toFixed(3)}° ${stop.lon < 0 ? "W" : "E"}`;
  meta.textContent = `${coords} · FU Berlin Jezero Virtual Hiking Map`;
  progress.textContent = next ? `Stop ${index + 1} / ${stops.length} · ${distanceLabel(distanceM(stop, next))} to next stop` : `Stop ${index + 1} / ${stops.length} · Point B reached`;
  prevBtn.disabled = index === 0 || !ready;
  nextBtn.disabled = !next || !ready;
  exitBtn.hidden = !!next;
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
    krpano.call("addhotspot(mars_walk_finish); set(hotspot[mars_walk_finish].type,text); set(hotspot[mars_walk_finish].text,'ARRIVED · EXIT WALK'); set(hotspot[mars_walk_finish].css,'font-family:Arial;font-size:30px;font-weight:bold;color:#ffffff;text-align:center;background-color:#06252cf5;border:4px solid #75e8ff;border-radius:24px;padding:22px 28px;'); set(hotspot[mars_walk_finish].ath,0); set(hotspot[mars_walk_finish].atv,0); set(hotspot[mars_walk_finish].onclick,js(window.marsWalkExit()));");
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
      api.set("events.onnewscene", "js(window.marsWalkSceneReady())");
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
