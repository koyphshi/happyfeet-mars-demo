// Atmosphere at Gale: latest sols measured by REMS on Curiosity. Live feed first (CORS-open),
// committed snapshot (public/data/rems/latest.json) if the feed is unreachable.
// Honesty: these are past measurements, not a forecast; opacity is qualitative only.
const LIVE = "/rems"; // serve.mjs relays https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json
const SNAPSHOT = "./public/data/rems/latest.json";

export async function loadRems({ timeoutMs = 15000 } = {}) {
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetch(LIVE, { signal: ctl.signal }); clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const d = await res.json();
    return { live: true, source: d.source, fetched: d.fetched_utc, soles: d.soles };
  } catch {
    const d = await (await fetch(SNAPSHOT)).json();
    return { live: false, source: d.source, snapshot: d.snapshot_utc, soles: d.soles };
  }
}

const num = (v) => (v === "--" || v == null || v === "" ? null : Number(v));
export function latestValid(soles) {
  return soles.find((s) => num(s.min_temp) != null && num(s.max_temp) != null) ?? soles[0];
}

export function renderRems(el, data) {
  const s = latestValid(data.soles);
  const f = (v, u) => (num(v) == null ? "—" : `${num(v)} ${u}`);
  el.innerHTML = `
    <div class="layer remsBox">
      <div class="head"><span><b>Atmosphere · Gale</b> <span class="kindChip k-atmo">atmospheric</span></span></div>
      <div class="remsGrid">
        <span>Sol ${s.sol}</span><span>${s.terrestrial_date} · Ls ${s.ls}°</span>
        <span>Air</span><span>${f(s.min_temp, "°C")} … ${f(s.max_temp, "°C")}</span>
        <span>Ground</span><span>${f(s.min_gts_temp, "°C")} … ${f(s.max_gts_temp, "°C")}</span>
        <span>Pressure</span><span>${f(s.pressure, "Pa")}</span>
        <span>UV index</span><span>${s.local_uv_irradiance_index ?? "—"}</span>
        <span>Sky</span><span>${s.atmo_opacity ?? "—"} (qualitative)</span>
        <span>Sun</span><span>${s.sunrise}–${s.sunset} LMST</span>
      </div>
      <div class="note prov">REMS on Curiosity · NASA/JPL-Caltech/CAB · ${data.live ? `live feed, fetched ${String(data.fetched).slice(0, 16)}Z` : `snapshot ${data.snapshot}`} · measured, not a forecast ·
        <a href="${data.source}" target="_blank" rel="noopener">source</a></div>
    </div>`;
}
