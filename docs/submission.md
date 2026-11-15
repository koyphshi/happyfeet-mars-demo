# Submission kit — NASA Space Apps 2026, "Interplanetary Survival Guide: Martian Map"

A human pastes the block below into the Space Apps project page, uploads the team's deck, fills the
Members tab and presses **Save**. **Only the last saved submission is judged.**

Judges' 5-minute path through the live app: [`docs/judges-walkthrough.md`](judges-walkthrough.md). Every feature, tab by tab: [`docs/features.md`](features.md).

## Checklist (re-verified 15 Nov 2026, 13:45 CET, against `main @ 94cce61`, fresh logged-out headless Chrome)

- [x] **https://happyfeet-mars.onrender.com** loads cold: globe, welcome tutorial, "✓ Data verified 9/9", no page errors. `/healthz` answers in ~0.3 s; a keep-alive pings it every 10 min.
- [x] Backup **https://koyphshi.github.io/happyfeet-mars-demo/** loads cold with the same checks (no live route planning there, by design).
- [x] Crew & EVA → Scenarios → *✓ Feasible: short science EVA* → ▶ Run → **GO, Crew B oxygen 69 %**; Suit condition *Crew B oxygen at 30 %* → **REFUSED, runs out of oxygen 2.05 km out**.
- [x] Layers tab shows four data kinds with provenance: optical, topographic, thermal, atmospheric.
- [x] Repository is public: https://github.com/Noxx67/happyfeet-mars-trip
- [ ] Team deck uploaded (≤ 7 slides) — humans
- [ ] Paste the block below (description, links, references, AI disclosure) — humans
- [ ] Members tab complete — humans
- [ ] All required checkboxes ticked, then **Save** — humans

## Paste-ready text for the Space Apps project page

```text
PROJECT: HappyFeet Mars — a safety-first map for one Marswalk

DEMO (live, full app): https://happyfeet-mars.onrender.com
  (free host: if it is slow the first time, wait about a minute)
BACKUP (static, no live route planning): https://koyphshi.github.io/happyfeet-mars-demo/
REPOSITORY: https://github.com/Noxx67/happyfeet-mars-trip
5-MINUTE WALKTHROUGH: https://github.com/Noxx67/happyfeet-mars-trip/blob/main/docs/judges-walkthrough.md

DESCRIPTION
The first people on Mars will not need another global map: they will need to know whether one
specific walk gets them home. HappyFeet Mars is a layered, interactive map for a single excursion,
built for the boxwork formations on Mount Sharp in Gale crater, where Curiosity worked in 2025.
Science goal: are the boxwork ridges and hollows mineralogically different, recording how
groundwater moved? The demo excursion visits a ridge crest, a hollow floor and a layer contact
from a safe haven.

It layers NASA data from several missions (optical: Viking, HiRISE; topographic: MOLA, MOLA+HRSC;
thermal: THEMIS day IR, TES thermal inertia; dust: TES dust cover index; atmospheric: Curiosity
REMS weather; Curiosity's traverse and panoramas; 2,100+ IAU-named features), each with its source,
mission, resolution and date on screen.

Safety comes first. A terrain route planner (any-angle A*) respects the suit's slope limit and
avoids rough ground and soft dust, and a "Why this route" panel explains every detour or refusal.
A survival model then prices the walk for a crew of two: oxygen, cooling water and battery per
person (suit capacities from the Apollo 15-17 backpack), a 20% reserve at return, the walk-back
limit, comms blackout from line of sight, and REMS ground temperature against suit limits. If any
crew member would come back below the reserve, the plan is REFUSED with the reason: who runs out of
what, and where. Rovers can be compared on the same route. A guided tutorial, 14 one-click
scenarios on real terrain, a 360-degree panorama walk at Jezero and a WebXR route replay complete
the tool.

Trust: every data file is cryptographically signed (BLAKE3 + Ed25519) and verified in the browser;
every coefficient is cited or labelled ASSUMED; limitations are shown, not hidden (terrain is
~200 m to ~2.6 km per pixel, so routes are indicative, not walk-scale).

USE OF AI
We used AI coding assistants (Anthropic Claude Code and others) for research, code and
documentation. Team members directed the work, reviewed and merged every change; every data claim
is checked against the cited sources and every model coefficient is labelled CITED, DERIVED or
ASSUMED in docs/assumptions.md. No AI-generated imagery is presented as NASA data.
```

## References (paste as-is)

Data
- NASA Solar System Treks — Mars Trek WMTS tiles: Viking MDIM 2.1 colour mosaic (`Mars_Viking_MDIM21_ClrMosaic_global_232m`); MOLA colour shaded relief (`Mars_MGS_MOLA_ClrShade_merge_global_463m`); MOLA + HRSC blended colour relief (`Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw`); Gale HiRISE mosaic (`curiosity_hirise_mosaic`); THEMIS day IR controlled mosaic v2 (`THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018`). https://trek.nasa.gov/mars/
- MGS MOLA Mission Experiment Gridded Data Records (MEGDR), NASA PDS Geosciences Node: https://pds-geosciences.wustl.edu/missions/mgs/megdr.html
- HRSC and MOLA blended DEM global 200 m v2, USGS Astrogeology / DLR / FU Berlin (served by our terrain service for fine levels).
- TES thermal inertia (Putzig et al. 2005, Icarus 173, 325–341) and TES dust cover index (Ruff & Christensen 2002, JGR 107(E12) 5127), via NASA Trek.
- FU Berlin Mars virtual tour (Jezero panoramas), https://maps.planet.fu-berlin.de/vtour/
- MSL PLACES localizations (Curiosity traverse, sites/drives), NASA PDS: https://planetarydata.jpl.nasa.gov/img/data/msl/msl_places/
- REMS weather (Curiosity), NASA/JPL-Caltech/Centro de Astrobiología: https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json
- USGS Gazetteer of Planetary Nomenclature (IAU named features): https://planetarynames.wr.usgs.gov/
- NASA Photojournal — Curiosity's first 360° view of boxwork patterns: https://science.nasa.gov/photojournal/curiositys-first-360-degree-view-of-boxwork-patterns/
- NASA Photojournal — Curiosity studies nodules on boxwork formations: https://science.nasa.gov/photojournal/curiosity-studies-nodules-on-boxwork-formations/
- Mastcam-Z 360° panorama collection (ASU): https://mastcamz.asu.edu/mastcam-zs-360-panorama-collection/
- Mission/landing-site pages used for spot cards: NASA NSSDC (Viking, Mars Pathfinder), NASA Science (InSight, Phoenix, Mars 2020), ESA (Schiaparelli), HiRISE (Beagle 2, Zhurong), JPL (Mars 3), MER Analyst's Notebook.
- NASA Mars Fact Sheet (gravity): https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html

Methods
- Tobler, W. (1993). Three presentations on geographical analysis and modeling (hiking function).
- Weir, J. B. de V. (1949). New methods for calculating metabolic rate with special reference to protein metabolism. *J. Physiol.* 109:1–9 (energy equivalent of O₂).
- Waligora, J. M. & Horrigan, D. J. (1975). Metabolism and heat dissipation during Apollo EVA periods. In *Biomedical Results of Apollo*, NASA SP-368 (order of magnitude of EVA metabolic rate).
- Nash, A. et al. (2007). Theta*: Any-angle path planning on grids. AAAI.
- Apollo 15–17 PLSS consumables (cooling water 11.5 lb, battery 390 Wh) and Apollo EVA metabolic rates: NASA TN D-7883; NTRS 19910001262.

Software
- CesiumJS 1.147 (Apache-2.0): https://cesium.com/platform/cesiumjs/
- Node.js 22 (server), no runtime npm deps besides Cesium. Three.js r170 (MIT) for WebXR; @noble/hashes 1.8.0 (MIT) for BLAKE3.
- Python forecast pipeline (`forecast/`, not wired into the demo): numpy, scipy, pandas, xarray, netCDF4, rasterio, scikit-learn, LightGBM, requests, matplotlib.

AI assistance
- Claude Code (Anthropic) and other AI assistants were used for research, code and documents; every
  data claim is checked against the sources above and every coefficient is labelled in
  `docs/assumptions.md`.
