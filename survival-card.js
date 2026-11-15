// Survival card for the route panel: renders a route.json "survival" block into a container.
// DOM only (no Cesium). Styles are injected once.
const CSS = `
.svCard{margin-top:8px;border:1px solid #3a4150;border-radius:8px;padding:8px 10px;font-size:12px;line-height:1.35;background:rgba(10,14,22,.6)}
.svCard.go{border-color:#2f8f5b}.svCard.no{border-color:#c2410c;background:rgba(60,14,6,.55)}
.svVerdict{font-weight:700;margin-bottom:6px}.svCard.go .svVerdict{color:#6ee7a8}.svCard.no .svVerdict{color:#fdba74}
.svMeta{display:flex;flex-wrap:wrap;gap:4px 12px;color:#cbd5e1;margin-bottom:6px}
.svCrew{display:grid;grid-template-columns:auto 1fr 1fr 1fr;gap:3px 8px;align-items:center;margin:6px 0}
.svCrew b{font-weight:600;color:#e2e8f0}.svCrew .h{color:#94a3b8;font-size:11px}
.svBar{position:relative;height:14px;border-radius:3px;background:#1e293b;overflow:hidden}
.svBar i{position:absolute;inset:0 auto 0 0;background:#22c55e}.svBar.low i{background:#f59e0b}.svBar.out i{background:#ef4444}
.svBar u{position:absolute;top:0;bottom:0;width:1px;background:#fff;opacity:.7}
.svBar span{position:relative;padding-left:4px;font-size:10px;color:#fff;text-shadow:0 0 2px #000}
.svWarn{margin:4px 0 0;padding-left:16px;color:#fcd34d}.svWarn li.refuse{color:#fca5a5}
.svTl{margin:6px 0 0;padding-left:16px;color:#cbd5e1}.svFoot{margin-top:6px;color:#94a3b8;font-size:11px}
.svRow{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px;align-items:center}
.svRow select,.svRow button{font-size:12px}
`;
let styled = false;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const fmtDuration = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min` : `${m} min`; };

export function renderSurvivalCard(el, route, { onWalkBack } = {}) {
  if (!styled) { const st = document.createElement("style"); st.textContent = CSS; document.head.append(st); styled = true; }
  const s = route.survival, reserve = route.params.reserve_frac;
  const bar = (v) => {
    const cls = v < 0 ? "out" : v < reserve ? "low" : "";
    return `<div class="svBar ${cls}" title="${Math.round(v * 100)}% left at return"><i style="width:${Math.max(0, Math.min(100, v * 100))}%"></i><u style="left:${reserve * 100}%"></u><span>${Math.round(v * 100)}%</span></div>`;
  };
  const crewRows = s.crew.map((c) => `<b>${esc(c.name)}</b>${bar(c.reserve.o2)}${bar(c.reserve.water)}${bar(c.reserve.battery)}`).join("");
  const wb = s.crew.map((c) => `${esc(c.name)} ${(c.walk_back.dist_m / 1000).toFixed(2)} km`).join(" · ");
  el.innerHTML = `
    <div class="svCard ${s.feasible ? "go" : "no"}" role="status">
      <div class="svVerdict">${esc(s.verdict)}</div>
      <div class="svMeta"><span>Distance ${(route.distance_m / 1000).toFixed(2)} km</span><span>ETA ${fmtDuration(route.eta_s)}</span>
        <span>Comms risk +${Math.round(s.risk_cost_s)} s</span><span>Return: ${esc(s.return_leg)}</span></div>
      <div class="svCrew"><span></span><span class="h">O₂ at return</span><span class="h">Cooling water</span><span class="h">Battery</span>${crewRows}</div>
      <div title="Furthest distance along the route from which each crew member can still walk back with the ${Math.round(reserve * 100)}% reserve">
        Walk-back limit (along the route): ${wb} <span class="h">of ${(route.distance_m / 1000).toFixed(2)} km</span></div>
      ${route.warnings.length ? `<ul class="svWarn">${route.warnings.map((w) => `<li class="${w.level}">${esc(w.text)}</li>`).join("")}</ul>` : ""}
      <ol class="svTl">${route.timeline.map((t) => `<li>${esc(t.name)} — T+${fmtDuration(t.t_s)}, ${(t.dist_m / 1000).toFixed(2)} km${t.dwell_s ? ` (sample ${Math.round(t.dwell_s / 60)} min)` : ""}</li>`).join("")}</ol>
      <div class="svFoot">${{ signed: "Route file: signed demo, bytes verified against the manifest.", live: "Live route computed in this browser: a live check, not signed.", file: "Route opened from a local file: not signed.", unchecked: "Route file: integrity not checked (browser lacks Ed25519)." }[route._origin] ?? ""}</div>
      <div class="svFoot">White tick = ${Math.round(reserve * 100)}% reserve. Coefficients are ASSUMED unless cited in docs/assumptions.md. Terrain: ${esc(route.profile.terrain_source)} (km-scale, indicative).</div>
    </div>`;
  if (onWalkBack) onWalkBack(s.crew);
}
