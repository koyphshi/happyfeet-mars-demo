# Assumptions and coefficients

Every number the app uses to make a decision goes in this file, with a source URL or an
explicit `ASSUMED` label. Anything shown in the UI as fact must be sourced here.

Rules:

1. No coefficient without a row in this table.
2. `ASSUMED` values are allowed — but they must say `ASSUMED` in the table **and** in the UI tooltip.
3. Prefer a range and a midpoint over a single confident digit.
4. If a source can't be found in 15 minutes, mark it `ASSUMED` and move on. Honesty beats precision.

---

## Mobility

| Symbol | Meaning | Value | Unit | Source | Status |
|---|---|---|---|---|---|
| `v0` | walking speed, flat, suited | | km/h | | |
| `slope_penalty` | speed multiplier vs slope | | – | | |
| `roughness_penalty` | speed multiplier vs terrain roughness | | – | | |
| `max_slope` | suit mobility limit (hard mask) | | ° | | |
| `suit_mass` | suit + PLSS mass | | kg | | |
| `g_mars` | Martian surface gravity | 3.71 | m/s² | | |
| `load_penalty` | speed multiplier vs carried equipment | | – | | |

## Metabolism and consumables

| Symbol | Meaning | Value | Unit | Source | Status |
|---|---|---|---|---|---|
| `metabolic_flat` | metabolic rate, flat traverse | | W | | |
| `metabolic_slope` | additional rate per degree of slope | | W/° | | |
| `o2_per_joule` | O₂ mass consumed per joule | | kg/J | | |
| `plss_o2` | usable O₂ capacity | | kg | | |
| `suit_power` | suit power draw (fans, pumps, heaters, comms) | | W | | |
| `battery_capacity` | usable battery energy | | Wh | | |
| `eva_max` | max EVA duration | | h | | |
| `reserve` | required reserve at return | 20 | % | design decision | FIXED |

## Comms

| Symbol | Meaning | Value | Unit | Source | Status |
|---|---|---|---|---|---|
| `blackout_grace` | blackout length treated as recoverable | 60 | s | design decision | FIXED |
| `blackout_k` | cost per second of blackout beyond grace | | s/s | | |
| `relay_position` | fixed relay (lander) lat/lon | | ° | | |

## Environment

| Symbol | Meaning | Value | Unit | Source | Status |
|---|---|---|---|---|---|
| `dose_rate` | surface dose equivalent | 0.21 | mGy/day | Hassler et al. 2014 | CITED |
| `dose_budget` | mission dose budget | | mGy | | |
| `temp_range` | surface temperature range | | °C | MSL/REMS JSON | LIVE |

---

## Honesty constraints (UI copy)

- **No dust optical depth.** `atmo_opacity` is qualitative ("Sunny"/"Cloudy"). There is no public τ
  feed. Never display a τ number.
- **No "forecast".** We show measured atmosphere from past sols. Weather on Mars has no operational
  forecast service. Say "latest sol" and "climatology", never "forecast".
- **Radiation is modelled**, not measured — label it in the UI.
- **Resolution tiers are visible.** Any site outside Gale/Jezero shows "coarse data — not walk-scale".
- **No "anywhere on Mars" claim.** Say: "generates a mission view for any site, demonstrated at Gale."

---

## Survival model as implemented (`web/survival.js`, mirrored in `route.json → params`)

Added Sun 15 Nov 2026 by agent:yasser. These are the numbers the survival card uses. Most are
**ASSUMED**. Since 08:30 the suit capacities follow a real reference design, the **Apollo 15–17 PLSS**
(8-hour EVA), and the metabolic rate is the measured Apollo lunar-EVA average; the rest are still
ASSUMED and labelled so. Change them in
`SURVIVAL_PARAMS` / `DEFAULT_CREW` and here together.

| Symbol (code) | Meaning | Value | Unit | Source | Status |
|---|---|---|---|---|---|
| `g_mars` | surface gravity | 3.71 | m/s² | NASA NSSDC Mars fact sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html | CITED |
| `MARS_RADIUS_M` | radius for distances | 3 396 190 | m | IAU 2000 Mars equatorial radius (same as `pathfinding.js`, `Cesium.Ellipsoid.MARS`) | CITED |
| `v0_kmh` | suited walking speed, flat | 2.5 | km/h | — | ASSUMED |
| `tobler_a`, `tobler_b` | speed vs grade: v = v0·e^(−a·|g+b|)/e^(−a·b) | 3.5, 0.05 | – | Tobler (1993) hiking function, normalised so v(0)=v0 | CITED form, ASSUMED for suits on Mars |
| `max_slope_deg` | hard slope mask | 25 (UI slider) | ° | — | ASSUMED |
| `metabolic_flat_w` | metabolic rate walking on the flat | 272 | W | Apollo lunar EVA overall average 234 kcal/h (NASA NTRS 19910001262, citing Waligora & Horrigan); Apollo lunar EVA range 822–1267 kJ/h = 228–352 W (NASA TN D-7883, https://www.nasa.gov/wp-content/uploads/static/history/alsj/tnD7883Metabolic.pdf) | CITED |
| `metabolic_stop_w` | metabolic rate while sampling | 230 | W | — | ASSUMED |
| uphill term | extra power = m·g·v_up / η | – | W | mechanical work of lifting body + suit | physics |
| `eta_muscle` | muscular efficiency, climbing | 0.25 | – | textbook range ~0.2–0.25 | ASSUMED |
| `suit_mass_kg` | suit + life support carried | 60 | kg | — | ASSUMED |
| `body_mass_kg` | crew A / B | 72 / 88 | kg | — | ASSUMED |
| `metabolic_scale` | crew A / B multiplier | 1.0 / 1.15 | – | — | ASSUMED |
| `e_o2_j_per_kg` | energy per kg O₂ consumed | 14.07 × 10⁶ | J/kg | ~20.1 kJ per litre O₂ (indirect calorimetry, Weir 1949) at 1.429 g/L | CITED |
| `l_sub_j_per_kg` | latent heat of sublimation of ice | 2.83 × 10⁶ | J/kg | physical constant | CITED |
| `f_cool` | share of metabolic heat rejected by the sublimator | 0.8 | – | — | ASSUMED |
| `suit_power_w` | average electrical draw (fans, pump, radio, heaters) | 49 | W | 390 Wh battery ÷ 8 h Apollo 15–17 design EVA | DERIVED |
| `o2_kg` | usable O₂ per suit | 0.54 | kg | not found in a source we could check (Apollo PLSS gives tank pressure, 1430 psi, not mass); sized so O₂ lasts ~8 h at 272 W | ASSUMED |
| `water_kg` | usable cooling water per suit | 5.2 | kg | Apollo 15–17 PLSS cooling water 11.5 lb (extended configuration; Apollo 11–14: 8.5 lb). https://en.wikipedia.org/wiki/Primary_life_support_system (secondary; primary: ALSJ PLSS history, https://history.nasa.gov/alsj/ALSJ-FlightPLSS.pdf) | CITED (secondary) |
| `battery_wh` | battery per suit | 390 | Wh | Apollo 15–17 PLSS battery 390 Wh (Apollo 11–14: 279 Wh), same sources as `water_kg`. Treated as fully usable | CITED (secondary) |
| `stop_dwell_s` | sampling time per science stop | 1200 | s | — | ASSUMED |
| `reserve_frac` | reserve required at return | 0.20 | – | design decision | FIXED |
| `blackout_grace_s` | blackout treated as recoverable | 60 | s | design decision | FIXED |
| `blackout_k` | risk cost per blackout second beyond grace | 1 | s/s | — | ASSUMED |
| `haven_antenna_m`, `suit_antenna_m` | antenna heights for line of sight | 3, 2 | m | — | ASSUMED |

Model limits (shown in the UI): the return leg is the outbound path walked backwards (an upper
bound — a shortest-path return could be shorter); line of sight is computed on the planner's
km-scale grid; no thermal environment, dust, or fatigue term; hypothetical failure scenarios
(`SCENARIOS`) are demo stimuli, not failure statistics.

## Rovers (crew.js)

The crew panel (`web/crew.js`) takes the suited astronaut entirely from `survival.js` (speed,
slope limit, metabolic O₂ curve, `DEFAULT_CREW[0]` capacities); the rows below are only the
rover presets and the panel's own shaping terms. Every value can be edited per member in the UI.
Speeds are averages including hazard stops, not top speeds.

| Symbol | Meaning | Value | Unit | Source | Status |
|---|---|---|---|---|---|
| `o2Hours` (astronaut) | flat-walking O₂ endurance | 7.8 | h | `o2_kg × e_o2_j_per_kg ÷ metabolic_flat_w` (crew A) | DERIVED |
| `batteryHours` (astronaut) | suit battery endurance | 8.0 | h | `battery_wh ÷ suit_power_w` (crew A) | DERIVED |
| `speedKmh` (Curiosity) | average drive speed | 0.03 | km/h | NASA/JPL quote ~0.14 km/h top speed; average with hazard-avoidance stops is a few tens of m/h (not yet linked) | ASSUMED |
| `speedKmh` (Perseverance) | average drive speed | 0.12 | km/h | NASA/JPL quote ~0.15 km/h top speed and ~120 m/h with AutoNav (not yet linked) | ASSUMED |
| `maxSlope` (Curiosity, Perseverance) | drivable slope | 30 | ° | rover design limit, commonly quoted as 30° (not yet linked) | ASSUMED |
| `dutyHours` (Curiosity / Perseverance) | driving hours per sol | 4 / 5 | h | — | ASSUMED |
| `batteryHours` (Curiosity / Perseverance) | battery endurance (RTG-charged, so not limiting) | 6 | h | MMRTG keeps batteries charged; shown as "RTG · not limiting" | ASSUMED |
| `speedKmh` (pressurized rover) | average drive speed | 10 | km/h | NASA Space Exploration Vehicle concept (not yet linked) | ASSUMED |
| `maxSlope` (pressurized rover) | drivable slope | 20 | ° | — | ASSUMED |
| `o2Hours` / `batteryHours` (pressurized rover) | cabin life support / battery | 72 / 12 | h | — | ASSUMED |
| rover slope slowdown | speed × max(0.25, 1 − 0.6 · slope ÷ maxSlope) | 0.6, 0.25 | – | — | ASSUMED |
| rover battery uphill / idle factor | draw × (1 + 2 · grade) moving, × 0.15 parked | 2, 0.15 | – | — | ASSUMED |
| `commsKm` | radio range to base for line of sight | 10 | km | — | ASSUMED |

## Route hazards (pathfinding.js, hazards.js)

Optional planner constraints, off by default. A blocked cell is never entered. A slowed cell
multiplies the cost of entering it. The "Why this route" panel names every constraint that
pushed the route off the direct line. **Every threshold below can be changed in Settings >
Route hazards.** The values here are the defaults; "Defaults" in Settings restores them.

| Symbol | Meaning | Default | Unit | Source | Status |
|---|---|---|---|---|---|
| roughness | RMS of a cell's 8 neighbours about the local slope plane, MOLA z6 (~2.6 km cells) | — | m | computed from the planner's DEM; same idea as km-scale MOLA roughness (Kreslavsky & Head 2000, JGR, "Kilometer-scale roughness of Mars: results from MOLA data analysis"), not the same metric | DERIVED |
| `roughBlockM` | roughness that blocks a cell | 400 | m | no published threshold for this metric; measured 2026-11-15: Gale p50 70 m, p90 197 m, p99 356 m, so under 1 % of Gale is blocked | ASSUMED (calibrated, editable) |
| `roughFreeM`, `roughDoubleM` | no cost up to 40 m; cost × 2 at 200 m (linear) | 40, 200 | m | Gale floor along the demo excursion = 41 m; InSight plains p50 4 m, p90 14 m | ASSUMED (calibrated, editable) |
| thermal inertia index | position (0–1) on the colour ramp of Trek `TES_Thermal_Inertia`, level 1 (~21 km/px). Trek's catalog gives the source as Putzig et al. 2005, Icarus 173, 325–341 (20 ppd, ~3 km) | — | – | ramp decoded by hue; Trek publishes no legend or min/max, so linear vs log is unknown (checked by agent:yasser, 2026-11-15); direction checked 2026-11-15: Tharsis, Amazonis, Arabia, Olympus Mons = 0; Gale 0.67, Jezero 0.52, Gusev 0.45, Meridiani 0.36, Acidalia 0.62 | DERIVED |
| `TI_FIT` | index → thermal inertia, rough guide only: TI ≈ 121 + 327 · index | 121, 327 | TIU | 3-point fit by agent:yasser (#29, 2026-11-15): Meridiani 0.36 ↔ ~211 TIU and Gusev 0.45 ↔ ~307 TIU (Golombek et al. 2003, JGR 108(E12) 8072; Jakosky et al. 2006, JGR 111 E08008), Gale 0.67 ↔ 250–410 TIU (Fergason et al. 2012, THEMIS). rms 28 TIU; a log fit is as good; no dust-low anchor, so the ramp bottom (~120–150 TIU) is an extrapolation. Order-of-magnitude check, not a calibration | DERIVED (rough) |
| `softBlockIdx` | cells in the bottom of the thermal-inertia colour ramp are blocked (dust-dominated) | 10 | % of ramp | defined on the map index because the ramp bottom (~120–150 TIU) lies above MSL's 100 TIU dust-hazard line (MSL Engineering User Guide), so a TIU threshold cannot be applied to this map; every landed site is at 35–70 % | ASSUMED (qualitative, editable) |
| `softSlowIdx` | below this, cost rises linearly to `softSlowMax` | 25 | % of ramp | ≈ 200 TIU on the rough fit, near MER's 125–165 TIU avoid line (Golombek et al. 2003) | ASSUMED (editable) |
| `softSlowMax` | cost just above the block line | 1.6 | × | — | ASSUMED (editable) |
| dust index | position (0–1) on the colour ramp of Trek `TES_Dust`, level 1. Source: TES dust cover index, Ruff & Christensen 2002, JGR 107(E12) 5127 (16 ppd, ~3.5 km) | — | – | decoded by hue; no published colour scale; less consistent than thermal inertia (Olympus Mons reads 0); no legend or calibration found, so it never blocks a cell | DERIVED (uncalibrated) |
| `dustSlowAbove`, `dustSlowMax` | above 60 % of the scale, cost rises linearly to × 1.3 | 60, 1.3 | %, × | — | ASSUMED (editable) |
| `tempMinC`, `tempMaxC` | ground-temperature limits of the route temperature check | −129, +39 | °C | the Mars EVA design envelope, not a rating of any real suit: worst-case cold / hot surface temperatures at EVA-realistic sites (≤ 7 Torr) from the JPL Mars GCM, 144 K and 312 K (NASA, "Mars Portable Life Support System Status and Plan", ICES-2026-126, Table 3, https://ntrs.nasa.gov/api/citations/20260003024/downloads/Final_ICES2026_Mars_PLSS_Plan.pdf) | CITED (editable) |

Temperature is not a planner cost. No global surface-temperature map exists in the data the
app uses. Only Curiosity REMS at Gale measures temperature, so the check runs on whole routes
within ~90 km of Gale, and elsewhere it says "no data". With the default envelope, a refusal
means conditions beyond NASA's worst case. Tighten the limits in Settings to model a specific suit.
