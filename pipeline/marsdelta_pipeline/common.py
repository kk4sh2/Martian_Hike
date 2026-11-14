"""Shared helpers: paths, hashing, source manifest, Mars coordinate systems.

Coordinate conventions used everywhere in MarsDelta
---------------------------------------------------
* Body / datum: Mars 2000 IAU sphere, radius 3,396,190 m (the datum of the USGS
  Jezero products).  HiRISE RDR products use a *local* sphere radius written in
  their PDS label; we read their own WKT through GDAL and only convert at the
  end through geographic coordinates.
* Latitude: planetocentric, degrees, north positive.
* Longitude: degrees EAST, range -180..180 (both mission areas are east).
* Axis order: we always write (lon, lat) for geographic and (x=east, y=north)
  for projected coordinates, in metres.
* Analytical CRS: one local equirectangular projection per mission area whose
  standard parallel and central meridian sit at the area centre, so east-west
  scale error inside a few-km area is < 0.01 %.  Distances, slopes, route
  lengths and polygon intersections are computed ONLY in these CRSs.
* Local coordinates: x = R cos(lat0) (lon - lon0), y = R (lat - lat0), angles in radians,
  so the area centre is (0, 0).  The browser uses exactly this formula.
* Display: the web map uses the same local metres (Leaflet CRS.Simple, metres
  scaled), so no Earth Web-Mercator is involved.  Imagery overlays are
  resampled into the local CRS by the pipeline.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import json
import os
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "work"
WEB_DATA = ROOT / "web" / "public" / "data"
MANIFEST = ROOT / "data" / "source_manifest.json"
PIPELINE_VERSION = "0.3.0"

MARS_R = 3396190.0

AREAS = {
    # lat_ts / lon_0 are the analytical-projection centres.
    "jezero": {"lat0": 18.4525, "lon0": 77.4050},
    "nili": {"lat0": 8.7800, "lon0": 67.3240},
}


def local_crs_wkt(area: str) -> str:
    a = AREAS[area]
    return (
        'PROJCS["MarsDelta local equirectangular (%s)",'
        'GEOGCS["Mars 2000 sphere",DATUM["Mars_2000_Sphere",SPHEROID["Mars_2000_Sphere_IAU",%f,0]],'
        'PRIMEM["Reference_Meridian",0],UNIT["degree",0.0174532925199433]],'
        'PROJECTION["Equirectangular"],PARAMETER["standard_parallel_1",%f],'
        'PARAMETER["central_meridian",%f],PARAMETER["false_easting",0],'
        'PARAMETER["false_northing",%r],UNIT["metre",1],AXIS["Easting",EAST],AXIS["Northing",NORTH]]'
        % (area, MARS_R, a["lat0"], a["lon0"], false_northing(area))
    )


def false_northing(area: str) -> float:
    """Shift so the area centre sits at y = 0 (x is already 0 at lon0)."""
    import math
    return -MARS_R * math.radians(AREAS[area]["lat0"])


def local_proj4(area: str) -> str:
    a = AREAS[area]
    return (f"+proj=eqc +lat_ts={a['lat0']} +lat_0=0 +lon_0={a['lon0']} +x_0=0 +y_0={false_northing(area)!r} "
            f"+R={MARS_R} +units=m +no_defs")


def geo_proj4(radius: float = MARS_R) -> str:
    return f"+proj=longlat +R={radius} +no_defs"


def sha256(path: Path, chunk: int = 1 << 22) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            b = f.read(chunk)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def now_iso() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def load_manifest() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text())
    return {"pipeline_version": PIPELINE_VERSION, "sources": {}}


def save_manifest(m: dict) -> None:
    m["pipeline_version"] = PIPELINE_VERSION
    m["updated"] = now_iso()
    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(m, indent=2, sort_keys=True))


def record_source(key: str, **fields) -> None:
    m = load_manifest()
    entry = m["sources"].get(key, {})
    entry.update(fields)
    m["sources"][key] = entry
    save_manifest(m)


def download(url: str, dest: Path, key: str | None = None, credit: str = "", product_id: str = "",
             purpose: str = "", expected_size: int | None = None) -> Path:
    """Download with curl (resumable, follows redirects) and record it in the manifest."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not (dest.exists() and expected_size and dest.stat().st_size == expected_size):
        # -w prints the final URL after redirects so we can record it.
        out = subprocess.run(
            ["curl", "-sSL", "--fail", "-C", "-", "--retry", "4", "-o", str(dest), "-w", "%{url_effective}", url],
            capture_output=True, text=True,
        )
        if out.returncode not in (0, 33):  # 33 = range not supported but file complete
            raise RuntimeError(f"download failed {url}: {out.stderr.strip()}")
        resolved = out.stdout.strip() or url
    else:
        resolved = url
    if expected_size and dest.stat().st_size != expected_size:
        raise RuntimeError(f"{dest} size {dest.stat().st_size} != expected {expected_size}")
    if key:
        record_source(
            key, url=url, resolved_url=resolved, local_path=str(dest.relative_to(ROOT)), bytes=dest.stat().st_size,
            sha256=sha256(dest), retrieved=now_iso(), credit=credit, product_id=product_id, purpose=purpose,
        )
    return dest


def fetch_json(url: str, dest: Path, key: str | None = None, **kw) -> dict:
    download(url, dest, key=key, **kw)
    return json.loads(dest.read_text())


def http_head_size(url: str) -> int | None:
    req = urllib.request.Request(url, method="HEAD")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            n = r.headers.get("Content-Length")
            return int(n) if n else None
    except Exception:
        return None


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=2, default=_json_default))


def _json_default(o):
    import numpy as np

    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    raise TypeError(type(o))


def parse_pds3_label(text: str) -> dict:
    """Very small PDS3 keyword reader (top-level + nested keys flattened, last wins)."""
    out = {}
    key = None
    for raw in text.splitlines():
        line = raw.split("/*")[0].rstrip()
        if not line.strip():
            continue
        if "=" in line and not line.startswith(" " * 20):
            k, v = line.split("=", 1)
            key = k.strip()
            out[key] = v.strip()
        elif key:
            out[key] += " " + line.strip()
    return {k: v.strip().strip('"') for k, v in out.items()}
