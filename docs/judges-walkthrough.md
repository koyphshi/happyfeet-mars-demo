# Judges' walkthrough (5 minutes)

**Open:** https://happyfeet-mars.onrender.com. It runs on a free server: if the first load takes ~1 minute,
it was asleep, so give it a moment. Backup without route planning: https://koyphshi.github.io/happyfeet-mars-demo/

Everything below was checked on the live site with a fresh browser on 15 Nov 2026.
A tab-by-tab description of every feature will be in `docs/features.md` (arriving with agent:ahmed's next PR).

## 1. The place and the data (Layers tab, ~1 min)
- The globe opens on Mars. Fly to **Gale crater**: the boxwork terrain Curiosity is crossing now.
- **Layers** shows four kinds of NASA data, each with a provenance line (dataset · mission · resolution ·
  date · credit): **optical** (Viking, HiRISE of Gale), **topographic** (MOLA, MOLA + HRSC), **thermal**
  (THEMIS day IR) and **atmospheric** (*Atmosphere · Gale*: Curiosity REMS, latest sol; measured, not a forecast).
- *Pathfinding view* shows what the route planner sees: slope, roughness, soft dust, dust cover.

## 2. Does the crew get home? (Crew & EVA tab, ~2 min)
1. Check that the chip reads **✓ Data verified 9/9**: the data files match an offline-signed manifest (BLAKE3 + Ed25519).
2. Press **▶ Demo excursion (boxwork)**: haven → ridge crest → hollow floor → layer contact → haven,
   2.25 km, ~2 h 04 min with 20 min of sampling per stop.
   The survival card says **GO — lowest reserve at return: Crew B oxygen 69 % (min 20 %)**: oxygen, cooling water
   and battery per crew member, the walk-back limit, and a comms blackout from line of sight.
3. Switch **Scenario** to *Crew B oxygen at 30 %*. The same route is now **REFUSED — Crew B runs out of oxygen
   2.05 km out, between Layer contact and Haven**. The refusal names the crew member, the consumable and the place.
4. Press **Tamper test**: one bit of `route.json` is flipped in memory, the chip turns red, and the route is
   **refused** with the file named. **Reset** restores it.

## 3. Why this route? (Path tab → Showcase scenarios, ~2 min)
Pick a scenario and press **▶ Run**. Each one runs the real planner on MOLA terrain:
- **Detour: slopes too steep** (Gale → Mount Sharp at 10°): the route is ~181 % longer than the straight 40.9 km, worst slope 19.5°.
- **Detour: rough terrain**: ~13 % longer to stay off bumpy ground.
- **Impossible: canyon wall** (Coprates Chasma, 15°): no route, and the panel says that raising the limit to 25° would open a ramp.
- **Too far on foot, fine for a rover** (Gale, 15 km): the astronaut is refused; a Perseverance-class rover makes it, in sols.
- **Too hot for the suit**: the temperature check (REMS ground temperature vs suit limit) refuses the EVA.
The **"Why this route"** panel names every reason, and **Show these layers on the map** switches on the data behind it.

## 4. Optional
- **🥽 VR replay** (`/vr.html`): the same signed route on a terrain patch, with the survival HUD. Desktop: drag to look, keys 0–4.
  Headset: *Enter VR* in the Meta Quest browser.
- **Crew & EVA → ＋ Add → 🧭 Walk from here**: click any point; an astronaut gets how long they can stay, a rover feasible / not feasible.

## What is real and what is modelled
- **Real data:** NASA Trek imagery, MOLA / HRSC elevation, Curiosity's traverse and panoramas, REMS weather, IAU names.
- **Modelled:** walking speed (Tobler), oxygen and cooling water from metabolic power, suit capacities from the Apollo 15–17
  backpack (some values ASSUMED). Every number is listed with its source in `docs/assumptions.md`.
- **Scale:** the terrain is ~200 m to ~2.6 km per pixel, so routes are indicative, not walk-scale. The app labels this
  wherever it matters. Thermal-inertia and dust hazards are qualitative (decoded from map colours).
- **Integrity:** detects changed or corrupted data files. It does not protect against a compromised server and does not
  verify NASA's live tiles.
