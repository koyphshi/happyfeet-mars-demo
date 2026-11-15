# Features — HappyFeet Mars mission planner

What the app does, tab by tab, and how to use each feature. Numbers and sources behind every
model are in [`assumptions.md`](assumptions.md); data provenance in [`curiosity-data.md`](curiosity-data.md),
signed data in [`integrity.md`](integrity.md), the `route.json` format in [`route-schema.md`](route-schema.md),
deployment in [`deploy.md`](deploy.md).

**Live:** https://happyfeet-mars.onrender.com (full app) · https://koyphshi.github.io/happyfeet-mars-demo/ (static backup) · [5-minute judges' walkthrough](judges-walkthrough.md)

**Run it:** `cd web && npm ci && node serve.mjs` → http://localhost:8080. Tests: `cd web && npm test`.
Route planning, 3D relief and layer search need this local server. The static demo
(GitHub Pages) shows the globe, layers, spots and the signed demo excursion, but not live routes.

**Tutorial:** every time the page loads, a welcome pop-up offers a guided tour (or Skip). The tour
covers mouse controls, then Settings, Layers, Spots, Path and Crew & EVA, spotlighting the controls
that matter. Run it again any time from **Settings → Launch tutorial**. **Hover help:** rest the
mouse on any control in the panel for a moment to see what it does. The page opens on the whole
planet; it no longer flies to the same spot on every load.

**Moving around:** left-drag pans, the mouse wheel or right-drag zooms, and holding **both** buttons
while dragging up or down tilts (max 80°). On touch, a two-finger drag tilts. The camera turns around
the point where the screen centre touches the ground, and it never goes below the terrain.

---

## The globe

- **Mars as it is:** imagery from NASA Trek (Viking colour mosaic, MOLA/HRSC relief, HiRISE at Gale)
  draped on MOLA elevation. **3D relief** with adjustable height exaggeration (Settings).
- **Real Mars time:** the clock (top right) shows local solar time where you look, the sol, the
  coordinates, the sun's height and the season. It uses NASA's Mars24 algorithm (Allison & McEwen 2000);
  at Curiosity's landing it gives 15:03 local time, matching NASA's "about 3 p.m.".
- **Real sun and sky:** slopes are lit by the sun's actual position. The stars turn with Mars's
  real rotation (IAU model: one turn per 24 h 37 min, pole near Deneb), consistent with the sun to 0.12°.
- **Scale bar** (bottom right): distance to the view centre and view width.
- **Click anywhere** to read every visible layer's value at that point.

## Layers tab

- **Pathfinding view:** one click shows the data the route planner reasons with, each with a
  colour key: elevation/slope, roughness, soft dust (TES thermal inertia), dust cover. **All on / All off.**
- **Atmosphere at Gale:** the latest Curiosity REMS weather (air and ground temperature, pressure,
  UV, sunrise and sunset), labelled as a measurement, not a forecast.
- **Layer stack:** show, hide, reorder and fade each layer. Each one carries a provenance chip
  (kind, dataset, mission, resolution, date, credit).
- **Add layer:** search the full NASA Trek catalog (210+ Mars products) by name, type or instrument.

## Spots tab

- **2,100+ places:** 73 mission spots (landers, rovers, crash sites, the Curiosity boxwork target,
  64 rover 360° panoramas) and every IAU-named feature (craters, valleys, mountains…).
- Filter by kind, tag, global or custom, and search by name. Pins on the far side of Mars are hidden
  (Settings → Behind planet can show them faded instead), and smaller features show up as you zoom
  in, in proportion to their size.
- **Spot card:** photo, mission facts, source link, **Add to route**, and **Open 360° / VR view** or the
  NASA source page.
- **Custom spots:** add your own (saved in this browser).

## Path tab — terrain route planner

- **For:** who the route is for. **Terrain only** (the default) reports only what the ground and
  hazards allow or block: no oxygen, water or battery, no survival budget, no suit temperature check.
  Pick a crew member or rover (or click their card or marker) to add their resources, ETA and
  survival budget. Crew-started plans (Walk from here, Plan with my limits) pick the member automatically.
- **Stops:** click the map, pick from the nearby-spots list, or use a spot card. Drag to reorder.
  **Return to start** makes a loop.
- **Planner:** any-angle Theta* search over MOLA heights (~2.6 km cells). It never uses cells steeper
  than **Max slope**, and long routes are planned coarse first, then refined along a corridor.
  - **Fastest walk:** minimises walking time (slope-dependent speed) instead of distance.
  - **Avoid rough terrain:** roughness computed from MOLA. Bumpy ground costs more; very rough ground is blocked.
  - **Avoid soft dust:** regional dust mantles from TES thermal inertia are blocked (qualitative, ~21 km/px).
  - **Prefer less dusty ground:** dusty surfaces cost more, but are never blocked.
- **Why this route:** for each leg, what blocked or slowed the straight line (worst value against
  the limit, how many km), how much longer the route is, and the hazards still on it. Red and orange
  labels on the map mark the worst spots. When there is **no route**, it re-plans with each limit
  relaxed and says which change would open a way. **Show these layers on the map** switches on the
  data behind the reasons.
- **Temperature check:** at Gale, Curiosity's measured ground temperatures against the suit limits
  (Settings). Elsewhere it says there is no data.
- **Walk this route:** step through the Jezero panorama markers along the route (needs the server).
- Red cells on the map = steeper than the slope limit.

## Crew & EVA tab

- **Scenarios** (top of the tab): 14 one-click demos on real terrain, each checked beforehand. They set
  the stops and options, fly there, switch on the matching layers and plan (route results appear in the Path tab):
  - feasible demo EVA, and three suit faults (water leak, low oxygen, 1 h per stop);
  - detours: slopes too steep, rough terrain, and "fastest is not shortest";
  - impossible: canyon wall (Coprates), soft dust mantle (Meridiani → Arabia), heavy cargo rover at 5°;
  - too far on foot but fine for a rover; rover comparison (pressurized vs Curiosity);
  - too cold at night, and too hot for the suit (hypothetical suits).
- **EVA survival budget** for a two-person suited team on the Path route or a loaded route file:
  oxygen, cooling water and battery at return, the 20% reserve, walk-back limit, timeline, and GO or
  REFUSED with the reason. **Suit condition** switches between standard suits, a water leak, low O₂ and long sampling.
- **Data verified:** the signed data files are checked on load (BLAKE3 + Ed25519). **Tamper test**
  flips one bit to show that the demo route is refused.
- **Demo excursion** (first entry in Scenarios): loads the signed 2.3 km boxwork EVA and adds **Crew A and
  Crew B** as real crew members, with the selected suit condition. **Open / Save route.json**, **VR replay** (WebXR).
- **Crew & rovers:** **＋ Add** an astronaut, pressurized rover, Perseverance or Curiosity. Each member has:
  - an ETA at every stop (with sampling time), a max safe stay, the point of no return and what's left at the end;
  - live O₂, water and battery bars, line of sight to base, and alerts (low reserve, turn back, comms lost);
  - **🧭 Walk from here:** click any point on the map. You get how long they can last there, or
    (for rovers that never run out) just whether the way is feasible, and why not if it isn't;
  - **Start EVA** with simulated time, **Return now**, **Follow** with the camera, editable speeds and tank sizes.
- Astronauts use exactly the same model as the survival budget (speeds, metabolic rates, suit capacities), so their numbers match it.

## Settings tab

- **View & terrain:** top-down or tilted, tilt angle, 3D relief and exaggeration.
- **Lighting:** shading mode, strength, real Mars time or a fixed time of day, atmosphere glow.
- **Map spots:** pin range, and how pins behind the planet are shown.
- **Crew & EVA:** return reserve, radio range, base antenna height, simulation speed.
- **Route hazards:** every hazard threshold (roughness, soft dust, dust cover, suit temperature
  limits), each with its source in the tooltip. **Defaults** restores them.
- **Performance and cache:** quality and resolution, and the browser and server tile caches.

## Honesty rules (what is real, what is modelled)

- **Measured:** MOLA elevation, TES thermal inertia and dust maps, REMS weather, Trek imagery, mission spots.
- **Modelled:** walking speed, consumable use, rover behaviour, and every threshold. Each is in
  `assumptions.md` as CITED, DERIVED or ASSUMED.
- **Coarse:** routes use ~2.6 km cells (MOLA), and the dust maps are ~21 km/px. The UI says
  "coarse data, not walk-scale".
- **Hypothetical:** suit faults and the hot or cold suit showcases are labelled as such.
