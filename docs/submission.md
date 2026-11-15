# Submission kit — NASA Space Apps 2026, "Martian Map"

Drafted Sun 15 Nov 2026 by agent:yasser from what the app actually does on branch
`agent/yasser-p0`. A human must paste this into the Space Apps project page, upload the deck, tick
the boxes and fill the Members tab. **Only the last saved submission is judged.**

Judges' 5-minute path through the live app: [`docs/judges-walkthrough.md`](judges-walkthrough.md). Every feature, tab by tab: [`docs/features.md`](features.md).

## Submission checklist (human)

- [ ] Public demo link loads in a private window, logged out: **https://happyfeet-mars.onrender.com** (full app; backup without the route planner: https://koyphshi.github.io/happyfeet-mars-demo/). See `docs/deploy.md`.
- [ ] Judges' 5-minute path through the app: [`docs/judges-walkthrough.md`](judges-walkthrough.md)
- [ ] Path tab → *Load demo excursion* → survival card shows **GO**; scenario *Crew B oxygen at 30 %* → **REFUSED** with the reason
- [ ] Layers tab shows ≥ 3 data kinds with provenance (optical, topographic, thermal, atmospheric)
- [ ] 7-slide deck uploaded (over 7 slides is not evaluated)
- [ ] References section pasted (below)
- [ ] Repository link: https://github.com/Noxx67/happyfeet-mars-trip
- [ ] Use-of-AI disclosure filled in (Claude Code and other assistants were used; see git history)
- [ ] Members tab complete
- [ ] All required checkboxes ticked; **Save**

## 7-slide outline (≤ 7)

1. **Title + one-liner.** "A safety-first walking map for one place on Mars: the boxwork of Gale
   crater." Team name, challenge name. Screenshot: globe zoomed on the boxwork with the route.
2. **Problem.** A crew on foot on Mars can die of a budget error, not a wrong turn: oxygen, cooling
   water and battery all run on time, and time depends on slope and distance. Maps show terrain; none
   tell the crew whether they get home with a reserve.
3. **Science question (matches PLAN.md §1).** Are the boxwork ridges and hollows mineralogically
   different, and does that record groundwater flow? Three targets: ridge crest, hollow floor, layer
   contact. Orbital data is too coarse to tell a ridge from its hollow → samples on foot.
4. **What we built (live demo).** Cesium Mars globe with NASA data layers (Viking, HiRISE, MOLA,
   MOLA+HRSC, THEMIS day IR) + REMS weather; 2,000+ named features, Curiosity traverse and
   panoramas; terrain router with a slope hard mask; provenance on every layer.
5. **The survival card (differentiator).** Per crew member: O₂ / cooling water / battery at return,
   20 % reserve, walk-back limit, comms blackout from line of sight, timeline. Same route with a
   degraded suit → **REFUSED: "Crew B runs out of oxygen 2.05 km out, between Layer contact and
   Haven."** `route.json` carries the whole decision for VR and integrity checks.
6. **Honesty + how it works.** Data provenance; coefficients sourced or labelled ASSUMED
   (`docs/assumptions.md`); terrain is ~200 m–km scale, so geometry is indicative, not walk-scale; the
   router minimises distance with a slope mask, the survival model prices the result in time.
7. **Next.** Walk-scale DEM (HiRISE stereo) for the boxwork; return-leg by shortest path; route cost
   in time incl. comms; signed data manifest (integrity); Quest WebXR replay of the same route.json;
   crew field reports that re-plan.

## References (paste as-is; trim to what the final app uses)

Data
- NASA Solar System Treks — Mars Trek WMTS tiles: Viking MDIM 2.1 colour mosaic (`Mars_Viking_MDIM21_ClrMosaic_global_232m`); MOLA colour shaded relief (`Mars_MGS_MOLA_ClrShade_merge_global_463m`); MOLA + HRSC blended colour relief (`Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw`); Gale HiRISE mosaic (`curiosity_hirise_mosaic`); THEMIS day IR controlled mosaic v2 (`THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018`). https://trek.nasa.gov/mars/
- MGS MOLA Mission Experiment Gridded Data Records (MEGDR), NASA PDS Geosciences Node: https://pds-geosciences.wustl.edu/missions/mgs/megdr.html
- HRSC and MOLA blended DEM global 200 m v2, USGS Astrogeology / DLR / FU Berlin (served by our terrain service for fine levels).
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

Software
- CesiumJS 1.147 (Apache-2.0): https://cesium.com/platform/cesiumjs/
- Node.js 22 (server), no runtime npm deps besides Cesium.
- Python forecast pipeline (`forecast/`, not wired into the demo): numpy, scipy, pandas, xarray, netCDF4, rasterio, scikit-learn, LightGBM, requests, matplotlib.

AI assistance
- Claude Code (Anthropic) and other AI assistants were used for research, code and documents; every
  data claim is checked against the sources above and every coefficient is labelled in
  `docs/assumptions.md`.
