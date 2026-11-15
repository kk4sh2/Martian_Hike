# Test results (2026-11-15)

| Suite | Result |
|---|---|
| Unit (vitest) `cd web && npm test` | 8 / 8 pass |
| Pipeline validation `python3 -m marsdelta_pipeline validate` | 177 / 177 checks pass |
| Acceptance (Playwright, built site) `node web/tests/e2e.cjs` | 27 pass, 0 fail, 0 blocked |

Raw output: [e2e_results.json](e2e_results.json).

| Test | Result | Evidence |
|---|---|---|
| Planner opens with only the Route section expanded (both areas) | PASS | Jezero open: cRoutes; Nili open: cRoutes |
| Header shows the MarsDelta logo image | PASS | logo.png loaded |
| Ground photo traces to its mission record | PASS | ZL0_0414_0703684150_456EBY_N0220788ZCAM08428_1100LMJ → RMC 22_788 (sol 413), raw-image page https://mars.nasa.gov/mars2020/multimedia/raw-images/ZL0_0414_0703684150_456EBY_N0220788ZCAM08428_1100LMJ |
| Moving the landing pin updates the briefing | PASS | pin text changed: 18.45426° N, 77.41089° E |
| Pin move changes distance to a dated MEDA observation; missing interval explicit | PASS | distance 5.5 km → 5.2 km after moving the pin; gaps shown as "not reported"/"gap"; NASA MEDA daily summary |
| Two Jezero routes to the same objective both include the return leg | PASS | 1.56 km incl. return1.62 km incl. returnWalking time1 h 55 min1 h 56 minClimb37 m35 mSteepest12° leg 311° leg 3O₂ / battery at return88% / 84%88% / 84%Changed groundno change analysis hereno change analysis hereWhy they  |
| Success estimate responds to resources and is reproducible | PASS | default 100.0% of 500 simulated / 100.0% of 500 simulated; O2 0.16 kg 34.2% of 500 simulated / 33.8% of 500 simulated (main failure oxygen); restored 100.0% of 500 simulated / 100.0% of 500 simulated |
| Environment and obstacle density change the estimate and name the limiting factor | PASS | cold+290 Wh: 4.0% of 500 simulated / 5.0% of 500 simulated (battery); 40 obstacles/km + 2 h: 0.0% of 500 simulated / 0.0% of 500 simulated (time) |
| Intersecting / non-intersecting / out-of-coverage routes give different, correct results | PASS | {"crossing":"Route impact · Direct to north contactInspect the highlighted crossings. Repeat orbital imagery shows a candidate surface difference here. Inspect crossing at 194-231 mInspect crossing at 531-568 m Covered b |
| Nili Patera evidence never appears in Jezero | PASS | Jezero panel/legend free of Nili IDs; Jezero routes report "no change analysis here"; no alert banner |
| Jezero surface weather never appears in Nili | PASS | Nili card states no surface weather |
| Side panel can be hidden and shown; header has no prototype label | PASS | hidden: map full width true; shown again true; header "Δ MarsDelta Jezero Crater Nili Patera Planner Tablet Globe ✓ Works offline ▶ Demo Sources Hide panel" |
| Sources tab is organised into sections with the moved details | PASS | tabs: Overview, Datasets, Change analysis, Planning model, Weather & dust, Terrain, Crew tracking |
| 3D globe: two picked points give the great-circle distance on Mars | PASS | A 19.86,62.69 B 4.63,80.83: shown 1379 km, independent check 1379.8 km |
| Survival check shows reserve margin, turn-back point, shelter, daylight and dust | PASS | Survival checkmodel🫁81% spare above the reserveBack with O₂ 93% and battery 91% (keep 10%)↩No turn-back point on this routeEven at 1.5× the planned battery use you could retrace the whole outbound walk.🏠381 m to shelte |
| Tablet left behind vs suit fix | PASS | TAB-1 is not with its wearer. It was left behind (purple box). The arrow shows SUIT-A1's suit beacon, 39 m away. |
| Suit link loss freezes last fix and shows age; restore resumes live | PASS | SUIT-B2 ○ LAST KNOWN · Astronaut B57 m behind you · last contact 1:33 ago ·  → SUIT-B2 ● LIVE · Astronaut B108 m behind-left ·  |
| Empty/unconfirmed suit reports location with wearer uncertainty | PASS | SUIT-S3 ● LIVE · Spare suit85 m behind-left · ±1.6 mWearer unconfirmed: shows where the suit is, not that someone is in it
 |
| Emergency return gives a route home with distance, time and oxygen needed | PASS | ⚠Emergency return to habitat89 m · about 3 min · needs ~1% O₂ · follow the red dashed route |
| Tablet touch targets ≥ 44 px | PASS | all tablet buttons ≥ 44 px tall |
| Tablet landscape layout 1024×768 | PASS | controls visible, nav canvas > 300 px, no horizontal scroll |
| Tablet landscape layout 1194×834 | PASS | controls visible, nav canvas > 300 px, no horizontal scroll |
| Tablet landscape layout 1366×1024 | PASS | controls visible, nav canvas > 300 px, no horizontal scroll |
| Guided Nili demo runs end to end and logs the decision | PASS | log contains simulated receipt, bypass result and acknowledgement |
| Works offline (airplane mode) after first load | PASS | offline reload: planner true, Nili evidence true, pill "OFFLINE · cached data" |
| No uncaught page errors | PASS | none |
