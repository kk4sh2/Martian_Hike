# MarsDelta implementation report

Status as of 2026-11-14. No earlier repository or Jezero Traverse simulator existed, so MarsDelta was built from scratch. It is one site with a planner view and a tablet view, a Python pipeline and an offline demo pack. A feature is marked as run only when an automated test or a validation check exercised it. See [TEST_RESULTS.md](TEST_RESULTS.md).

## 1. What ran successfully

- **The pipeline ran end to end against the live public archives:** download, then processing, validation and packing. Validation passes 156 of 156 checks.
- **Nili Patera change detection ran on the two real HiRISE RED products.**
  - Bedrock registration has a 0.086 m held-out RMS over 91 held-out controls.
  - 17 candidate regions: 2 Verified, 7 Requires Review, 8 Uncertain.
  - False-positive rate on bedrock is 1.08%.
  - Displacement was attempted and all 17 regions are honestly reported as unresolved.
- **Jezero:**
  - DTM-based A* routing with two profiles (Direct and Gentle), both with return legs. Direct is 1557 m with 37 m of climb; Gentle is 1617 m. The planner names the leg that explains the difference.
  - Metabolic, oxygen and battery model.
  - Seeded Monte Carlo (500 trials), reproducible and responsive to inputs.
  - Landing pin with briefing.
  - Five Mastcam-Z frames traced to their RMC mission records.
- **Route impact:**
  - Exact polyline/polygon intersection gives the crossing subsegments.
  - Five states: intersects / clear / partial coverage / outside coverage / no analysis.
  - Banner, evidence viewer (blink, swipe, side by side, texture difference), and Acknowledge / Manual review / Bypass actions, all written to the mission log.
  - The success probability is never changed by an intersection.
- **Crew tracking and the tablet.** Simulated trilateration, a separate tablet state, and all three demonstration cases. Heading-up landscape tablet with start, pause, resume and reset. Guided demos for both areas.
- **3D Mars globe.** Viking MDIM 2.1 colour mosaic (NASA Mars Trek tiles, stitched at 4096×2048). Two tapped points give the great-circle distance on a 3,389.5 km sphere; the acceptance test checks it against an independent haversine computation. Jezero and Nili markers open those sites in the planner.
- **Survival tools.** Reserve margin, turn-back point (at a configurable worst-case use factor), nearest shelter, daylight margin against MEDA sunset, and a regional dust advisory from the LMD climatology, which is relative to its own record and not a forecast. On the tablet: countdowns to the oxygen and battery reserve, distance to the turn-back point and shelter, and an emergency return. In Jezero the emergency route is terrain-checked; in Nili it is a straight line. All are estimates from the simulated suit model.
- **Offline.** The service worker precaches the whole site and its data (11.5 MB). The offline reload passed in Playwright.
- **Acceptance tests.** 18 of 19 pass and 1 is blocked (MEDA).

## 2. What uses genuine measurements or records

- **HiRISE PSP_004339_1890 and PSP_005684_1890.** The RED JP2 images and labels, from the University of Arizona PDS node.
- **NASA PIA15680, PIA12857 and PIA12860.** Their published statements are shown separately from MarsDelta's own analysis.
- **USGS Mars 2020 HiRISE DTM (1 m) and orthomosaic (25 cm) for Jezero**, plus USGS SIM 3464 geology.
- **Perseverance traverse and localized waypoints (NASA MMGIS).** The two science stops are real rover localizations.
- **Mastcam-Z browse images and their raw-image API records.** These include camera position, attitude, CAHV model and RMC. The viewing direction is derived from them, and the target ground point is not estimated.
- **LMD gridded column dust optical depth (MY28 for Nili, MY36 for Jezero).** Shown as regional context only.

Every file has its URL and SHA-256 hash recorded in `data/source_manifest.json`. No Chinese-operated sources are used.

## 3. What is simulated or assumed

- **Habitat placement and the Nili walk endpoints.** These are authored positions, labelled simulated.
- **Mission timeline.** The 2007 observation is received as a simulated mission event.
- **All crew positions, suit beacons, the radio network, tablets and link events.**
- **Physiological and suit assumptions**, shown with their provenance in the inputs panel:
  - walking speed 2 km/h on flat ground (Tobler slope adjustment);
  - masses;
  - metabolic rates;
  - oxygen 1.2 kg;
  - battery 1100 Wh;
  - 10% reserve.
- **Environment scenarios and obstacle density** are Monte Carlo parameters, not measurements.
- **Verified class.** It means the region falls inside NASA's PIA15680 frame, where NASA published ripple motion. It is not an independent ground validation.

## 4. What is blocked

- **Full-resolution MEDA weather (Jezero).** The PDS Atmospheres archive still fails TLS from the build environment, and certificate checks were not bypassed. As a partial unblock, the pipeline now captures NASA's published MEDA daily summaries: low and high temperature, pressure, sunrise and sunset for the latest 7 sols NASA publishes (sols 1127–1133, 2024). Gaps stay gaps. The station is placed at the rover's localization for each sol, and the weather card shows its distance from the landing pin. These are not the sols of the planned walk, and the card says so. `meda.py` still ingests full-resolution CSVs if they are placed in `data/raw/meda/`.
- **Nili bypass.** There is no terrain model for the Nili crop, so no bypass is computed. The UI explains why instead of drawing an unchecked path.
- **Ripple displacement.** It is unresolved because of ripple-wavelength aliasing and weak correlation peaks. This is a limit of the method, not a missing feature. No value is shown.
- **Pull requests.** No GitHub repository was attached, so the work is a local git repository and has not been delivered as PRs.
