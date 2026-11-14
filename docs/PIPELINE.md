# Data pipeline

Python CLI: `python3 -m marsdelta_pipeline <command>`, run from `pipeline/`. Pipeline version 0.3.0.

| Command | What it does |
|---|---|
| `fetch-process` | Runs every area below in order. |
| `nili` / `nili-process` | Downloads both HiRISE RED products and the NASA PIA images, then runs change detection. `nili-process` skips the download. |
| `jezero` | Range-reads the USGS DTM and ortho, then the Perseverance traverse, waypoints and USGS SIM 3464 geology. Runs `photos`. |
| `dust` | Extracts the LMD gridded column dust optical depth series for each area's cell. |
| `meda` | Ingests MEDA PDS4 CSVs and labels from `data/raw/meda/`. If none are present it writes an explicit `unavailable` record. |
| `validate` | 156 checks. See [TEST_RESULTS.md](TEST_RESULTS.md). |
| `pack` | Builds the offline `demo-pack/` and `demo-pack.zip` from `web/dist`. |

Every download goes through `common.download()`. It records the resolved URL, SHA-256 hash, size, credit and purpose in `data/source_manifest.json`.

## Coordinate systems

- **Local mission CRS, one per area.** Equirectangular on the Mars 2000 sphere (R = 3,396,190 m) with true scale at the area centre. The area centre is the origin (0, 0); x points east and y points north, in metres.
  - Jezero: origin 18.4525°N, 77.4050°E.
  - Nili Patera: origin 8.7800°N, 67.3240°E.
  - The PROJ string and WKT are written into each area's metadata. The browser uses the same formulas (`web/src/core/geo.ts`) with Leaflet `CRS.Simple`.
- **HiRISE native CRS.** Change detection runs in the products' own label CRS: equirectangular, standard parallel 5°, central meridian 180°, local radius 3,396,036.8 m, 0.25 m/px. Both labels are checked to agree. Only the output polygons and previews are transformed into the local CRS.
- **Jezero DTM and ortho.** Reprojected from the USGS equirectangular mosaics to the local CRS. The DTM is resampled to 2 m on a 650 × 600 grid and the ortho to 0.5 m.

## Nili Patera change investigation (`nili.py`)

1. **Crop.** A 512 m × 512 m window (2048 × 2048 px) around the dune NASA documents in PIA15680, near 8.78°N, 67.324°E.
2. **Locate NASA's figure.** PIA15680 is template-matched inside both products (NCC 0.923 and 0.927). This gives the NASA frame footprint and an independent coarse offset.
3. **Coarse registration.** The median of 102 bedrock NCC patches gives (−83, +116) m. This agrees with the PIA15680 match to within 2 m.
4. **Fine registration.** Phase correlation on locally normalised 64 px bedrock windows gives 362 controls. One control in four is held out. A RANSAC affine fit uses the remaining 271.
   - Fit RMS is 0.077 m.
   - **Held-out RMS is 0.086 m (0.35 px)** and the held-out maximum is 1.06 px.
   - Before fine registration the held-out RMS was 7.1 px.
5. **Masks.**
   - Saturated pixels, shadow and a 6 m border are masked.
   - Shadow is defined as dark *and* low-texture, so that dark dune sand is not masked. The resulting shadow fraction is 0.
   - Bedrock and dune masks are built from brightness and texture.
6. **Change detection.**
   - Local NCC below 0.35 counts as a candidate.
   - Morphological open and close, then a minimum area.
   - Polygonized with 8-connectivity.
   - Regions are split at the NASA PIA15680 frame.
7. **False-positive check.** On bedrock, which should not change, the final mask covers 1.08% of 2.34 M pixels. On the dune it covers 81%.
8. **Classification.**
   - **Verified**: on dune sand inside NASA's PIA15680 frame, where NASA published ripple motion.
   - **Requires Review**: on dune sand outside that frame.
   - **Uncertain**: mostly on bedrock, or on the border or shadow.
   - Each region carries its own one-sentence explanation. NASA's site-level statement is kept as a separate field (`nasa_reference`) and is never copied onto regions.
9. **Displacement.**
   - Method: NCC template search with 32 m windows and ±6 m search. Each match must pass a forward/backward check, a peak-distinctness test, an alignment test, and an aliasing test against the measured ripple wavelength of 4.53 m.
   - **All 17 regions are reported as "Displacement unresolved", each with its reason.** No displacement value is invented.

Result: 17 candidate regions (2 Verified, 7 Requires Review, 8 Uncertain), covering 79,248 m².

Outputs:
- `web/public/data/nili/change_evidence.json` holds the full record: parameters, controls, residuals, masks, regions and provenance.
- `change_regions.geojson`.
- Aligned before/after previews, the texture-difference image, the mask overlay, and the NASA reference images.
- The raw mask GeoTIFF is written to `data/work/nili/`.

The browser loads this precomputed result. It does not re-run the pipeline.

## Jezero (`jezero.py`, `photos.py`, `dust.py`, `meda.py`)

- **Terrain.** The DTM is stored as uint16 `(elevation + 3000) × 10`, with 0 meaning no data. A hillshade and a slope overlay are derived from it.
- **Rover waypoints.** The MMGIS waypoint file supplies the real stop positions: the delta-front base and the delta layers stop, each with its RMC site/drive record.
- **Photos.** Five Mastcam-Z browse frames, each tied to a stop by RMC site_drive.
  - Viewing direction is the camera vector rotated by the attitude quaternion. It is cross-checked against rover yaw + mast azimuth and withheld if the two disagree by more than 10°.
  - Horizontal field of view comes from the CAHV camera model.
  - The target ground point is *not* estimated and is shown as unknown.
- **Dust.** The LMD climatology gives regional column dust context for a ±2.5° cell. It is labelled as context, not as a surface measurement.
- **MEDA.** Blocked. See the [implementation report](IMPLEMENTATION_REPORT.md).
