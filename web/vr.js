// WebXR replay of the signed demo excursion (web/public/data/route.json).
// Three.js only (no Cesium). 1 unit = 1 metre, x = east, y = up, -z = north, origin = haven.
// Reads the same route.json the map exports; terrain is the route's own height excerpt.
import * as THREE from "three";
import { VRButton } from "./vendor/three/VRButton.js";
import { verifyManifest, checkFile } from "./integrity.js";
import { MANIFEST_PUBLIC_KEY, MANIFEST_KEY_ID } from "./integrity-pubkey.js";
import { parseRoute, excerptSampler } from "./route-io.js";
import { walkingSpeed, metabolicPower, rates, surfaceDistanceM, MARS_RADIUS_M } from "./survival.js";

const ROUTE_PATH = "public/data/route.json";
const EYE = 1.6;
const statusEl = document.getElementById("status");
const say = (t) => { statusEl.textContent = t; };

// ---------------------------------------------------------------- load + verify
async function loadRoute() {
  const res = await fetch(`./${ROUTE_PATH}`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`route.json: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let integrity = { ok: false, text: "not checked" };
  try {
    const [m, s] = await Promise.all([fetch("./public/integrity/manifest.json", { cache: "no-cache" }), fetch("./public/integrity/manifest.sig", { cache: "no-cache" })]);
    const manifest = await verifyManifest(await m.text(), await s.text(), MANIFEST_PUBLIC_KEY);
    checkFile(manifest, ROUTE_PATH, bytes);
    integrity = { ok: true, text: `verified · key ${MANIFEST_KEY_ID.slice(0, 8)}` };
  } catch (e) {
    integrity = { ok: false, refused: e.code !== "unsupported", text: e.code === "unsupported" ? "not checked (no Ed25519 in this browser)" : `MISMATCH: ${e.message}` };
  }
  // refuse before parsing: a tampered file that is not even valid JSON must still be reported as an
  // integrity failure, not as a JSON syntax error
  if (integrity.refused) return { route: null, integrity };
  return { route: parseRoute(new TextDecoder().decode(bytes)), integrity };
}

// Per-path-point timeline for the replay: time, distance and each crew member's remaining
// fraction of every consumable (same functions as the survival card).
function replayTable(route) {
  const p = route.params, pts = route.path;
  const dwellAt = new Map(route.timeline.filter((t) => t.dwell_s).map((t) => [t.index, t.dwell_s]));
  const rows = [{ t: 0, d: 0, crew: route.crew.map(() => ({ o2: 1, water: 1, battery: 1 })) }];
  const used = route.crew.map(() => ({ o2: 0, water: 0, battery: 0 }));
  let t = 0, d = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], seg = surfaceDistanceM(a, b);
    const grade = seg ? (b.elevation_m - a.elevation_m) / seg : 0;
    const v = walkingSpeed(grade, p), dt = seg ? seg / v : 0;
    route.crew.forEach((c, k) => {
      const r = rates(metabolicPower(grade, v, c, p), p), dw = dwellAt.get(i) ?? 0, rs = rates(p.metabolic_stop_w * c.metabolic_scale, p);
      used[k].o2 += r.o2 * dt + rs.o2 * dw; used[k].water += r.water * dt + rs.water * dw; used[k].battery += r.battery * dt + rs.battery * dw;
    });
    t += dt + (dwellAt.get(i) ?? 0); d += seg;
    rows.push({ t, d, dwell: dwellAt.get(i) ?? 0, crew: route.crew.map((c, k) => ({ o2: 1 - used[k].o2 / c.o2_kg, water: 1 - used[k].water / c.water_kg, battery: 1 - used[k].battery / c.battery_wh })) });
  }
  return rows;
}

// ---------------------------------------------------------------- canvas HUD panels
function makePanel(w = 0.8, h = 0.5, px = 512) {
  const canvas = document.createElement("canvas");
  canvas.width = px; canvas.height = Math.round((px * h) / w);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  mesh.renderOrder = 10;
  return { mesh, canvas, ctx: canvas.getContext("2d"), tex };
}
function panelFrame(P, title, accent = "#38bdf8") {
  const { ctx, canvas } = P;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(8,12,20,0.86)"; roundRect(ctx, 2, 2, canvas.width - 4, canvas.height - 4, 18); ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 4; ctx.stroke();
  ctx.fillStyle = accent; ctx.font = "bold 30px system-ui, sans-serif"; ctx.fillText(title, 22, 44);
  ctx.fillStyle = "#e5e7eb"; ctx.font = "24px system-ui, sans-serif";
}
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function wrapText(ctx, text, x, y, maxW, lineH, maxLines = 6) {
  const words = String(text).split(/\s+/); let line = "", n = 0;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); y += lineH; line = w; if (++n >= maxLines - 1) break; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineH;
}
const fmtT = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`; };

function labelSprite(text, color = "#fde68a") {
  const c = document.createElement("canvas"); c.width = 512; c.height = 96;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgba(8,12,20,0.8)"; roundRect(ctx, 2, 2, 508, 92, 20); ctx.fill();
  ctx.fillStyle = color; ctx.font = "bold 44px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  s.renderOrder = 5;
  return s;
}

// ---------------------------------------------------------------- main
const { route, integrity } = await loadRoute().catch((e) => { say(`Could not load the route: ${e.message}`); throw e; });
if (integrity.refused || !route) { say(`REFUSED — ${integrity.text}. The VR replay only shows the signed route.`); throw new Error("route.json failed the integrity check"); }
const sampler = excerptSampler(route.terrain);
const haven = route.waypoints[0];
const h0 = haven.elevation_m ?? route.path[0].elevation_m;
const lat0 = haven.lat * Math.PI / 180, RAD = Math.PI / 180;
let exag = 1;
const toXZ = (lon, lat) => [((lon - haven.lon) * RAD) * Math.cos(lat0) * MARS_RADIUS_M, -((lat - haven.lat) * RAD) * MARS_RADIUS_M];
const groundY = (lon, lat) => ((sampler(lon, lat) ?? h0) - h0) * exag;
const fromXZ = (x, z) => [haven.lon + x / (Math.cos(lat0) * MARS_RADIUS_M) / RAD, haven.lat - z / MARS_RADIUS_M / RAD];
const table = replayTable(route);
const stops = route.waypoints.filter((w, k) => k === 0 || w.role !== "haven");

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType("local-floor");
document.body.append(renderer.domElement);
document.body.append(VRButton.createButton(renderer));

const SKY = new THREE.Color("#c8a079");
const scene = new THREE.Scene();
scene.background = SKY;
scene.fog = new THREE.Fog(SKY, 900, 4200);
scene.add(new THREE.HemisphereLight("#f3dcc0", "#5a3a28", 1.1));
const sun = new THREE.DirectionalLight("#fff1dc", 1.6); sun.position.set(-600, 900, 300); scene.add(sun);

const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 8000);
camera.rotation.order = "YXZ";
const rig = new THREE.Group(); rig.add(camera); scene.add(rig);
camera.position.set(0, EYE, 0); // desktop eye height; WebXR local-floor replaces it with the real head pose
renderer.xr.addEventListener("sessionstart", () => { camera.position.set(0, 0, 0); hud.scale.setScalar(1); hud.position.y = 0; });
renderer.xr.addEventListener("sessionend", () => { camera.position.set(0, EYE, 0); hud.scale.setScalar(0.75); hud.position.y = 0.05; });

const world = new THREE.Group(); scene.add(world);
let terrainMesh = null, beacons = [], walker = null;

function buildWorld() {
  world.clear();
  beacons = [];
  const t = route.terrain, { west, east, south, north } = t.bounds;
  // terrain: one mesh, vertex colours by slope (red above the suit limit)
  const pos = new Float32Array(t.cols * t.rows * 3), col = new Float32Array(t.cols * t.rows * 3);
  const hAt = (c, r) => t.heights[r * t.cols + c] ?? h0;
  for (let r = 0; r < t.rows; r++) for (let c = 0; c < t.cols; c++) {
    const lon = west + ((east - west) * c) / (t.cols - 1), lat = north - ((north - south) * r) / (t.rows - 1);
    const [x, z] = toXZ(lon, lat), k = (r * t.cols + c) * 3;
    pos[k] = x; pos[k + 1] = (hAt(c, r) - h0) * exag; pos[k + 2] = z;
    const dx = t.width_m / (t.cols - 1), dz = t.height_m / (t.rows - 1);
    const sx = (hAt(Math.min(c + 1, t.cols - 1), r) - hAt(Math.max(c - 1, 0), r)) / (2 * dx);
    const sz = (hAt(c, Math.min(r + 1, t.rows - 1)) - hAt(c, Math.max(r - 1, 0))) / (2 * dz);
    const slope = Math.atan(Math.hypot(sx, sz)) / RAD;
    const steep = slope > route.params.max_slope_deg;
    const shade = 0.85 + 0.15 * Math.sin(lon * 4000) * Math.cos(lat * 3000); // faint texture so motion reads
    col[k] = (steep ? 0.85 : 0.62) * shade; col[k + 1] = (steep ? 0.2 : 0.38) * shade; col[k + 2] = (steep ? 0.15 : 0.24) * shade;
  }
  const idx = [];
  for (let r = 0; r < t.rows - 1; r++) for (let c = 0; c < t.cols - 1; c++) {
    const a = r * t.cols + c, b = a + 1, d = a + t.cols, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  terrainMesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  world.add(terrainMesh);
  // surrounding plain so the patch edge is not a cliff into the void (no data: flat, labelled in the HUD)
  const minY = Math.min(...t.heights.filter((h) => h != null)) - h0;
  const plain = new THREE.Mesh(new THREE.CircleGeometry(9000, 48).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: "#7a4b30" }));
  plain.position.y = minY * exag - 2; world.add(plain);

  // route: a 3 m ribbon draped on the terrain every ~8 m, comms-blackout stretches in orange
  const ribbon = (from, to, color, width, lift) => {
    const v = [], ix = [];
    for (let i = from + 1; i <= to; i++) {
      const a = route.path[i - 1], b = route.path[i];
      const [xa, za] = toXZ(a.lon, a.lat), [xb, zb] = toXZ(b.lon, b.lat);
      const len = Math.hypot(xb - xa, zb - za) || 1, nx = -(zb - za) / len * width / 2, nz = (xb - xa) / len * width / 2;
      const n = Math.max(1, Math.ceil(len / 8));
      for (let k = i === from + 1 ? 0 : 1; k <= n; k++) {
        const f = k / n, x = xa + (xb - xa) * f, z = za + (zb - za) * f;
        const [lon, lat] = fromXZ(x, z), y = groundY(lon, lat) + lift;
        v.push(x + nx, y, z + nz, x - nx, y, z - nz);
      }
    }
    for (let q = 0; q < v.length / 6 - 1; q++) { const a = q * 2; ix.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3)); g.setIndex(ix);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    world.add(m);
  };
  ribbon(0, route.path.length - 1, "#22d3ee", 3, 0.4);
  for (const b of route.blackout) ribbon(b.from, b.to, "#f97316", 3.4, 0.5);

  // beacons: haven green, science yellow, walk-back limit orange
  const beacon = (lon, lat, color, text, data) => {
    const [x, z] = toXZ(lon, lat), y = groundY(lon, lat);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 60, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    m.position.set(x, y + 30, z); m.userData = data; world.add(m); beacons.push(m);
    const s = labelSprite(text, color); s.position.set(x, y + 72, z); s.scale.set(60, 11.25, 1); world.add(s);
  };
  stops.forEach((w, k) => beacon(w.lon, w.lat, k === 0 ? "#4ade80" : "#facc15", `${k + 1} · ${w.name.replace(/ \(.*\)$/, "")}`, { stop: k }));
  const seen = new Set();
  for (const c of route.survival.crew) {
    const i = c.walk_back.index;
    if (i >= route.path.length - 1 || seen.has(i)) continue;
    seen.add(i); const p = route.path[i];
    beacon(p.lon, p.lat, "#fb923c", `Walk-back limit · ${c.name}`, { index: i });
  }
  walker = new THREE.Mesh(new THREE.SphereGeometry(3, 16, 12), new THREE.MeshBasicMaterial({ color: "#f0abfc" }));
  walker.visible = false; world.add(walker); placeWalker(0);
}

// ---------------------------------------------------------------- HUD (four panels, lazily follows gaze yaw)
const hud = new THREE.Group(); rig.add(hud);
hud.scale.setScalar(0.75); hud.position.y = 0.05; // desktop: smaller (reset in XR)
const panels = [makePanel(), makePanel(), makePanel(), makePanel()];
panels.forEach((P, k) => {
  const ang = (k - 1.5) * 0.45; // arc of four panels in front, below eye level
  P.mesh.position.set(Math.sin(ang) * 2.0, 1.05, -Math.cos(ang) * 2.0);
  P.mesh.rotation.set(-0.25, -ang, 0);
  hud.add(P.mesh);
});
let replay = { playing: false, t: 0, row: 0 }; // t in mission seconds
const total = table.at(-1).t;

function drawHud() {
  const row = table[replay.row], s = route.survival, reserve = route.params.reserve_frac;
  // 1 consumables
  let P = panels[0]; panelFrame(P, "Consumables");
  const bar = (x, y, v, label) => {
    const { ctx } = P; ctx.fillStyle = "#1e293b"; ctx.fillRect(x, y, 140, 26);
    ctx.fillStyle = v < 0 ? "#ef4444" : v < reserve ? "#f59e0b" : "#22c55e"; ctx.fillRect(x, y, Math.max(0, Math.min(1, v)) * 140, 26);
    ctx.fillStyle = "#fff"; ctx.fillRect(x + reserve * 140, y - 3, 3, 32);
    ctx.font = "20px system-ui"; ctx.fillText(`${label} ${Math.round(v * 100)}%`, x + 4, y + 20);
  };
  route.crew.forEach((c, k) => {
    const y = 90 + k * 70; P.ctx.font = "bold 24px system-ui"; P.ctx.fillStyle = "#e5e7eb"; P.ctx.fillText(c.name, 22, y + 20);
    bar(130, y, row.crew[k].o2, "O₂"); bar(278, y, row.crew[k].water, "H₂O"); P.ctx.font = "20px system-ui";
  });
  P.ctx.font = "20px system-ui"; P.ctx.fillStyle = "#e5e7eb";
  route.crew.forEach((c, k) => { P.ctx.fillText(`${c.name} battery ${Math.round(row.crew[k].battery * 100)}%`, 22, 245 + k * 26); });
  P.ctx.fillStyle = "#94a3b8"; P.ctx.fillText(`white tick = ${Math.round(reserve * 100)}% reserve`, 290, 290);
  P.tex.needsUpdate = true;
  // 2 ETA / timeline
  P = panels[1]; panelFrame(P, "ETA · timeline", "#a78bfa");
  P.ctx.fillText(`T+ ${fmtT(row.t)} of ${fmtT(total)}   ${(row.d / 1000).toFixed(2)} of ${(route.distance_m / 1000).toFixed(2)} km`, 22, 86);
  let y = 122;
  for (const t of route.timeline) {
    P.ctx.fillStyle = t.t_s <= row.t ? "#86efac" : "#e5e7eb";
    P.ctx.fillText(`${t.t_s <= row.t ? "✓" : "·"} ${t.name.slice(0, 22)}  T+${fmtT(t.t_s)}`, 22, y); y += 32;
  }
  P.tex.needsUpdate = true;
  // 3 walk-back margin
  P = panels[2]; panelFrame(P, "Walk-back limit", "#fb923c");
  y = 86;
  for (const c of s.crew) {
    const inside = replay.row <= c.walk_back.index;
    P.ctx.fillStyle = inside ? "#e5e7eb" : "#fca5a5";
    P.ctx.fillText(`${c.name}: ${(c.walk_back.dist_m / 1000).toFixed(2)} km ${inside ? "✓ can turn back" : "✗ past the limit"}`, 22, y); y += 34;
    P.ctx.fillStyle = "#94a3b8"; P.ctx.fillText(`tightest margin ${Math.round(c.tightest.margin_frac * 100)}% (${c.tightest.consumable})`, 40, y); y += 40;
  }
  P.ctx.fillStyle = "#94a3b8"; wrapText(P.ctx, "Return leg = path reversed (upper bound).", 22, y, 470, 28, 2);
  P.tex.needsUpdate = true;
  // 4 verdict + integrity + warnings
  P = panels[3]; panelFrame(P, s.feasible ? "GO" : "REFUSED", s.feasible ? "#4ade80" : "#f87171");
  P.ctx.fillStyle = integrity.ok ? "#86efac" : "#fca5a5"; P.ctx.font = "bold 22px system-ui";
  P.ctx.fillText(`${integrity.ok ? "✓" : "✗"} route.json ${integrity.text}`.slice(0, 44), 120, 44);
  P.ctx.font = "21px system-ui"; P.ctx.fillStyle = "#e5e7eb";
  y = wrapText(P.ctx, s.verdict.replace(/^(GO|REFUSED) — /, ""), 22, 84, 470, 26, 3);
  P.ctx.fillStyle = "#fcd34d";
  for (const w of route.warnings.slice(0, 2)) y = wrapText(P.ctx, `⚠ ${w.text}`, 22, y, 470, 26, 2);
  P.ctx.fillStyle = "#94a3b8";
  wrapText(P.ctx, `Terrain ~200 m/px DEM, relief ${exag}×: visualization, not walk-scale.`, 22, Math.max(y, 262), 470, 26, 2);
  P.tex.needsUpdate = true;
}

// ---------------------------------------------------------------- movement
const tmpV = new THREE.Vector3(), camDir = new THREE.Vector3();
function teleportTo(lon, lat, faceLon, faceLat) {
  const [x, z] = toXZ(lon, lat);
  rig.position.set(x, groundY(lon, lat), z);
  if (faceLon != null) {
    const [fx, fz] = toXZ(faceLon, faceLat);
    const yaw = Math.atan2(-(fx - x), -(fz - z));
    if (renderer.xr.isPresenting) rig.rotation.y = yaw; else { rig.rotation.y = 0; camera.rotation.set(-0.08, yaw, 0); }
  }
}
function snapHud() { // after a teleport, put the HUD where the user is looking
  camera.updateMatrixWorld(); camera.getWorldDirection(camDir);
  hud.rotation.y = Math.atan2(-camDir.x, -camDir.z) - rig.rotation.y;
}
function goStop(k) {
  const w = stops[k], next = stops[(k + 1) % stops.length];
  teleportTo(w.lon, w.lat, next.lon, next.lat);
  snapHud();
  say(`At stop ${k + 1}: ${w.name}`);
}
// Overview: 220 m above the ground, 500 m south-east of the route centre, looking at it (labelled).
function goOverview() {
  const lons = route.path.map((p) => p.lon), lats = route.path.map((p) => p.lat);
  const cLon = (Math.min(...lons) + Math.max(...lons)) / 2, cLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const [cx, cz] = toXZ(cLon, cLat), [ox, oz] = [cx + 380, cz + 380], [oLon, oLat] = fromXZ(ox, oz);
  teleportTo(oLon, oLat, cLon, cLat);
  rig.position.y += 220;
  if (!renderer.xr.isPresenting) camera.rotation.x = -0.3;
  snapHud();
  say("Overview: 220 m above the ground (not a crew viewpoint)");
}
function snapTurn(dir) { rig.rotation.y += dir * Math.PI / 6; }
function placeWalker(i) {
  const p = route.path[i]; const [x, z] = toXZ(p.lon, p.lat);
  walker?.position.set(x, groundY(p.lon, p.lat) + 6, z);
}

const raycaster = new THREE.Raycaster();
function pick(origin, dir) {
  raycaster.set(origin, dir); raycaster.far = 8000;
  const hits = raycaster.intersectObjects([...beacons, terrainMesh], false);
  return hits[0] ?? null;
}
function actOnHit(hit) {
  if (!hit) return;
  const d = hit.object.userData;
  if (d?.stop != null) return goStop(d.stop);
  if (d?.index != null) { const p = route.path[d.index]; teleportTo(p.lon, p.lat); return say("At a walk-back limit"); }
  const [lon, lat] = fromXZ(hit.point.x, hit.point.z);
  teleportTo(lon, lat);
  say(`Teleported to ${lat.toFixed(4)}°, ${lon.toFixed(4)}°E`);
}

// XR controllers: ray + reticle, trigger = teleport, thumbstick x = snap turn
const reticle = new THREE.Mesh(new THREE.RingGeometry(1.5, 2.5, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: "#f0f9ff", depthTest: false }));
reticle.visible = false; scene.add(reticle);
const controllers = [0, 1].map((i) => {
  const c = renderer.xr.getController(i);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: "#e0f2fe" }));
  line.scale.z = 50; c.add(line);
  c.addEventListener("selectstart", () => { const h = rayHit(c); actOnHit(h); });
  rig.add(c);
  return c;
});
const rotM = new THREE.Matrix4();
function rayHit(c) {
  rotM.identity().extractRotation(c.matrixWorld);
  const o = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
  const d = new THREE.Vector3(0, 0, -1).applyMatrix4(rotM);
  return pick(o, d);
}
let turnArmed = true;
function pollGamepads() {
  const session = renderer.xr.getSession();
  if (!session) return;
  let x = 0;
  for (const src of session.inputSources) { const a = src.gamepad?.axes; if (a && a.length >= 4 && Math.abs(a[2]) > Math.abs(x)) x = a[2]; }
  if (Math.abs(x) > 0.7 && turnArmed) { snapTurn(x > 0 ? -1 : 1); turnArmed = false; }
  if (Math.abs(x) < 0.3) turnArmed = true;
  const h = rayHit(controllers[1]) ?? rayHit(controllers[0]);
  reticle.visible = !!h; if (h) reticle.position.copy(h.point).add(tmpV.set(0, 0.5, 0));
}

// desktop: drag to look, click to teleport, keys
let drag = null;
renderer.domElement.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; });
addEventListener("pointermove", (e) => {
  if (!drag || renderer.xr.isPresenting) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
  camera.rotation.y -= dx * 0.004; camera.rotation.x = Math.max(-1.4, Math.min(1.4, camera.rotation.x - dy * 0.004));
});
addEventListener("pointerup", (e) => {
  if (drag && drag.moved < 5 && e.target === renderer.domElement) {
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera); raycaster.far = 8000;
    actOnHit(raycaster.intersectObjects([...beacons, terrainMesh], false)[0]);
  }
  drag = null;
});
addEventListener("keydown", (e) => {
  if (/^[1-9]$/.test(e.key) && stops[Number(e.key) - 1]) goStop(Number(e.key) - 1);
  if (e.key === "0") goOverview();
  if (e.key === "h" || e.key === "H") hud.visible = !hud.visible;
  if (e.key === "ArrowLeft") snapTurn(1);
  if (e.key === "ArrowRight") snapTurn(-1);
  if (e.key === " ") togglePlay();
});
addEventListener("resize", () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// DOM controls
const stopsEl = document.getElementById("stops");
{ const b = document.createElement("button"); b.textContent = "0 · Overview"; b.onclick = goOverview; stopsEl.append(b); }
stops.forEach((w, k) => { const b = document.createElement("button"); b.textContent = `${k + 1} · ${w.name.replace(/ \(.*\)$/, "")}`; b.onclick = () => goStop(k); stopsEl.append(b); });
const playBtn = document.getElementById("play");
function togglePlay() {
  if (replay.row >= table.length - 1) { replay.t = 0; replay.row = 0; }
  if (!replay.playing && replay.t === 0) goOverview(); // watch the walk from above, not from inside the marker
  replay.playing = !replay.playing; walker.visible = true;
  playBtn.textContent = replay.playing ? "⏸ Pause" : "▶ Replay walk";
}
playBtn.onclick = togglePlay;
{ const b = document.createElement("button"); b.type = "button"; b.textContent = "HUD on/off (H)"; b.onclick = () => { hud.visible = !hud.visible; }; playBtn.after(b); }
document.getElementById("exag").onchange = (e) => { exag = Number(e.target.value); buildWorld(); goStop(0); drawHud(); };

// ---------------------------------------------------------------- loop
const SPEEDUP = Math.max(60, total / 75); // whole excursion in ~75 s
const clock = new THREE.Clock();
let hudTimer = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(0.1, clock.getDelta());
  if (replay.playing) {
    replay.t = Math.min(total, replay.t + dt * SPEEDUP);
    while (replay.row < table.length - 1 && table[replay.row + 1].t <= replay.t) replay.row++;
    const a = table[replay.row], b = table[Math.min(replay.row + 1, table.length - 1)];
    const f = b.t > a.t ? Math.max(0, (replay.t - a.t - 0) / (b.t - a.t)) : 0;
    const pa = route.path[replay.row], pb = route.path[Math.min(replay.row + 1, route.path.length - 1)];
    const [xa, za] = toXZ(pa.lon, pa.lat), [xb, zb] = toXZ(pb.lon, pb.lat);
    const wx = xa + (xb - xa) * f, wz = za + (zb - za) * f, [wl, wt] = fromXZ(wx, wz);
    walker.position.set(wx, groundY(wl, wt) + 6, wz);
    if (replay.t >= total) togglePlay();
  }
  hudTimer += dt;
  if (hudTimer > 0.25) { hudTimer = 0; drawHud(); }
  // HUD lazily follows the gaze yaw (comfort: it never sticks to the face)
  camera.getWorldDirection(camDir);
  const gazeYaw = Math.atan2(-camDir.x, -camDir.z) - rig.rotation.y;
  let diff = gazeYaw - hud.rotation.y; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  if (Math.abs(diff) > 0.6) hud.rotation.y += diff * Math.min(1, dt * 3);
  pollGamepads();
  renderer.render(scene, camera);
});

buildWorld();
goStop(0);
drawHud();
if (!integrity.refused) say(`${route.label || route.site} · ${(route.distance_m / 1000).toFixed(2)} km · ${route.survival.feasible ? "GO" : "REFUSED"} · route.json ${integrity.text}`);
window.happyfeetVR = { route, integrity, goStop, togglePlay, get replay() { return replay; } };
