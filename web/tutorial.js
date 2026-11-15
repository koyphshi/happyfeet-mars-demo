// Guided tutorial + hover help for every control in the dock.
//
// - Welcome pop-up on every load (Follow the tutorial / Skip), and Settings > "Launch tutorial".
// - Steps walk through mouse controls, then Settings, Layers, Spots, Path and Crew & EVA,
//   spotlighting one control at a time with a card that explains it.
// - Hover help: resting the mouse on any control for ~0.6 s shows a pop-up describing it (from
//   its title, or from HELP below for controls that had none).
//
// DOM only, no Cesium. index.html passes { showTab(id), runShowcase(id) }.

const HELP = {
  // Settings
  btnTop: "Look straight down at the surface.",
  btnTilt: "Tilt the camera 60° towards the horizon to see the relief in 3D.",
  tilt: "Camera tilt: 0° looks straight down, up to 80° looks towards the horizon. The camera turns around the point in the middle of the screen.",
  relief: "Show Mars in 3D using MOLA + HRSC elevation (needs the local server). The slider next to it exaggerates heights.",
  atmo: "Draw the thin Martian sky glow and dust haze around the planet.",
  btnTutorial: "Run this tutorial again.",
  // Layers
  layerSearch: "Search the NASA Trek catalog of Mars layers by name, instrument or mission, then click a result to add it.",
  globalOnly: "Only list layers that cover the whole planet. Untick to also find regional maps (e.g. HiRISE strips).",
  // Spots
  spotToggle: "Show or hide every spot pin on the map.",
  spotSearch: "Find spots by name, kind, tag or details, e.g. “Gale”, “crater”, “panorama”.",
  sourceSeg: "All spots, only the built-in global ones (missions and IAU named features), or only your custom spots.",
  tagSearch: "Filter by tags. Add several, then choose whether a spot needs all of them or any of them.",
  // Path
  routeSpotSearch: "Find a spot to add as a route stop.",
  routeSpotKind: "Only list spots of this kind.",
  routeSpotSort: "Order the spot list: nearest to the last stop, nearest to the view centre, by name or by size.",
  routeLoop: "Come back to the first stop at the end (a round trip).",
  routeSmooth: "Round off the corners of the drawn route (display only, the plan is unchanged).",
  maxSlope: "Steepest slope the route may use. Steeper cells are blocked and painted red after a route is calculated.",
  routeCalcBtn: "Plan the route through the stops with the options above.",
  routeWalkBtn: "Step through Jezero panoramas along the route (needs the local server).",
  routeClearBtn: "Remove all stops and the route.",
  // Crew & EVA
  showcaseSel: "Ready-made scenarios on real terrain: feasible EVAs, suit faults, detours, impossible routes, rovers vs astronauts.",
  showcaseRun: "Run the selected scenario: sets the stops and options, flies there and shows the result.",
  svScenario: "Suit condition used by the survival budget: standard suits or a hypothetical fault (water leak, low oxygen, long sampling).",
  routeImportFile: "Open a route.json saved earlier (its survival budget is recomputed here).",
  integrityChip: "The data files are checked against a signed manifest when the page loads. “Tamper test” shows a modified file being refused.",
};

const CSS = `
#tutLayer { position: fixed; inset: 0; z-index: 9000; pointer-events: none; }
#tutLayer.dim { background: rgba(0,0,0,.55); }
#tutSpot { position: fixed; border: 2px solid #9fd3ff; border-radius: 6px; box-shadow: 0 0 0 9999px rgba(0,0,0,.55); transition: all .25s ease; pointer-events: none; }
#tutCard { position: fixed; width: min(380px, calc(100vw - 32px)); background: #1b1b1b; color: #ddd; border: 1px solid #444; border-radius: 8px;
  box-shadow: 0 10px 30px #000a; padding: 12px 14px; font: 12.5px/1.45 system-ui, sans-serif; pointer-events: auto; }
#tutCard.center { left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(460px, calc(100vw - 32px)); text-align: left; }
#tutCard h3 { margin: 0 0 6px; font-size: 15px; color: #fff; }
#tutCard .sec { color: #9fd3ff; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 3px; }
#tutCard p { margin: 5px 0; } #tutCard ul { margin: 5px 0; padding-left: 18px; } #tutCard li { margin: 2px 0; }
#tutCard b { color: #fff; } #tutCard kbd { background: #2a2a2a; border: 1px solid #555; border-radius: 3px; padding: 0 4px; font: 11px ui-monospace, monospace; }
#tutCard .row { display: flex; align-items: center; gap: 6px; margin-top: 10px; }
#tutCard .row .count { color: #888; font-size: 11px; margin-right: auto; }
#tutCard button { font: 12px system-ui, sans-serif; padding: 4px 10px; border-radius: 4px; border: 1px solid #555; background: #262626; color: #eee; cursor: pointer; }
#tutCard button.primary { color: #151515; background: #e8b85a; border-color: #e8b85a; font-weight: 600; }
#tutCard button.link { border: 0; background: none; color: #9fd3ff; padding: 4px 2px; }
#tutCard button.end { margin-right: auto; border: 0; background: none; color: #bbb; padding: 4px 2px; }
#tutCard button.end:hover { color: #eee; }
#tutCard .mouse { display: grid; grid-template-columns: 34px 1fr; gap: 6px 8px; align-items: center; margin: 8px 0; }
#tutCard .mouse span:nth-child(odd) { font-size: 20px; text-align: center; }
#tutCard .mock { border: 1px solid #333; border-radius: 6px; background: #161616; padding: 8px; margin: 6px 0; display: grid; grid-template-columns: 92px 1fr; gap: 4px 8px; font-size: 11.5px; }
#tutCard .mock span:nth-child(odd) { color: #999; } #tutCard .mock span:nth-child(even) { color: #eee; border-bottom: 1px dashed #444; }
#tutCard .act { margin-top: 6px; }
#tutTip { position: fixed; z-index: 9100; max-width: 280px; background: #1b1b1b; color: #ddd; border: 1px solid #9fd3ff; border-radius: 6px; padding: 6px 8px;
  font: 12px/1.4 system-ui, sans-serif; box-shadow: 0 6px 18px #0009; pointer-events: none; }
`;

const el = (tag, attrs = {}, html = "") => Object.assign(document.createElement(tag), attrs, html ? { innerHTML: html } : {});

export function initTutorial({ showTab = () => {}, runShowcase = () => {} } = {}) {
  if (!document.getElementById("tutCss")) document.head.append(el("style", { id: "tutCss", textContent: CSS }));

  // ---------------------------------------------------------------- hover help
  // Controls without a title get one from HELP, then any control with a title shows a styled
  // pop-up after the mouse rests on it (the native tooltip is held back while ours is shown).
  for (const [id, text] of Object.entries(HELP)) {
    const node = document.getElementById(id);
    if (!node) continue;
    const target = node.closest("label") ?? node;
    if (!target.getAttribute("title") && !node.getAttribute("title")) node.setAttribute("title", text);
  }
  const tip = el("div", { id: "tutTip", hidden: true });
  document.body.append(tip);
  let tipTimer = 0, tipFor = null, held = null;
  const hideTip = () => {
    clearTimeout(tipTimer); tip.hidden = true; tipFor = null;
    if (held) { held.node.setAttribute("title", held.text); held = null; }
  };
  const dock = document.getElementById("dock") ?? document.body;
  dock.addEventListener("mousemove", (e) => {
    const node = e.target.closest?.("[title]") ?? (held && e.target.closest?.("*") === held.node ? held.node : null);
    if (node !== tipFor) hideTip();
    if (!node || tip.hidden === false) return;
    clearTimeout(tipTimer);
    const x = e.clientX, y = e.clientY;
    tipFor = node;
    tipTimer = setTimeout(() => {
      const text = node.getAttribute("title");
      if (!text) return;
      held = { node, text };
      node.removeAttribute("title"); // no native tooltip on top of ours
      tip.textContent = text;
      tip.hidden = false;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      tip.style.left = `${Math.min(window.innerWidth - w - 8, x + 14)}px`;
      tip.style.top = `${Math.min(window.innerHeight - h - 8, y + 16)}px`;
    }, 600);
  });
  dock.addEventListener("mouseleave", hideTip);
  dock.addEventListener("mousedown", hideTip);

  // ---------------------------------------------------------------- steps
  const tab = (id) => () => showTab(id);
  const steps = [
    { center: true, sec: "Basics", title: "Moving around Mars", html: `
      <p>The whole planet is live: zoom from orbit down to single craters.</p>
      <div class="mouse">
        <span>🖱️</span><span><b>Left-drag</b>: move across the planet</span>
        <span>🔍</span><span><b>Mouse wheel</b> or <b>right-drag</b>: zoom in and out</span>
        <span>↕️</span><span>Hold <b>both buttons</b> and drag up / down: tilt towards the horizon (up to 80°)</span>
        <span>👆</span><span>Touch: two fingers to zoom, two-finger drag up / down to tilt</span>
        <span>📍</span><span><b>Click</b> the ground to read every map layer at that point</span>
      </div>
      <p>The clock (top right) shows real local solar time on Mars where you look; the scale bar (bottom right) shows distances.</p>` },
    // Settings
    { before: tab("winSettings"), target: "#tabs [data-win='winSettings']", sec: "Settings", title: "Settings",
      html: "<p>Everything about how Mars is shown and how missions are judged. The most useful settings follow; <b>rest the mouse on any control</b> to see what it does.</p>" },
    { before: tab("winSettings"), target: "#view", sec: "Settings", title: "View & 3D relief",
      html: "<p><b>Top-down</b> or <b>Tilted</b>, the tilt slider, and <b>3D relief</b> (real MOLA elevation). The slider beside 3D relief exaggerates heights so craters and canyons stand out.</p>" },
    { before: tab("winSettings"), target: "#shadeRow", alt: "#shadeMode", sec: "Settings", title: "Lighting and time of day",
      html: "<p>Slopes are lit by the <b>real sun</b> at the current Mars time. <b>Time of day</b> can freeze the sun at any local hour, e.g. to see shadows at sunrise.</p>" },
    { before: tab("winSettings"), target: "#pinBehind", sec: "Settings", title: "Map spots",
      html: "<p><b>Show pins</b> limits how far away pins appear; <b>Behind planet</b> hides pins on the far side of Mars (or shows them faded).</p>" },
    { before: tab("winSettings"), target: "#crewReserve", sec: "Settings", title: "Crew & EVA safety",
      html: "<p><b>Return reserve</b>: how much oxygen / battery must be left when the crew is back. <b>Radio range</b> and <b>base antenna</b> drive line-of-sight alerts; <b>Simulation</b> speeds up EVAs.</p>" },
    { before: tab("winSettings"), target: "#hzDefaults", sec: "Settings", title: "Route hazard thresholds",
      html: "<p>The limits the route planner uses: how rough or how dusty ground may be, and the suit temperature limits. Each value's source is in its tooltip; <b>Defaults</b> restores them.</p>" },
    // Layers
    { before: tab("winLayers"), target: "#tabs [data-win='winLayers']", sec: "Layers", title: "What layers are",
      html: "<p>Layers are maps of Mars drawn on the globe: colour images, elevation, thermal and mineral maps. They come from <b>NASA's Mars Trek API</b> (the same data as trek.nasa.gov), with their mission, resolution and date shown under each one.</p>" },
    { before: tab("winLayers"), target: "#picker", sec: "Layers", title: "Adding and filtering layers",
      html: "<p>Pick a <b>type</b> (category) and type in the <b>search</b> box to filter 210+ Trek layers by name, instrument or mission. <b>Global only</b> hides regional maps. Click a result to add it.</p>" },
    { before: tab("winLayers"), target: "#layers", sec: "Layers", title: "Overlay, sort and fade",
      html: "<ul><li><b>Tick</b> a layer to show or hide it.</li><li><b>▲ / ▼</b> change the order: upper layers are drawn over lower ones.</li><li>The <b>slider</b> sets its opacity, to blend two maps.</li><li><b>✕</b> removes it.</li></ul>" },
    { before: tab("winLayers"), target: "#pathLayers", sec: "Layers", title: "Pathfinding view",
      html: "<p>One click shows the maps the route planner reasons with: slope, roughness, soft dust and dust cover, each with a colour key.</p>" },
    // Spots
    { before: tab("winSpots"), target: "#spotFilters", alt: "#spotSearch", sec: "Spots", title: "Spots and filters",
      html: "<p>Over 2,100 places: landers, rovers, panoramas and every IAU-named feature. Filter by <b>kind</b> (the coloured chips), by <b>tags</b>, or search by name.</p>" },
    { before: tab("winSpots"), target: "#sourceSeg", sec: "Spots", title: "Global and custom spots",
      html: "<p><b>Global</b> spots come with the app: NASA mission sites and USGS named features. <b>Custom</b> spots are the ones you add yourself; they are saved in this browser and can be exported / imported.</p>" },
    { before: tab("winSpots"), target: "#addSpotBtn", sec: "Spots", title: "Adding your own spot",
      html: `<p><b>＋ Add custom spot</b> opens a form like this (example):</p>
        <div class="mock"><span>Name</span><span>Layered outcrop B</span><span>Latitude</span><span>-4.79</span><span>Longitude (east)</span><span>137.39</span>
        <span>Kind</span><span>Science target</span><span>Colour</span><span>■ orange</span><span>Subtitle</span><span>Candidate EVA stop</span>
        <span>Description</span><span>Clear layering, 300 m from the haven…</span><span>Date</span><span>Sol 4995</span><span>Images</span><span>(optional photos)</span><span>Tags</span><span>Gale, EVA, Geology</span></div>
        <p>You can also pick the position on the map or use the view centre.</p>` },
    { before: tab("winSpots"), target: "#spots", sec: "Spots", title: "Going to a spot",
      html: "<p>Click a spot in the list or a <b>pin on the map</b>: the camera flies there and a card opens with a photo, facts, the source, <b>Add to route</b> and, for panoramas, <b>Open 360° / VR view</b>.</p>" },
    // Path
    { before: tab("winRoute"), target: "#routeAddBtn", sec: "Path", title: "Adding stops",
      html: "<p><b>＋ Click on map</b>, then click where a stop goes. You can also add spots from the list below (search, kind, sort) or use <b>Add to route</b> on a spot card. Drag stops to reorder them.</p>" },
    { before: tab("winRoute"), target: "#routeRough", alt: "#routeLoop", sec: "Path", title: "What the route may cross",
      html: "<ul><li><b>Max slope</b>: steeper ground is blocked (red cells).</li><li><b>Avoid rough terrain</b>: bumpy ground costs more, very rough ground is blocked.</li><li><b>Avoid soft dust</b>: regional dust mantles are blocked.</li><li><b>Prefer less dusty ground</b>, <b>Fastest walk</b> (time, not distance), <b>Return to start</b>.</li></ul>" },
    { before: tab("winRoute"), target: "#routeFor", sec: "Path", title: "Terrain only, or for a crew member",
      html: "<p><b>Terrain only</b> says what the ground and hazards allow. Pick a crew member or rover to also get their oxygen, battery, ETA and survival budget.</p>" },
    { before: tab("winRoute"), target: "#routeCalcBtn", sec: "Path", title: "An example route",
      html: `<p>Press below to plan a real example: Curiosity's landing site to Mount Sharp with a 10° slope limit. The cyan line is the route; red cells are too steep.</p>
        <div class="act"><button type="button" data-run="detourSlope" class="primary">▶ Show the example</button></div>` },
    { before: tab("winRoute"), target: "#routeWhy", alt: "#routeStatus", sec: "Path", title: "Why this route",
      html: "<p>Under the route, <b>Why this route</b> says whether the direct line works and, if not, what blocked it (worst slope, roughness or dust against the limit), how much longer the detour is, and red / orange labels mark the spots on the map. With no route at all, it says which change would make one possible.</p>" },
    // Crew & EVA
    { before: tab("winCrew"), target: "#showcaseSect", sec: "Crew & EVA", title: "Scenarios",
      html: `<p>One-click simulations on real terrain: a feasible EVA, suit faults, detours, impossible routes, rovers vs astronauts. Choose one and press <b>▶ Run</b>.</p>
        <div class="act"><button type="button" data-run="ok" class="primary">▶ Run the demo EVA</button></div>` },
    { before: tab("winCrew"), target: "#survivalBox", sec: "Crew & EVA", title: "Mission results",
      html: "<p>The <b>survival budget</b> says GO or REFUSED for the two-person team, with oxygen, cooling water and battery at return and the walk-back limit. <b>Crew A</b> and <b>Crew B</b> appear below as crew members you can follow along the route.</p>" },
    { before: tab("winCrew"), target: "#crewAdd", sec: "Crew & EVA", title: "Your own simulation",
      html: "<p><b>＋ Add</b> an astronaut or a rover, click its marker, then <b>🧭 Walk from here</b> and click a destination: you get how long they can last there, or whether the way is feasible. <b>Start EVA</b> plays it out with live alerts.</p>" },
    { center: true, sec: "Done", title: "You're ready",
      html: "<p>That's the tour. Rest the mouse on any control for help, and run this tutorial again from <b>Settings → Launch tutorial</b>.</p>" },
  ];

  // ---------------------------------------------------------------- engine
  let layer = null, spot = null, card = null, at = -1, follow = 0;
  const visible = (node) => node && node.getClientRects().length > 0;
  function targetOf(s) {
    const a = s.target && document.querySelector(s.target);
    if (visible(a)) return a;
    const b = s.alt && document.querySelector(s.alt);
    return visible(b) ? b : null;
  }
  function place() {
    if (at < 0) return;
    const s = steps[at], t = targetOf(s);
    if (s.center || !t) {
      layer.classList.add("dim"); spot.hidden = true; card.className = "center";
      card.style.left = card.style.top = ""; return;
    }
    layer.classList.remove("dim"); spot.hidden = false; card.className = "";
    const r = t.getBoundingClientRect(), pad = 4;
    Object.assign(spot.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    const cw = card.offsetWidth, ch = card.offsetHeight;
    // right of the target if there is room (the dock is on the left), else below / above
    let left = r.right + 14, top = Math.max(10, Math.min(window.innerHeight - ch - 10, r.top));
    if (left + cw > window.innerWidth - 10) {
      left = Math.max(10, Math.min(window.innerWidth - cw - 10, r.left));
      top = r.bottom + 12 + ch < window.innerHeight ? r.bottom + 12 : Math.max(10, r.top - ch - 12);
    }
    card.style.left = `${left}px`; card.style.top = `${top}px`;
  }
  function show(i) {
    at = Math.max(0, Math.min(steps.length - 1, i));
    const s = steps[at];
    try { s.before?.(); } catch (error) { console.warn("Tutorial step:", error); }
    card.innerHTML = `<div class="sec">${s.sec} · ${at + 1} / ${steps.length}</div><h3>${s.title}</h3>${s.html}
      <div class="row"><button type="button" data-go="skip" class="end">End tutorial</button>
        ${at ? '<button type="button" data-go="back">Back</button>' : ""}
        <button type="button" data-go="next" class="primary">${at === steps.length - 1 ? "Finish" : "Next"}</button></div>`;
    setTimeout(() => { targetOf(s)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); setTimeout(place, 350); }, 60);
    place();
  }
  function stop() {
    clearInterval(follow); follow = 0;
    layer?.remove(); layer = spot = card = null; at = -1;
    document.removeEventListener("keydown", onKey, true);
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); stop(); }
    else if (e.key === "ArrowRight" && at >= 0) show(at + 1);
    else if (e.key === "ArrowLeft" && at > 0) show(at - 1);
  }
  function start() {
    stop();
    layer = el("div", { id: "tutLayer" });
    spot = el("div", { id: "tutSpot", hidden: true });
    card = el("div", { id: "tutCard", role: "dialog", ariaLabel: "Tutorial" });
    layer.append(spot, card);
    document.body.append(layer);
    card.addEventListener("click", (e) => {
      const go = e.target.closest("[data-go]")?.dataset.go, run = e.target.closest("[data-run]")?.dataset.run;
      if (run) { runShowcase(run); return; }
      if (go === "next") { if (at === steps.length - 1) stop(); else show(at + 1); }
      else if (go === "back") show(at - 1);
      else if (go === "skip") stop();
    });
    document.addEventListener("keydown", onKey, true);
    follow = setInterval(place, 400); // the dock scrolls, tabs change, the window resizes
    window.addEventListener("resize", place);
    show(0);
  }
  // Welcome pop-up (every load): follow along, or skip.
  function welcome() {
    stop();
    layer = el("div", { id: "tutLayer", className: "dim" });
    spot = el("div", { id: "tutSpot", hidden: true });
    card = el("div", { id: "tutCard", className: "center", role: "dialog", ariaLabel: "Welcome" }, `
      <div class="sec">Tutorial</div><h3>Welcome to Mars View's Tutorial</h3>
      <p>A short tour: how to move around the planet, then each tab: <b>Settings</b>, <b>Layers</b>, <b>Spots</b>, <b>Path</b> and <b>Crew & EVA</b>, highlighting what you can change and what it does.</p>
      <p>About 3 minutes. You can leave at any time with <kbd>Esc</kbd>, and start it again from <b>Settings → Launch tutorial</b>.</p>
      <div class="row"><span class="count"></span><button type="button" data-w="skip">Skip</button><button type="button" data-w="go" class="primary">Follow the tutorial</button></div>`);
    layer.append(spot, card);
    document.body.append(layer);
    card.addEventListener("click", (e) => {
      const w = e.target.closest("[data-w]")?.dataset.w;
      if (w === "go") start(); else if (w === "skip") stop();
    });
    document.addEventListener("keydown", onKey, true);
  }
  document.getElementById("btnTutorial")?.addEventListener("click", start);
  return { start, welcome, stop };
}
