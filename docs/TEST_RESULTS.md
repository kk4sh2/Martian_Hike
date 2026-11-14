# Test results (2026-11-14)

| Suite | Command | Result |
|---|---|---|
| Unit (vitest) | `cd web && npm test` | 8 / 8 pass |
| Type check + build | `npm run build` | passes; service worker precaches 36 files (11.5 MB) |
| Pipeline validation | `python3 -m marsdelta_pipeline validate` | 156 / 156 checks pass |
| Acceptance (Playwright, built site) | `node web/tests/e2e.cjs` | 20 pass, 0 fail, 1 blocked |

Raw acceptance output: [e2e_results.json](e2e_results.json).

## Acceptance tests

| # | Test | Result | Evidence |
|---|---|---|---|
| 1 | Ground photo traces to its mission record | PASS | ZL0_0414_0703684150… → RMC 22_788 (sol 413). The camera position equals the waypoint for that RMC, and the link goes to the NASA raw-image page. |
| 2 | Moving the landing pin updates the briefing | PASS | The pin text changes to 18.45426° N, 77.41089° E. |
| 3 | Pin move changes distance to a dated MEDA observation; gap explicit | **BLOCKED** | No MEDA data could be retrieved. The card says so and shows no values. |
| 4 | Two Jezero routes both include the return leg | PASS | 1.56 km and 1.62 km, both labelled "incl. return". |
| 5 | Success estimate responds to resources and is reproducible | PASS | Default is 100.0% of 500. With O2 at 0.16 kg it is 34.2%, with oxygen named as the main failure. Restoring the default gives 100.0% again, identical to the first run (same seed). |
| 6 | Environment / obstacles change the estimate and name the limiting factor | PASS | Cold with 290 Wh gives 4.0%, limited by battery. 40 obstacles/km with a 2 h limit gives 0.0%, limited by EVA time. |
| 7 | Intersecting / clear / out-of-coverage routes differ correctly | PASS | Route A: "Inspect the highlighted crossing". Route B: "crosses no candidate". Route C: partly outside the analysis coverage. |
| 8 | Nili evidence never appears in Jezero | PASS | No `NP-`, `PSP_` or `PIA15680` strings in the Jezero panel or legend. Jezero routes report "No repeat-imagery change analysis covers this mission area". |
| 9 | Jezero weather never appears in Nili | PASS | The Nili card states that no surface weather is shown. |
| 9b | Side panel hides and shows; header has no prototype label | PASS | With the panel hidden the map is full width, and it comes back on the second click. |
| 9c | Sources tab organised into sections | PASS | Tabs: Overview, Datasets, Change analysis, Planning model, Weather & dust, Terrain, Crew tracking. The method details moved there from the main panel. |
| 10 | Tablet left behind vs suit fix | PASS | "TAB-1 is not with its wearer … SUIT-A1's suit beacon, 39 m away." |
| 11 | Suit link loss freezes the last fix and shows its age; restore resumes | PASS | SUIT-B2 shows LAST KNOWN with "last contact 1:33 ago", then LIVE. |
| 12 | Unconfirmed spare suit | PASS | SUIT-S3 shows LIVE ±1.6 m and "Wearer unconfirmed". |
| 13 | Tablet touch targets ≥ 44 px | PASS | All visible tablet buttons are ≥ 44 px. |
| 14–16 | Tablet landscape at 1024×768, 1194×834 and 1366×1024 | PASS | Controls are visible, the nav canvas is > 300 px, and there is no horizontal scroll. |
| 17 | Guided Nili demo end to end | PASS | The log holds the simulated receipt, the bypass result and the acknowledgement. |
| 18 | Offline after first load | PASS | With the browser context offline, a reload brings up the planner and the Nili evidence. The status pill reads "OFFLINE · cached data". |
| 19 | No uncaught page errors | PASS | none |

"Preserve the original Jezero Traverse simulator" does not apply. No earlier repository or simulator existed, so MarsDelta was built fresh.

## Validation highlights (`validate.py`)

- Every packaged file's hash matches the manifest.
- The Nili held-out registration RMS is ≤ 0.5 m. Actual: 0.086 m.
- The final change mask covers ≤ 3% of bedrock. Actual: 1.08%.
- Every region has an ID, a class, an explanation, and either a validated displacement or "unresolved" with a reason.
- No Nili IDs or strings appear in any Jezero data file, and the reverse also holds.
- The terrain grid size and the no-data encoding are correct.
- Every photo maps to a waypoint by RMC with matching coordinates.
- The MEDA record is `available` with samples, or `unavailable` with a reason and no values.
- The packaged data is under 40 MB.
