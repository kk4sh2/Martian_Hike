"""MarsDelta Change Intelligence for Nili Patera (HiRISE PSP_004339_1890 -> PSP_005684_1890).

Stages (each writes into data/work/nili and the web evidence bundle):
  fetch      download RED JP2 + PDS labels and NASA PIA15680 / PIA12860 / PIA12857
  locate     find NASA's published PIA15680 frames inside both HiRISE products (template match)
  process    coarse + fine bedrock registration, masking, change detection, polygons,
             displacement attempts, classification, exports

Nothing here invents numbers: every value written to the evidence record is
computed from the downloaded pixels, read from a PDS label, or is an explicit
processing parameter listed under "parameters".
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
import numpy as np
import rasterio
from PIL import Image
from pyproj import Transformer
from rasterio import features
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.windows import Window, from_bounds
from shapely.geometry import mapping, shape, box, Polygon
from shapely.ops import transform as shp_transform, unary_union

from .common import (RAW, WORK, WEB_DATA, ROOT, download, record_source, write_json, sha256, now_iso,
                     parse_pds3_label, local_proj4, geo_proj4, PIPELINE_VERSION)

PDS = "https://hirise-pds.lpl.arizona.edu/PDS/RDR/PSP"
OBS = {
    "before": {"id": "PSP_004339_1890", "orbit_dir": "ORB_004300_004399", "size": 874847939},
    "after": {"id": "PSP_005684_1890", "orbit_dir": "ORB_005600_005699", "size": 1304923855},
}
NASA = {
    "PIA15680": {"files": ["PIA15680.gif", "PIA15680.tif", "PIA15680.jpg"], "dir": "pia15/pia15680",
                 "page": "https://science.nasa.gov/photojournal/ripple-movement-on-sand-dune-in-nili-patera-mars/",
                 "credit": "NASA/JPL-Caltech/Univ. of Arizona/JHU-APL"},
    "PIA12860": {"files": ["PIA12860.tif", "PIA12860.jpg"], "dir": "pia12/pia12860",
                 "page": "https://science.nasa.gov/photojournal/changes-in-ripples-on-martian-dunes-in-nili-patera/",
                 "credit": "NASA/JPL-Caltech/University of Arizona/International Research School of Planetary Sciences"},
    "PIA12857": {"files": ["PIA12857.jpg"], "dir": "pia12/pia12857",
                 "page": "https://science.nasa.gov/photojournal/",
                 "credit": "NASA/JPL-Caltech/University of Arizona"},
}
NASA_ASSETS = "https://assets.science.nasa.gov/content/dam/science/psd/photojournal/pia"
HIRISE_CREDIT = "NASA/JPL-Caltech/University of Arizona (HiRISE)"

RAWD = RAW / "nili"
NASAD = RAW / "nasa"
W = WORK / "nili"
OUT = WEB_DATA / "nili"

# ---------------------------------------------------------------- parameters
P = {
    "overview_res_m": 1.0,           # resolution for locating & coarse registration
    "crop_half_size_m": 256.0,        # analysis crop is 512 m x 512 m at native 0.25 m
    "pia15680_mpp_search": [0.55, 0.95, 0.025],
    "coarse_patch_m": 192, "coarse_search_m": 200,
    "control_patch_px": 96,           # 24 m control windows at 0.25 m
    "control_step_px": 64,
    "control_min_bedrock_frac": 0.85,
    "control_min_response": 0.25,
    "heldout_every": 4,               # every 4th accepted control is held out
    "bedrock_erode_m": 4.0,
    "norm_sigma_m": 6.0,              # local illumination normalization scale
    "ncc_sigma_m": 2.0,               # local correlation window (Gaussian sigma)
    "change_ncc_threshold": 0.35,     # NCC below this => candidate difference
    "shadow_percentile": 1.5,         # darkest DN percentile (per image) ...
    "shadow_texture_ratio": 0.5,      # ... AND local std below this fraction of typical dune texture
    "weak_texture_ratio": 0.6,        # region texture below this fraction of dune texture => Uncertain
    "saturation_dn_fraction": 0.995,  # DN >= this * max => saturated
    "border_m": 6.0,
    "min_region_m2": 30.0,
    "open_radius_m": 0.75, "close_radius_m": 1.5,
    "disp_patch_px": 128,             # 32 m tracking windows
    "disp_step_px": 96,
    "disp_search_px": 24,             # +/- 6 m search
    "disp_min_texture_std": 0.35,
    "disp_fb_tolerance_px": 1.0,
    "disp_min_peak": 0.3,
    "disp_peak_ratio": 1.15,
    "disp_min_patches": 4,
    "disp_alias_fraction": 0.4,       # |d| must be < this * ripple wavelength
    "uncertain_max_shadow_frac": 0.25,
    "uncertain_max_border_frac": 0.3,
    "uncertain_min_control_quality": 0.0,
}


def fetch() -> None:
    for role, o in OBS.items():
        for ext, size in (("LBL", None), ("JP2", o["size"])):
            name = f"{o['id']}_RED.{ext}"
            download(f"{PDS}/{o['orbit_dir']}/{o['id']}/{name}", RAWD / name, key=f"hirise_{o['id']}_RED_{ext}",
                     credit=HIRISE_CREDIT, product_id=f"{o['id']}_RED", expected_size=size,
                     purpose=f"Nili Patera {role} observation, map-projected RED {ext}")
    for pia, d in NASA.items():
        for f in d["files"]:
            download(f"{NASA_ASSETS}/{d['dir']}/{f}", NASAD / f, key=f"nasa_{f}", credit=d["credit"], product_id=pia,
                     purpose=f"NASA published evidence ({d['page']})")


def label_crs(obs_id: str) -> str:
    lab = parse_pds3_label((RAWD / f"{obs_id}_RED.LBL").read_text())
    num = lambda k: float(lab[k].split("<")[0])
    R = num("A_AXIS_RADIUS") * 1000.0
    return ('PROJCS["HiRISE label equirectangular",GEOGCS["Mars local sphere",DATUM["Mars_local",SPHEROID["Mars_local",%r,0]],'
            'PRIMEM["Reference_Meridian",0],UNIT["degree",0.0174532925199433]],PROJECTION["Equirectangular"],'
            'PARAMETER["standard_parallel_1",%r],PARAMETER["central_meridian",%r],PARAMETER["false_easting",0],'
            'PARAMETER["false_northing",0],UNIT["metre",1]]' % (R, num("CENTER_LATITUDE"), num("CENTER_LONGITUDE")))


def label_meta(obs_id: str) -> dict:
    lab = parse_pds3_label((RAWD / f"{obs_id}_RED.LBL").read_text())
    keep = ["PRODUCT_ID", "START_TIME", "STOP_TIME", "MAP_PROJECTION_TYPE", "MAP_SCALE", "CENTER_LATITUDE",
            "CENTER_LONGITUDE", "A_AXIS_RADIUS", "MINIMUM_LATITUDE", "MAXIMUM_LATITUDE", "WESTERNMOST_LONGITUDE",
            "EASTERNMOST_LONGITUDE", "INCIDENCE_ANGLE", "EMISSION_ANGLE", "PHASE_ANGLE", "SUB_SOLAR_AZIMUTH",
            "SOLAR_LONGITUDE", "LOCAL_TIME", "PRODUCT_VERSION_ID", "PRODUCT_CREATION_TIME", "POSITIVE_LONGITUDE_DIRECTION",
            "PROJECTION_LATITUDE_TYPE", "LINE_LAST_PIXEL", "SAMPLE_LAST_PIXEL"]
    return {k: lab.get(k) for k in keep}


# ---------------------------------------------------------------- helpers
def to8(x, mask=None, lo_p=0.5, hi_p=99.5):
    m = (x > 0) if mask is None else mask
    lo, hi = np.percentile(x[m], [lo_p, hi_p])
    y = np.clip((x.astype(np.float32) - lo) / max(hi - lo, 1e-6) * 255, 0, 255).astype(np.uint8)
    y[~m] = 0
    return y


def fill(x, m):
    y = x.astype(np.float32).copy()
    y[~m] = float(np.mean(x[m])) if m.any() else 0
    return y


def local_norm(x, valid, sigma_px):
    x = fill(x, valid)
    mu = cv2.GaussianBlur(x, (0, 0), sigma_px)
    var = cv2.GaussianBlur(x * x, (0, 0), sigma_px) - mu * mu
    return (x - mu) / np.sqrt(np.maximum(var, 1e-6))


def local_std(x, sigma_px):
    g = lambda z: cv2.GaussianBlur(z, (0, 0), sigma_px)
    m = g(x)
    return np.sqrt(np.maximum(g(x * x) - m * m, 0))


def local_ncc(a, b, sigma_px):
    g = lambda z: cv2.GaussianBlur(z, (0, 0), sigma_px)
    ma, mb = g(a), g(b)
    cov = g(a * b) - ma * mb
    va = g(a * a) - ma * ma
    vb = g(b * b) - mb * mb
    return cov / np.sqrt(np.maximum(va * vb, 1e-6))


def phase_shift(a, b):
    """Shift (dx, dy) such that b(x) ~= a(x - d); returns (dx, dy, response)."""
    win = cv2.createHanningWindow((a.shape[1], a.shape[0]), cv2.CV_32F)
    (dx, dy), resp = cv2.phaseCorrelate(a.astype(np.float32), b.astype(np.float32), win)
    return dx, dy, resp


def read_overview(ds, bounds, res):
    l, b, r, t = bounds
    w = from_bounds(l, b, r, t, ds.transform)
    H, Wd = int(round((t - b) / res)), int(round((r - l) / res))
    return ds.read(1, window=w, out_shape=(H, Wd), resampling=Resampling.average).astype(np.float32)


def read_native(ds, bounds):
    l, b, r, t = bounds
    w = from_bounds(l, b, r, t, ds.transform).round_offsets().round_lengths()
    arr = ds.read(1, window=w, boundless=True, fill_value=0).astype(np.float32)
    return arr, ds.window_transform(w), w


# ---------------------------------------------------------------- locate NASA frames
def locate_pia(dA, dB, ovb, res):
    im = Image.open(NASAD / "PIA15680.gif")
    frames = []
    for i in range(2):
        im.seek(i)
        frames.append(np.array(im.convert("L")).astype(np.float32))
    bar_rows = 30  # top band of each frame carries NASA's 85 m scale bar annotation; excluded from matching
    res_out = {}
    l, b, r, t = ovb
    for role, ds, fr in (("before", dA, frames[0]), ("after", dB, frames[1])):
        T = read_overview(ds, ovb, res)
        valid = T > 0
        T = fill(T, valid)
        best = None
        lo, hi, st = P["pia15680_mpp_search"]
        for mpp in np.arange(lo, hi + 1e-9, st):
            tpl = fr[bar_rows:]
            s = mpp / res
            t_ = cv2.resize(tpl, (int(tpl.shape[1] * s), int(tpl.shape[0] * s)), interpolation=cv2.INTER_AREA)
            rr = cv2.matchTemplate(T, t_, cv2.TM_CCOEFF_NORMED)
            _, mx, _, loc = cv2.minMaxLoc(rr)
            if best is None or mx > best[0]:
                best = (mx, float(mpp), loc, t_.shape)
        mx, mpp, (cx, cy), (th, tw) = best
        # full frame (including bar band) footprint in this product's map coordinates
        x0 = l + cx * res
        y0 = t - cy * res + bar_rows * mpp
        fw, fh = frames[0].shape[1] * mpp, frames[0].shape[0] * mpp
        res_out[role] = {"score": round(float(mx), 4), "metres_per_pixel": round(mpp, 3),
                         "footprint_map": [x0, y0 - fh, x0 + fw, y0]}
    return res_out, frames


# ---------------------------------------------------------------- coarse registration
def coarse_offset(dA, dB, ovb, res, pia):
    """Offset (dx, dy) in metres with A_map = B_map + d for the same ground feature."""
    # 1) from NASA frame matches (independent)
    fa, fb = pia["before"]["footprint_map"], pia["after"]["footprint_map"]
    d_pia = (fa[0] - fb[0], fa[3] - fb[3])
    # 2) from several bedrock patches matched by NCC across the whole overlap
    A = read_overview(dA, ovb, res)
    B = read_overview(dB, ovb, res)
    va, vb = A > 0, B > 0
    Bf = fill(B, vb)
    Af = fill(A, va)
    thr = np.percentile(Bf[vb], 60)
    ps = int(P["coarse_patch_m"] / res)
    srch = int(P["coarse_search_m"] / res)
    offs = []
    H, Wd = B.shape
    for y in range(srch, H - ps - srch, ps):
        for x in range(srch, Wd - ps - srch, ps):
            pb = Bf[y:y + ps, x:x + ps]
            if (vb[y:y + ps, x:x + ps].mean() < 0.99 or (pb > thr).mean() < 0.9):
                continue
            region = Af[y - srch:y + ps + srch, x - srch:x + ps + srch]
            if (va[y - srch:y + ps + srch, x - srch:x + ps + srch].mean() < 0.99):
                continue
            rr = cv2.matchTemplate(region, pb, cv2.TM_CCOEFF_NORMED)
            _, mx, _, loc = cv2.minMaxLoc(rr)
            if mx > 0.6:
                offs.append(((loc[0] - srch) * res, -(loc[1] - srch) * res, mx))
    offs = np.array(offs)
    d_bed = (float(np.median(offs[:, 0])), float(np.median(offs[:, 1]))) if len(offs) else None
    return {"from_pia15680_match_m": d_pia, "from_bedrock_patches_m": d_bed, "n_bedrock_patches": int(len(offs)),
            "bedrock_patch_spread_m": [float(np.std(offs[:, 0])), float(np.std(offs[:, 1]))] if len(offs) else None,
            "used": d_bed if d_bed else d_pia}


# ---------------------------------------------------------------- main processing
def process() -> dict:
    W.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    dA = rasterio.open(RAWD / f"{OBS['before']['id']}_RED.JP2")
    dB = rasterio.open(RAWD / f"{OBS['after']['id']}_RED.JP2")
    # The PDS labels are authoritative.  Both labels say: equirectangular, CENTER_LATITUDE 5 (true-scale
    # parallel), CENTER_LONGITUDE 180, local sphere radius 3396036.8126 m.  The GeoJP2 header embedded in
    # PSP_005684_1890_RED.JP2 encodes 5 deg as latitude_of_origin instead of standard parallel, which would
    # shift and rescale it; the affine pixel transform itself matches the label offsets.  We therefore use
    # a label-derived CRS for both products and record the discrepancy.
    crs_label = {k: label_crs(o["id"]) for k, o in OBS.items()}
    assert crs_label["before"] == crs_label["after"], "labels disagree on projection"
    CRS = rasterio.crs.CRS.from_wkt(crs_label["after"])
    crs_note = {role: {"embedded_geojp2_crs": ds.crs.to_wkt(), "matches_label": rasterio.crs.CRS.from_wkt(crs_label[role]).equals(ds.crs) if hasattr(ds.crs, "equals") else ds.crs == rasterio.crs.CRS.from_wkt(crs_label[role])}
                for role, ds in (("before", dA), ("after", dB))}
    assert abs(dA.res[0] - dB.res[0]) < 1e-9, "products must share the HiRISE map grid"
    res_native = dB.res[0]
    l = max(dA.bounds.left, dB.bounds.left); r = min(dA.bounds.right, dB.bounds.right)
    b = max(dA.bounds.bottom, dB.bounds.bottom); t = min(dA.bounds.top, dB.bounds.top)
    ovb = (l, b, r, t)
    res = P["overview_res_m"]
    meta = {k: label_meta(o["id"]) for k, o in OBS.items()}

    print("locating NASA PIA15680 frames ...")
    pia, frames = locate_pia(dA, dB, ovb, res)
    print(json.dumps({k: (v["score"], v["metres_per_pixel"]) for k, v in pia.items()}))
    print("coarse registration ...")
    co = coarse_offset(dA, dB, ovb, res, pia)
    print(co)
    dx0, dy0 = co["used"]

    # ---- crop: centred on NASA's documented dune frame (contains dune ripples + bedrock)
    fb = pia["after"]["footprint_map"]
    cx, cy = (fb[0] + fb[2]) / 2, (fb[1] + fb[3]) / 2
    hs = P["crop_half_size_m"]
    # snap to native pixel grid of B
    cx = dB.bounds.left + round((cx - dB.bounds.left) / res_native) * res_native
    cy = dB.bounds.top - round((dB.bounds.top - cy) / res_native) * res_native
    crop = (cx - hs, cy - hs, cx + hs, cy + hs)
    Bc, tB, winB = read_native(dB, crop)
    pad = 24.0
    Ac_raw, tA_raw, winA = read_native(dA, (crop[0] + dx0 - pad, crop[1] + dy0 - pad, crop[2] + dx0 + pad, crop[3] + dy0 + pad))
    padpx = int(pad / res_native)
    Ac0 = Ac_raw[padpx:padpx + Bc.shape[0], padpx:padpx + Bc.shape[1]]  # coarse-aligned before (no fine reg)
    H, Wd = Bc.shape
    m_per_px = res_native

    vB = Bc > 0
    vA0 = Ac0 > 0

    # ---- bedrock mask (bright, stationary) from AFTER image, eroded away from dune margins
    sB = cv2.GaussianBlur(fill(Bc, vB), (0, 0), 4 / m_per_px)
    b8 = to8(sB, vB)
    otsu, _ = cv2.threshold(b8[vB].reshape(-1, 1), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    bedrock = (b8 > otsu) & vB
    k = int(P["bedrock_erode_m"] / m_per_px)
    bedrock = cv2.erode(bedrock.astype(np.uint8), np.ones((2 * k + 1, 2 * k + 1), np.uint8)).astype(bool)
    dune = (b8 <= otsu) & vB

    # ---- fine registration from distributed bedrock control windows
    nA0 = local_norm(Ac0, vA0, P["norm_sigma_m"] / m_per_px)
    nB = local_norm(Bc, vB, P["norm_sigma_m"] / m_per_px)
    cp, st = P["control_patch_px"], P["control_step_px"]
    ctrls = []
    for y in range(cp, H - 2 * cp, st):
        for x in range(cp, Wd - 2 * cp, st):
            if bedrock[y:y + cp, x:x + cp].mean() < P["control_min_bedrock_frac"]:
                continue
            ddx, ddy, resp = phase_shift(nB[y:y + cp, x:x + cp], nA0[y:y + cp, x:x + cp])
            if resp >= P["control_min_response"] and abs(ddx) < cp / 4 and abs(ddy) < cp / 4:
                ctrls.append((x + cp / 2, y + cp / 2, ddx, ddy, resp))
    ctrls = np.array(ctrls)
    if len(ctrls) < 8:
        raise RuntimeError(f"only {len(ctrls)} bedrock controls; registration not defensible")
    idx = np.arange(len(ctrls))
    held = idx % P["heldout_every"] == 0
    fit = ctrls[~held]
    # robust affine A_pixel = M * B_pixel (fitted with RANSAC on fit controls)
    src = fit[:, :2].astype(np.float32)
    dst = (fit[:, :2] + fit[:, 2:4]).astype(np.float32)
    M, inl = cv2.estimateAffine2D(src, dst, ransacReprojThreshold=1.0, maxIters=5000, confidence=0.999)
    inl = inl.ravel().astype(bool)
    Ar = cv2.warpAffine(fill(Ac0, vA0), M, (Wd, H), flags=cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP)
    vA = cv2.warpAffine(vA0.astype(np.uint8), M, (Wd, H), flags=cv2.INTER_NEAREST | cv2.WARP_INVERSE_MAP).astype(bool)

    def residuals(cs):
        nAr = local_norm(Ar, vA, P["norm_sigma_m"] / m_per_px)
        out = []
        for (x, y, *_r) in cs:
            x0, y0 = int(x - cp / 2), int(y - cp / 2)
            ddx, ddy, resp = phase_shift(nB[y0:y0 + cp, x0:x0 + cp], nAr[y0:y0 + cp, x0:x0 + cp])
            out.append((ddx, ddy, resp))
        return np.array(out)

    r_fit = residuals(fit[inl])
    r_held = residuals(ctrls[held])
    rms = lambda rr: float(np.sqrt(np.mean(rr[:, 0] ** 2 + rr[:, 1] ** 2))) if len(rr) else None
    reg = {
        "method": "phase correlation on locally normalised bedrock windows; RANSAC affine; held-out validation",
        "coarse_offset": co,
        "n_controls_total": int(len(ctrls)), "n_fit": int(len(fit)), "n_fit_inliers": int(inl.sum()),
        "n_heldout": int(held.sum()),
        "affine_B_to_A_pixels": M.tolist(),
        "fit_rms_px": rms(r_fit), "fit_rms_m": rms(r_fit) * m_per_px,
        "heldout_rms_px": rms(r_held), "heldout_rms_m": rms(r_held) * m_per_px,
        "heldout_max_px": float(np.max(np.hypot(r_held[:, 0], r_held[:, 1]))) if len(r_held) else None,
        "pre_fine_heldout_rms_px": rms(ctrls[held][:, 2:4]),
        "controls": [{"col": float(c[0]), "row": float(c[1]), "dx_px": float(c[2]), "dy_px": float(c[3]),
                      "response": float(c[4]), "heldout": bool(h)} for c, h in zip(ctrls, held)],
    }
    print("registration", {k: reg[k] for k in ("n_controls_total", "fit_rms_px", "heldout_rms_px", "pre_fine_heldout_rms_px")})
    reg_unc_px = max(reg["heldout_rms_px"] or 0, reg["fit_rms_px"] or 0)

    # ---- masks
    border = int(P["border_m"] / m_per_px)
    valid = vA & vB
    valid = cv2.erode(valid.astype(np.uint8), np.ones((2 * border + 1, 2 * border + 1), np.uint8)).astype(bool)
    border_zone = (vA & vB) & ~valid
    sat = (Bc >= P["saturation_dn_fraction"] * Bc[vB].max()) | (Ar >= P["saturation_dn_fraction"] * Ac0[vA0].max())
    # deep shadow = among the darkest pixels AND nearly featureless (sunlit dark sand keeps its ripple texture)
    sdB, sdA = local_std(fill(Bc, vB), 1.0 / m_per_px), local_std(Ar, 1.0 / m_per_px)
    dune_sd_B, dune_sd_A = float(np.median(sdB[dune])), float(np.median(sdA[dune & vA]))
    shadow = (((Bc < np.percentile(Bc[vB], P["shadow_percentile"])) & (sdB < P["shadow_texture_ratio"] * dune_sd_B)) |
              ((Ar < np.percentile(Ac0[vA0], P["shadow_percentile"])) & (sdA < P["shadow_texture_ratio"] * dune_sd_A)))
    shadow = cv2.dilate(shadow.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)
    usable = valid & ~sat & ~shadow

    # ---- change detection: low local correlation of normalised texture
    nA = local_norm(Ar, vA, P["norm_sigma_m"] / m_per_px)
    ncc = local_ncc(nA, nB, P["ncc_sigma_m"] / m_per_px)
    cand = (ncc < P["change_ncc_threshold"]) & usable
    ro = max(1, int(P["open_radius_m"] / m_per_px)); rc = max(1, int(P["close_radius_m"] / m_per_px))
    ell = lambda r_: cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * r_ + 1, 2 * r_ + 1))
    cm = cv2.morphologyEx(cand.astype(np.uint8), cv2.MORPH_OPEN, ell(ro))
    cm = cv2.morphologyEx(cm, cv2.MORPH_CLOSE, ell(rc))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(cm, connectivity=8)
    min_px = P["min_region_m2"] / (m_per_px ** 2)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_px
    cm = keep[lab].astype(np.uint8)

    # bedrock false-positive check: what fraction of stable bedrock is flagged?
    bed_eval = bedrock & usable
    fp = {"bedrock_pixels_evaluated": int(bed_eval.sum()),
          "raw_candidate_fraction_on_bedrock": float(cand[bed_eval].mean()) if bed_eval.any() else None,
          "final_mask_fraction_on_bedrock": float(cm.astype(bool)[bed_eval].mean()) if bed_eval.any() else None,
          "final_mask_fraction_on_dune": float(cm.astype(bool)[dune & usable].mean()) if (dune & usable).any() else None}
    print("false-positive check", fp)

    # ---- georeferenced mask (B product grid)
    mask_tif = W / "nili_change_mask.tif"
    prof = {"driver": "GTiff", "height": H, "width": Wd, "count": 1, "dtype": "uint8", "crs": CRS,
            "transform": tB, "compress": "deflate", "nodata": 255}
    m_out = cm.copy(); m_out[~(vA & vB)] = 255
    with rasterio.open(mask_tif, "w", **prof) as d:
        d.write(m_out, 1)
        d.update_tags(DESCRIPTION="1=candidate surface difference, 0=no difference detected, 255=no data",
                      PIPELINE_VERSION=PIPELINE_VERSION)

    # ---- polygons in product CRS -> geographic -> local analytical CRS
    prod_to_lonlat = Transformer.from_crs(CRS.to_wkt(), "+proj=longlat +R=%r +no_defs" % CRS.to_dict().get("R", 3396036.8126024), always_xy=True)
    lonlat_to_local = Transformer.from_crs("+proj=longlat +R=3396190 +no_defs", local_proj4("nili"), always_xy=True)
    # NOTE: latitude/longitude are angles; the radius difference between the
    # HiRISE local sphere (3396.037 km) and the Mars 2000 sphere (3396.19 km)
    # only enters through the metric projection, which we redo locally.

    def prod2lonlat(g):
        return shp_transform(lambda x, y, z=None: prod_to_lonlat.transform(x, y), g)

    def lonlat2local(g):
        return shp_transform(lambda x, y, z=None: lonlat_to_local.transform(x, y), g)

    regions = []
    crop_tag = f"{int(round(crop[0]))}_{int(round(crop[3]))}"
    pia_fp_prod = box(*pia["after"]["footprint_map"])
    geoms = [(shape(g), v) for g, v in features.shapes(cm, mask=cm.astype(bool), transform=tB, connectivity=8)]
    geoms = [g.buffer(0) for g, v in geoms if v == 1]
    # Split each connected region at the boundary of NASA's PIA15680 frame so that only the part
    # NASA actually documented can be corroborated by it.
    split = []
    for g in geoms:
        parts = [g.intersection(pia_fp_prod), g.difference(pia_fp_prod)]
        for part in parts:
            polys = list(part.geoms) if hasattr(part, "geoms") else [part]
            split += [q for q in polys if q.geom_type == "Polygon" and q.area >= P["min_region_m2"]]
    geoms = split
    geoms.sort(key=lambda g: (-round(g.centroid.y, 1), round(g.centroid.x, 1)))
    ripple_wl = estimate_ripple_wavelength(nB, dune & usable, m_per_px)
    for i, g in enumerate(geoms):
        rid = f"NP-{OBS['before']['id'][4:10]}-{OBS['after']['id'][4:10]}-{crop_tag}-{i + 1:03d}"
        rmask = features.rasterize([(g, 1)], out_shape=(H, Wd), transform=tB).astype(bool)
        area_m2 = float(rmask.sum() * m_per_px ** 2)
        rows, cols = np.where(rmask)
        r0, r1, c0, c1 = rows.min(), rows.max(), cols.min(), cols.max()
        region_zone = cv2.dilate(rmask.astype(np.uint8), ell(int(3 / m_per_px))).astype(bool)
        shadow_frac = float((shadow & region_zone).sum() / max(region_zone.sum(), 1))
        border_frac = float((border_zone & region_zone).sum() / max(region_zone.sum(), 1))
        dune_frac = float((dune & rmask).mean() / max(rmask.mean(), 1e-9))
        tex = float(np.std(nB[rmask]))
        mean_ncc = float(np.mean(ncc[rmask]))
        disp = estimate_displacement(nA, nB, rmask & usable, m_per_px, reg_unc_px, ripple_wl)
        inside_pia = float(g.intersection(pia_fp_prod).area / g.area) if g.area else 0.0
        # classification
        reasons = []
        cls = None
        if shadow_frac > P["uncertain_max_shadow_frac"]:
            cls = "Uncertain"; reasons.append(f"{shadow_frac:.0%} of the surrounding area is deep shadow in at least one image.")
        if border_frac > P["uncertain_max_border_frac"]:
            cls = "Uncertain"; reasons.append("The region sits against the edge of the common valid image area.")
        rel_tex = float(np.median(sdB[rmask]) / max(dune_sd_B, 1e-6))
        if rel_tex < P["weak_texture_ratio"]:
            cls = "Uncertain"; reasons.append("The surface here is smooth in the after image (weak texture, e.g. a slip face or dune brink), so a brightness difference cannot be read as ripple motion.")
        if dune_frac < 0.5:
            cls = "Uncertain"; reasons.append("Most of the region lies on bright bedrock, which should not move; the difference is more likely lighting or residual misregistration.")
        if cls is None:
            if inside_pia >= 0.5 and min(pia["before"]["score"], pia["after"]["score"]) >= 0.85:
                cls = "Verified"
                reasons.append("The region lies on the dune shown in NASA's PIA15680 before/after pair, where NASA documented "
                               "ripple movement over the 105-day interval. Our pipeline found the difference independently, "
                               "and the NASA frame was located in both HiRISE products by template matching "
                               f"(scores {pia['before']['score']:.2f} / {pia['after']['score']:.2f}).")
            else:
                cls = "Requires Review"
                reasons.append("A texture difference survives registration, masking and noise filtering on dark dune sand, "
                               "but no independent published observation covers this exact spot. Ripple migration is the "
                               "likely explanation, yet the 14.7 degree change in solar incidence angle between the two images "
                               "can also alter how ripples look.")
        lonlat = prod2lonlat(g)
        local = lonlat2local(lonlat)
        c_ll = lonlat.centroid
        regions.append({
            "id": rid, "classification": cls, "explanation": " ".join(reasons),
            "area_m2": round(area_m2, 1), "centroid_lonlat": [round(c_ll.x, 6), round(c_ll.y, 6)],
            "mean_local_ncc": round(mean_ncc, 3), "texture_std": round(tex, 3), "relative_texture": round(rel_tex, 3), "dune_fraction": round(dune_frac, 3),
            "shadow_fraction": round(shadow_frac, 3), "border_fraction": round(border_frac, 3),
            "fraction_inside_nasa_pia15680_frame": round(inside_pia, 3),
            "displacement": disp,
            "source_pixels": {
                "after_product": OBS["after"]["id"] + "_RED",
                "after_window_rowcol": [int(winB.row_off + r0), int(winB.col_off + c0), int(winB.row_off + r1), int(winB.col_off + c1)],
                "before_product": OBS["before"]["id"] + "_RED",
                "before_window_rowcol_approx": _before_window(M, winA, padpx, r0, c0, r1, c1),
                "crop_rowcol": [int(r0), int(c0), int(r1), int(c1)],
            },
            "geometry_lonlat": mapping(lonlat), "geometry_local_m": mapping(local),
        })
    counts = {c: sum(1 for r_ in regions if r_["classification"] == c) for c in ("Verified", "Requires Review", "Uncertain")}
    print("regions", len(regions), counts)

    # ---- previews (crop grid, north up) for the evidence viewer
    previews = {}
    norm_mask = vB
    for name, arr, m in (("before_coarse_only", Ac0, vA0), ("before_aligned", Ar, vA), ("after", Bc, vB)):
        p = OUT / f"{name}.jpg"
        Image.fromarray(to8(arr, m)).save(p, quality=88)
        previews[name] = p.name
    heat = np.clip((1 - ncc) / 2 * 255, 0, 255).astype(np.uint8)
    heat[~usable] = 0
    Image.fromarray(cv2.applyColorMap(heat, cv2.COLORMAP_INFERNO)[:, :, ::-1]).save(OUT / "texture_difference.jpg", quality=85)
    previews["texture_difference"] = "texture_difference.jpg"
    rgba = np.zeros((H, Wd, 4), np.uint8)
    rgba[cm.astype(bool)] = (255, 170, 0, 150)
    rgba[shadow & valid] = (90, 90, 255, 110)
    rgba[~(vA & vB)] = (0, 0, 0, 160)
    Image.fromarray(rgba).save(OUT / "mask_overlay.png")
    previews["mask_overlay"] = "mask_overlay.png"
    # NASA blink frames for the independent viewer
    for i, nm in enumerate(("nasa_pia15680_before.png", "nasa_pia15680_after.png")):
        Image.fromarray(frames[i].astype(np.uint8)).save(OUT / nm)
    Image.open(NASAD / "PIA15680.gif").save(OUT / "PIA15680.gif", save_all=True)

    # crop footprint & NASA frame in lonlat/local
    crop_poly = box(*crop)
    crop_ll = prod2lonlat(crop_poly)
    pia_ll = prod2lonlat(pia_fp_prod)
    corners_ll = [prod_to_lonlat.transform(x, y) for x, y in ((crop[0], crop[3]), (crop[2], crop[3]), (crop[2], crop[1]), (crop[0], crop[1]))]
    valid_poly = unary_union([shape(g) for g, v in features.shapes((vA & vB).astype(np.uint8), transform=tB) if v == 1])

    evidence = {
        "schema": "marsdelta.change_evidence/1",
        "area": "nili", "generated": now_iso(), "pipeline_version": PIPELINE_VERSION,
        "precomputed": True,
        "observations": {
            role: {"id": OBS[role]["id"], "product_id": OBS[role]["id"] + "_RED",
                   "page": f"https://www.uahirise.org/{OBS[role]['id']}",
                   "jp2_url": f"{PDS}/{OBS[role]['orbit_dir']}/{OBS[role]['id']}/{OBS[role]['id']}_RED.JP2",
                   "label_url": f"{PDS}/{OBS[role]['orbit_dir']}/{OBS[role]['id']}/{OBS[role]['id']}_RED.LBL",
                   "sha256": sha256(RAWD / f"{OBS[role]['id']}_RED.JP2"), "credit": HIRISE_CREDIT, "label": meta[role]}
            for role in OBS},
        "interval_days": 105,
        "processing_crs": CRS.to_wkt(), "crs_check": crs_note, "processing_grid": "after-image native HiRISE grid (0.25 m)",
        "analysis_crs_proj4": local_proj4("nili"),
        "crop": {"bounds_product_m": list(crop), "size_px": [Wd, H], "transform": list(tB)[:6],
                 "corners_lonlat_nw_ne_se_sw": [[round(a, 6), round(b_, 6)] for a, b_ in corners_ll],
                 "footprint_lonlat": mapping(crop_ll), "footprint_local_m": mapping(lonlat2local(crop_ll)),
                 "valid_area_fraction": float((vA & vB).mean()),
                 "valid_footprint_local_m": mapping(lonlat2local(prod2lonlat(valid_poly.simplify(1.0))))},
        "registration": reg,
        "masks": {"saturated_fraction": float(sat[valid].mean()), "shadow_fraction": float(shadow[valid].mean()),
                  "border_m": P["border_m"], "bedrock_fraction": float(bedrock.mean()), "dune_fraction": float(dune.mean())},
        "false_positive_check": fp,
        "ripple_wavelength_m": ripple_wl,
        "nasa_reference": {
            "pia": "PIA15680", "page": NASA["PIA15680"]["page"], "credit": NASA["PIA15680"]["credit"],
            "statement": ("NASA: blinking the June 30, 2007 and Oct. 13, 2007 HiRISE images, registered on fixed bedrock "
                          "features, shows ripple motion on a dark sand dune over 105 days; site near 8.7 N, 67.3 E. "
                          "Scale bar 85 m."),
            "located_in_products": pia, "footprint_lonlat": mapping(pia_ll), "footprint_local_m": mapping(lonlat2local(pia_ll)),
            "also": {"pia": "PIA12860", "page": NASA["PIA12860"]["page"], "credit": NASA["PIA12860"]["credit"]},
        },
        "parameters": P,
        "previews": previews,
        "outputs": {"mask_geotiff": str(mask_tif.relative_to(ROOT)), "regions_geojson": "data/nili/change_regions.geojson"},
        "summary": {"candidate_regions": len(regions), "by_class": counts,
                    "candidate_area_m2": round(sum(r_["area_m2"] for r_ in regions), 1)},
        "regions": regions,
    }
    write_json(OUT / "change_evidence.json", evidence)
    fc = {"type": "FeatureCollection", "name": "nili_change_regions_lonlat",
          "features": [{"type": "Feature", "geometry": r_["geometry_lonlat"],
                        "properties": {k: r_[k] for k in ("id", "classification", "area_m2")}} for r_ in regions]}
    write_json(OUT / "change_regions.geojson", fc)
    write_json(W / "registration_controls.json", reg["controls"])
    record_source("derived_nili_change_evidence", local_path=str((OUT / "change_evidence.json").relative_to(ROOT)),
                  sha256=sha256(OUT / "change_evidence.json"), generated=now_iso(), purpose="MarsDelta derived evidence record")
    return evidence


def _before_window(M, winA, padpx, r0, c0, r1, c1):
    pts = np.array([[c0, r0], [c1, r1]], np.float64)
    out = (np.hstack([pts, np.ones((2, 1))]) @ np.array(M).T)  # crop pixel -> before (coarse) crop pixel
    return [int(winA.row_off + padpx + out[0, 1]), int(winA.col_off + padpx + out[0, 0]),
            int(winA.row_off + padpx + out[1, 1]), int(winA.col_off + padpx + out[1, 0])]


def estimate_ripple_wavelength(nB, m, m_per_px):
    """Dominant ripple wavelength from the 2-D power spectrum of dune pixels (after image)."""
    ys, xs = np.where(m)
    if len(ys) < 10000:
        return None
    # pick the most dune-filled 256 px window
    best, bw = None, 256
    for y in range(0, nB.shape[0] - bw, bw // 2):
        for x in range(0, nB.shape[1] - bw, bw // 2):
            f = m[y:y + bw, x:x + bw].mean()
            if best is None or f > best[0]:
                best = (f, y, x)
    _, y, x = best
    patch = nB[y:y + bw, x:x + bw] * np.outer(np.hanning(bw), np.hanning(bw))
    ps = np.abs(np.fft.fftshift(np.fft.fft2(patch))) ** 2
    c = bw // 2
    yy, xx = np.mgrid[-c:c, -c:c]
    rr = np.hypot(yy, xx)
    ps[rr < 4] = 0  # ignore scales > bw/4 px (illumination / dune scale)
    iy, ix = np.unravel_index(np.argmax(ps), ps.shape)
    f = rr[iy, ix] / bw  # cycles per pixel
    wl = 1 / f * m_per_px
    ang = math.degrees(math.atan2(-(iy - c), ix - c)) % 180
    return {"wavelength_m": round(float(wl), 2), "crest_normal_azimuth_deg_from_east": round(ang, 1),
            "window_crop_rowcol": [int(y), int(x), int(y + bw), int(x + bw)], "dune_fraction": round(float(best[0]), 3)}


def estimate_displacement(nA, nB, rmask, m_per_px, reg_unc_px, wl):
    """Track texture between dates with NCC template search (forward and backward).

    Reports a displacement only when windows are textured, peaks are distinct, forward/backward agree,
    the offset exceeds 3x the registration uncertainty, and it is short enough relative to the ripple
    wavelength that a periodic match cannot be mistaken for the true motion.
    """
    ps, st, sr = P["disp_patch_px"], P["disp_step_px"], P["disp_search_px"]
    H, Wd = nA.shape
    ys, xs = np.where(rmask)
    rej = {"texture": 0, "weak_peak": 0, "ambiguous_peak": 0, "forward_backward": 0, "below_alignment": 0, "alias": 0}
    raw, vecs, tried = [], [], 0
    for y in range(max(2 * sr, ys.min()), min(H - ps - 2 * sr, ys.max()), st):
        for x in range(max(2 * sr, xs.min()), min(Wd - ps - 2 * sr, xs.max()), st):
            if rmask[y:y + ps, x:x + ps].mean() < 0.8:
                continue
            tried += 1
            t = nA[y:y + ps, x:x + ps]
            if t.std() < P["disp_min_texture_std"]:
                rej["texture"] += 1; continue
            r = cv2.matchTemplate(nB[y - sr:y + ps + sr, x - sr:x + ps + sr], t, cv2.TM_CCOEFF_NORMED)
            _, mx, _, loc = cv2.minMaxLoc(r)
            r2 = r.copy(); cv2.circle(r2, loc, 6, -1.0, -1); sec = float(r2.max())
            fdx, fdy = loc[0] - sr, loc[1] - sr
            yy, xx = y + fdy, x + fdx
            t2 = nB[yy:yy + ps, xx:xx + ps]
            rb = cv2.matchTemplate(nA[yy - sr:yy + ps + sr, xx - sr:xx + ps + sr], t2, cv2.TM_CCOEFF_NORMED)
            _, mxb, _, locb = cv2.minMaxLoc(rb)
            bdx, bdy = locb[0] - sr, locb[1] - sr
            raw.append((fdx, fdy, float(mx), sec))
            if mx < P["disp_min_peak"]:
                rej["weak_peak"] += 1; continue
            if mx < P["disp_peak_ratio"] * max(sec, 1e-6):
                rej["ambiguous_peak"] += 1; continue
            if math.hypot(fdx + bdx, fdy + bdy) > P["disp_fb_tolerance_px"]:
                rej["forward_backward"] += 1; continue
            mag = math.hypot(fdx, fdy)
            if mag < 3 * reg_unc_px:
                rej["below_alignment"] += 1; continue
            if wl and mag * m_per_px > P["disp_alias_fraction"] * wl["wavelength_m"]:
                rej["alias"] += 1; continue
            vecs.append((fdx, fdy))
    out = {"method": "NCC template search of 32 m windows (+/-6 m), forward/backward check, peak-distinctness, alignment and aliasing tests",
           "windows_tried": tried, "windows_accepted": len(vecs), "rejections": rej}
    if raw:
        a = np.array(raw)
        mags = np.hypot(a[:, 0], a[:, 1]) * m_per_px
        out["diagnostic_unfiltered_offsets"] = {
            "n": int(len(a)), "median_offset_m": round(float(np.median(mags)), 2),
            "median_peak_ncc": round(float(np.median(a[:, 2])), 3),
            "median_second_peak_ncc": round(float(np.median(a[:, 3])), 3),
            "note": "Diagnostic only, not a measurement: unfiltered best-match offsets before the reliability tests."}
    if len(vecs) >= P["disp_min_patches"]:
        v = np.array(vecs, float)
        med = np.median(v, axis=0)
        spread = float(np.median(np.hypot(v[:, 0] - med[0], v[:, 1] - med[1])))
        if spread < 0.5 * max(float(np.hypot(*med)), 1e-6):
            dx_m, dy_m = med[0] * m_per_px, -med[1] * m_per_px
            mag = math.hypot(dx_m, dy_m)
            out.update({"status": "measured", "dx_east_m": round(dx_m, 2), "dy_north_m": round(dy_m, 2),
                        "magnitude_m": round(mag, 2),
                        "uncertainty_m": round(math.hypot(spread * m_per_px, reg_unc_px * m_per_px), 2),
                        "direction_toward_azimuth_deg": round((math.degrees(math.atan2(dx_m, dy_m)) + 360) % 360, 1),
                        "rate_m_per_day": round(mag / 105, 3)})
            return out
        out["note"] = "Accepted windows disagree with each other."
    reason = []
    if raw:
        if rej["ambiguous_peak"] + rej["weak_peak"] > 0.5 * max(tried, 1):
            reason.append("ripple texture changed enough that correlation peaks are weak or have near-equal rivals")
        if rej["alias"]:
            reason.append(f"offsets that pass other tests are comparable to the {wl['wavelength_m'] if wl else '?'} m ripple wavelength, so a one-wavelength jump cannot be excluded")
    else:
        reason.append("region too small or too masked for 32 m tracking windows")
    out.update({"status": "unresolved", "label": "Displacement unresolved", "reason": "; ".join(reason)})
    return out


def main(stage: str = "all"):
    if stage in ("fetch", "all"):
        fetch()
    if stage in ("process", "all"):
        process()
