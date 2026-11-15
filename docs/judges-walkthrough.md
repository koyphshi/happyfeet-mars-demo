# Judges' walkthrough — 5 minutes

**Open:** https://happyfeet-mars.onrender.com (full app). If it is slow to answer the first time, wait ~1 min:
the free host wakes up. Backup without the route planner: https://koyphshi.github.io/happyfeet-mars-demo/

Everything below was checked in a fresh headless Chrome against `main` on 15 Nov 2026. Steps marked
**(full app)** need the Render link; everything else also works on the backup.

## 1. One place, real data (30 s)

1. **Layers** tab (left dock).
   - Four kinds of NASA data, each with a provenance line (dataset · mission · resolution · date · credit):
     optical (Viking, HiRISE of Gale), topographic (MOLA, MOLA + HRSC), thermal (THEMIS day IR),
     atmospheric ("Atmosphere · Gale": Curiosity REMS, latest sol; measured, not a forecast).
   - **Pathfinding view** chips show exactly what the route planner "sees": slope, roughness, soft dust, dust cover.

## 2. The decision: GO or REFUSED (90 s)

2. **Crew & EVA** tab.
   - The integrity chip should read **"✓ Data verified … files match the signed manifest"**.
3. Press **▶ Demo excursion (boxwork)**.
   - A 2.25 km loop from a haven to three science stops (ridge crest, hollow floor, layer contact) in the
     Gale boxwork, where Curiosity has been driving.
   - Survival card: **GO — lowest reserve at return: Crew B oxygen 69 % (min 20 %)**; per-crew O₂ / cooling
     water / battery bars, walk-back limit, a comms-blackout warning (26 min without line of sight), timeline
     (ETA 2 h 04 incl. 20 min sampling per stop).
4. Change **Scenario** to *Hypothetical: Crew B oxygen at 30 %*.
   - **REFUSED — Crew B runs out of oxygen 2.05 km out, between Layer contact and Haven (return).**
   - *Feedwater at 18 %* → *Crew B would return with 14 % cooling water (needs 20 % reserve)*.
5. **Tamper test** (on the integrity chip): one bit of `route.json` is flipped in memory → the chip names the
   file and the demo route is **REFUSED — integrity**. Press **Reset** to restore.

## 3. Real terrain, explained (90 s) — (full app)

6. **Path** tab → **Showcase scenarios** → pick one → **▶ Run**. Each runs on real MOLA terrain and the
   **"Why this route"** panel explains the result; **"Show these layers on the map"** turns on the layers behind it.
   - *↪ Detour: slopes too steep (Gale → Mount Sharp, 10°)* → route ~2.8× the straight 40.9 km; worst slope 19.5°.
   - *↪ Detour: rough terrain (… avoid rough)* → ~13 % longer to stay off rough ground.
   - *✗ Impossible: canyon wall (Coprates Chasma, 15°)* → no route; "raise the slope limit to 25°" would open one.
   - *✗ Too far on foot, ✓ fine for a rover (Gale, 15 km)* → astronauts refused, a Perseverance-class rover
     feasible in sols (compare both in **Crew & EVA**).
7. Plan your own: in **Path**, add two stops (search a spot or *Click on map*) → **Calculate route**. Optional:
   *Fastest walk*, *Avoid rough terrain*. The survival card in **Crew & EVA** prices the new route.

## 4. Crew and rovers (45 s)

8. **Crew & EVA → ＋ Add ▾** → *Astronaut* or *Perseverance*. Select it → **🧭 Walk from here…** → click the map:
   an astronaut gets how long they can stay and still return with the reserve; a rover gets *Feasible / Not
   feasible* and the time in sols.

## 5. The same route in VR (30 s)

9. **🥽 VR replay** (Crew & EVA) opens `vr.html`: terrain patch, route, stop beacons, four survival panels,
   ▶ Replay walk. On a Meta Quest browser press **Enter VR** (trigger = teleport, thumbstick = turn).
   Desktop: drag to look, keys 0–4 jump between viewpoints. *(Tested on desktop; headset testing pending.)*

## What is measured, what is modelled

- **Measured / published:** NASA Trek imagery and MOLA / HRSC elevation, Curiosity traverse and REMS weather,
  named features (USGS). Every layer shows its source.
- **Modelled:** oxygen, cooling water and battery use. Coefficients are cited where a source exists (Apollo
  lunar-EVA metabolic rate; Apollo 15–17 suit water and battery), otherwise labelled **ASSUMED** in
  `docs/assumptions.md`. Scenario failures ("oxygen at 30 %") are hypothetical demo inputs.
- **Resolution:** terrain is ~200 m to ~2.6 km per cell, so routes are indicative, not walk-scale. Soft-dust
  and dust-cover hazards come from orbital maps (~3 km/px) and are qualitative.
- **Integrity:** detects changed data files against an offline-signed manifest (BLAKE3 + Ed25519); it assumes
  the app code is trusted and does not verify NASA's live tiles.

More detail: [deploy](deploy.md) · [route.json schema](route-schema.md) · [integrity](integrity.md) ·
[assumptions](assumptions.md).
