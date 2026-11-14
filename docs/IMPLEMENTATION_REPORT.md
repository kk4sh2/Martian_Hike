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

- **MEDA weather (Jezero).**
  - The PDS Atmospheres node failed TLS from the build environment, and bypassing certificate checks was not attempted.
  - The weather card therefore says MEDA is not packaged and shows no values.
  - Acceptance test 3 (distance from the pin to a dated MEDA observation, with gaps shown explicitly) is **BLOCKED**.
  - `meda.py` (CSV and PDS4 label parsing, gap listing, station placement) is written but has not run on real data. To unblock: put a MEDA CSV and its `.xml` label in `data/raw/meda/`, then run `python3 -m marsdelta_pipeline meda && cd ../web && npm run build`.
- **Nili bypass.** There is no terrain model for the Nili crop, so no bypass is computed. The UI explains why instead of drawing an unchecked path.
- **Ripple displacement.** It is unresolved because of ripple-wavelength aliasing and weak correlation peaks. This is a limit of the method, not a missing feature. No value is shown.
- **Pull requests.** No GitHub repository was attached, so the work is a local git repository and has not been delivered as PRs.
