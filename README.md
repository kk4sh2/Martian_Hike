# MarsDelta

MarsDelta is an evidence-backed Mars EVA planner built for the NASA Space Apps challenge "Interplanetary Survival Guide: Martian Map". It has two mission areas, each with its own evidence:

- **Nili Patera.** *MarsDelta Change Intelligence* compares HiRISE PSP_004339_1890 (2007-06-30) with PSP_005684_1890 (2007-10-13). It registers the pair on bedrock, detects candidate surface change, classifies each region, and tests whether planned walks cross those regions.
- **Jezero, western delta.** A science walk. Routes are computed on the USGS HiRISE DTM. Ground truth comes from real Mastcam-Z frames tied to Perseverance mission records. A seeded Monte Carlo resource estimate is included, and the walk always returns to the habitat.

One site holds both a planner view and a landscape astronaut tablet view. The tablet has simulated suit-beacon crew tracking and guided demos for both areas. After the first load the site works offline.

This is a hackathon demonstration. It is not flight software, it is not certified for safety, and it is not endorsed by NASA. All crew positions, wearer signals, the habitat placement and mission events are simulated, and the site labels them that way.

## Live site

https://kk4sh2.github.io/Martian_Hike/ is rebuilt and deployed by `.github/workflows/pages.yml` on every push to `main`. One-time setup: in the repository's Settings → Pages, set Source to "GitHub Actions".

## Run the demo (no build)

```bash
unzip demo-pack.zip && cd demo-pack && python3 serve.py   # then open http://localhost:8080
```

## Build from source

Requirements: Node 18+ and Python 3.10+ with GDAL-backed rasterio.

```bash
# web app (uses the processed data already in web/public/data)
cd web
npm install
npm test                 # 8 unit tests (routing, metrics, Monte Carlo, intersection, crew)
npm run build            # tsc + vite + service-worker precache -> web/dist
npx vite preview --port 4173
node tests/e2e.cjs       # Playwright acceptance tests against the preview server

# data pipeline (re-creates everything in web/public/data from the public archives)
cd ../pipeline
pip install -r requirements.txt
python3 -m marsdelta_pipeline fetch-process   # all areas: download + process
python3 -m marsdelta_pipeline validate        # 156 integrity and honesty checks
python3 -m marsdelta_pipeline pack            # demo-pack/ and demo-pack.zip (run after npm run build)
python3 -m marsdelta_pipeline help            # per-area commands: nili, jezero, dust, meda
```

The full download is about 1.3 GB of raw HiRISE, DTM and ortho products. These go to `data/raw/`, which git ignores. Downloads use HTTP range reads where possible.

## Documentation

- [docs/IMPLEMENTATION_REPORT.md](docs/IMPLEMENTATION_REPORT.md): what ran, what is genuine, what is simulated, and what is blocked.
- [docs/JUDGE_WALKTHROUGH.md](docs/JUDGE_WALKTHROUGH.md): a two-minute walkthrough.
- [docs/PIPELINE.md](docs/PIPELINE.md): pipeline steps, parameters and coordinate systems.
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md): the source manifest (full hashes are in `data/source_manifest.json`).
- [docs/CREW_TRACKING.md](docs/CREW_TRACKING.md): the simulated suit-beacon network.
- [docs/TEST_RESULTS.md](docs/TEST_RESULTS.md): latest unit, validation and acceptance results.

## Layout

```
pipeline/marsdelta_pipeline/   Python CLI: common, nili, jezero, photos, dust, meda, validate, pack
data/source_manifest.json      every downloaded file: URL, sha256, size, credit, purpose
web/src/core/                  geo, terrain, routing (A*), metrics, montecarlo, intersect, crew, weather
web/src/ui/                    planner, evidence viewer, tablet, demos, photo modal, bypass search
web/public/data/               processed, packaged evidence (about 11 MB)
web/tests/                     vitest unit tests + Playwright acceptance script
```
