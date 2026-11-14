"""Jezero western-delta demonstration corridor.

Extracts only a ~1.3 km x 1.2 km corridor from the USGS Mars 2020 TRN HiRISE DTM mosaic (1 m) and
orthomosaic (25 cm) with HTTP range reads, reprojects both to the MarsDelta local equirectangular CRS,
derives slope / hillshade, clips the USGS SIM 3464 geologic map, and selects Perseverance waypoints
from NASA's published localized-waypoint file.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio.enums import Resampling
from rasterio.transform import from_origin
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import from_bounds
from shapely.geometry import box, mapping, shape, Point, LineString
from shapely.ops import transform as shp_transform

from .common import RAW, WORK, WEB_DATA, ROOT, download, record_source, write_json, now_iso, sha256, local_proj4, local_crs_wkt, MARS_R, AREAS

S3 = "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE/"
USGS = "https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/"
DTM = "JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif"
ORTHO = "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif"
WAYPOINTS = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"
TRAVERSE = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json"
GEOLOGY_ZIP = "https://pubs.usgs.gov/sim/3464/sim3464_database.zip"

RAWD = RAW / "jezero"
OUT = WEB_DATA / "jezero"
# corridor in local metres (x east, y north) relative to lon0/lat0 in common.AREAS
CORRIDOR = (-700.0, -500.0, 600.0, 700.0)
DTM_RES = 1.0
ORTHO_RES = 0.5
GRID_RES = 2.0     # browser routing grid

GEO = "+proj=longlat +R=3396190 +no_defs"


def tf(a, b):
    return Transformer.from_crs(a, b, always_xy=True)


def extract_raster(name: str, res: float, resampling, dtype):
    src_url = "/vsicurl/" + S3 + name
    dst_crs = rasterio.crs.CRS.from_wkt(local_crs_wkt("jezero"))
    l, b, r, t = CORRIDOR
    W, H = int((r - l) / res), int((t - b) / res)
    dst_tr = from_origin(l, t, res, res)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
                      GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="2"):
        with rasterio.open(src_url) as src:
            sb = transform_bounds(dst_crs, src.crs, l, b, r, t, densify_pts=21)
            m = 20 * src.res[0]
            win = from_bounds(sb[0] - m, sb[1] - m, sb[2] + m, sb[3] + m, src.transform).round_offsets().round_lengths()
            arr = src.read(1, window=win)
            info = {"width": src.width, "height": src.height, "res": src.res, "nodata": src.nodata, "dtype": src.dtypes[0],
                    "crs_wkt": src.crs.to_wkt(), "bounds": list(src.bounds), "window": [win.col_off, win.row_off, win.width, win.height]}
            out = np.full((H, W), np.nan if dtype == np.float32 else 0, dtype=dtype)
            reproject(arr, out, src_transform=src.window_transform(win), src_crs=src.crs, src_nodata=src.nodata,
                      dst_transform=dst_tr, dst_crs=dst_crs, dst_nodata=np.nan if dtype == np.float32 else 0,
                      resampling=resampling)
    record_source(f"usgs_{name}", url=USGS + name, resolved_url=S3 + name, access="HTTP range reads (GDAL /vsicurl) of the corridor only",
                  product_id=name, credit="USGS Astrogeology / NASA / JPL-Caltech / University of Arizona (HiRISE); Fergason et al. 2020",
                  retrieved=now_iso(), source_raster=info, corridor_local_m=list(CORRIDOR),
                  purpose="Jezero demonstration corridor terrain/imagery")
    return out, dst_tr, info


def slope_aspect(z, res):
    gy, gx = np.gradient(z, res)       # rows go south: gy is d/d(-north)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    return slope


def hillshade(z, res, az=315, alt=45):
    gy, gx = np.gradient(z, res)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    azr, altr = math.radians(360 - az + 90), math.radians(alt)
    hs = np.sin(altr) * np.cos(slope) + np.cos(altr) * np.sin(slope) * np.cos(azr - aspect)
    return np.clip(hs * 255, 0, 255)


def terrain():
    OUT.mkdir(parents=True, exist_ok=True)
    print("reading DTM corridor ...")
    z, tr, dinfo = extract_raster(DTM, DTM_RES, Resampling.bilinear, np.float32)
    nod = ~np.isfinite(z) | (z < -9000)
    z[nod] = np.nan
    print("reading ortho corridor ...")
    o, otr, oinfo = extract_raster(ORTHO, ORTHO_RES, Resampling.average, np.uint8)
    slope = slope_aspect(np.where(nod, np.nanmean(z), z), DTM_RES)
    slope[nod] = np.nan
    # browser grid (2 m): elevation as uint16 decimetres above -3000 m, 0 = no data
    f = int(GRID_RES / DTM_RES)
    Hc, Wc = z.shape[0] // f, z.shape[1] // f
    zg = np.nanmean(z[:Hc * f, :Wc * f].reshape(Hc, f, Wc, f), axis=(1, 3))
    enc = np.where(np.isfinite(zg), np.round((zg + 3000) * 10), 0).astype("<u2")
    (OUT / "elevation_2m.u16").write_bytes(enc.tobytes())
    # imagery
    Image.fromarray(o).save(OUT / "ortho.jpg", quality=82)
    hs = hillshade(np.where(nod, np.nanmean(z), z), DTM_RES)
    hs[nod] = 0
    Image.fromarray(hs.astype(np.uint8)).save(OUT / "hillshade.jpg", quality=80)
    # slope classes as RGBA overlay: <5 clear, 5-10 yellow, 10-15 orange, 15-25 red, >25 magenta
    rgba = np.zeros(slope.shape + (4,), np.uint8)
    for lo, hi, col in ((5, 10, (250, 220, 60, 90)), (10, 15, (255, 150, 30, 130)), (15, 25, (240, 50, 40, 160)), (25, 90, (200, 40, 220, 190))):
        rgba[(slope >= lo) & (slope < hi)] = col
    rgba[nod] = (0, 0, 0, 170)
    Image.fromarray(rgba).save(OUT / "slope_overlay.png")
    meta = {
        "area": "jezero", "crs_proj4": local_proj4("jezero"), "corridor_local_m": list(CORRIDOR),
        "dtm": {"product": DTM, "native_res_m": dinfo["res"], "native_nodata": dinfo["nodata"],
                "vertical_reference": "Mars areoid (geoid), metres - 'MOLAtopography_DeltaGeoid' product",
                "resampled_res_m": DTM_RES, "elev_min_m": float(np.nanmin(z)), "elev_max_m": float(np.nanmax(z)),
                "nodata_fraction": float(nod.mean()), "slope_p50_deg": float(np.nanpercentile(slope, 50)),
                "slope_p95_deg": float(np.nanpercentile(slope, 95)), "slope_max_deg": float(np.nanmax(slope)),
                "quality_note": ("HiRISE stereo DTM mosaic produced for Mars 2020 TRN (Fergason et al. 2020). 1 m posting; "
                                 "true resolution of stereo DTMs is ~3x the posting, so slopes are representative of ~3 m baselines "
                                 "and do not resolve individual rocks. Native grid is equirectangular with true scale at the equator; "
                                 "MarsDelta reprojects it to a local projection before computing distances and slopes.")},
        "ortho": {"product": ORTHO, "native_res_m": oinfo["res"], "resampled_res_m": ORTHO_RES},
        "grid": {"file": "elevation_2m.u16", "res_m": GRID_RES, "width": Wc, "height": Hc,
                 "origin_top_left_local_m": [CORRIDOR[0], CORRIDOR[3]], "encoding": "uint16 LE, (elev_m + 3000) * 10, 0 = no data"},
        "images": {"ortho": "ortho.jpg", "hillshade": "hillshade.jpg", "slope_overlay": "slope_overlay.png",
                   "bounds_local_m": list(CORRIDOR)},
        "slope_classes_deg": [[5, 10], [10, 15], [15, 25], [25, 90]],
        "generated": now_iso(),
    }
    write_json(OUT / "terrain.json", meta)
    # keep full-res arrays for route analysis
    np.save(WORK / "jezero_dtm_1m.npy", z)
    return meta, z


def waypoints():
    wp = json.loads(download(WAYPOINTS, RAWD / "M20_waypoints.json", key="nasa_m20_waypoints",
                             credit="NASA/JPL-Caltech", product_id="M20_waypoints (MMGIS)",
                             purpose="Perseverance localized waypoints").read_text())
    trv = json.loads(download(TRAVERSE, RAWD / "M20_traverse.json", key="nasa_m20_traverse", credit="NASA/JPL-Caltech",
                              product_id="M20_traverse (MMGIS)", purpose="Perseverance traverse path").read_text())
    to_local = tf(GEO, local_proj4("jezero"))
    l, b, r, t = CORRIDOR
    stops = []
    for f in wp["features"]:
        p = f["properties"]
        x, y = to_local.transform(p["lon"], p["lat"])
        if l + 20 < x < r - 20 and b + 20 < y < t - 20:
            stops.append({"rmc": p["RMC"], "site": p["site"], "drive": p["drive"], "sol": p["sol"], "lon": p["lon"], "lat": p["lat"],
                          "x": round(x, 2), "y": round(y, 2), "elev_geoid_m": p.get("elev_geoid"), "yaw_deg": p.get("yaw"),
                          "final": p.get("final"), "note": p.get("Note")})
    corr = box(l, b, r, t)
    lines = []
    for f in trv["features"]:
        g = shp_transform(lambda X, Y, Z=None: to_local.transform(X, Y), LineString([c[:2] for c in f["geometry"]["coordinates"]]))
        gi = g.intersection(corr)
        if not gi.is_empty:
            lines.append({"type": "Feature", "properties": {"sol": f["properties"]["sol"]}, "geometry": mapping(gi.simplify(0.5))})
    write_json(OUT / "rover_waypoints.json", {"source": WAYPOINTS, "file_name": wp.get("name"), "credit": "NASA/JPL-Caltech",
                                               "note": "Rover positions are localized rover-frame origins from NASA's published waypoint file.",
                                               "stops": stops})
    write_json(OUT / "rover_traverse_local.geojson", {"type": "FeatureCollection", "features": lines})
    return stops


def geology():
    z = RAWD / "geology" / "sim3464_database.zip"
    if not z.exists():
        download(GEOLOGY_ZIP, z, key="usgs_sim3464_database", credit="Sun, V., and Stack, K., 2020, USGS SIM 3464",
                 product_id="sim3464_database.zip", purpose="Geologic context (1:75,000)")
    else:
        record_source("usgs_sim3464_database", url=GEOLOGY_ZIP, local_path=str(z.relative_to(ROOT)), sha256=sha256(z),
                      credit="Sun, V., and Stack, K., 2020, Geologic map of Jezero crater and the Nili Planum region, Mars: USGS SIM 3464, https://doi.org/10.3133/sim3464",
                      product_id="sim3464_database.zip", purpose="Geologic context (1:75,000)", retrieved=now_iso())
    import zipfile, geopandas as gpd
    d = RAWD / "geology" / "db"
    if not d.exists():
        zipfile.ZipFile(z).extractall(d)
    gdb = next(d.rglob("Nili.gdb"))
    units = gpd.read_file(gdb, layer="GeoUnits_v1")
    to_local = local_proj4("jezero")
    l, b, r, t = CORRIDOR
    m = 1500
    u = units.to_crs(to_local)
    u = u[u.intersects(box(l - m, b - m, r + m, t + m))].copy()
    u["geometry"] = u.geometry.intersection(box(l - m, b - m, r + m, t + m)).simplify(2.0)
    cols = [c for c in u.columns if c != "geometry"]
    feats = []
    for _, row in u.iterrows():
        props = {c: (None if (isinstance(row[c], float) and math.isnan(row[c])) else (str(row[c]) if not isinstance(row[c], (int, float)) else row[c])) for c in cols}
        feats.append({"type": "Feature", "properties": props, "geometry": mapping(row.geometry)})
    write_json(OUT / "geology_local.geojson", {"type": "FeatureCollection", "crs_note": local_proj4("jezero"),
                                               "scale": "1:75,000", "positional_note": "Mapped on a semi-controlled CTX mosaic; USGS notes random offsets of about 100-200 m relative to the surface-operations basemap. Use as regional context only, not to place a stop on a unit boundary.",
                                               "citation": "Sun, V., and Stack, K., 2020, USGS SIM 3464, https://doi.org/10.3133/sim3464",
                                               "features": feats})
    return feats


def main():
    WORK.mkdir(parents=True, exist_ok=True)
    terrain()
    waypoints()
    geology()


if __name__ == "__main__":
    main()
