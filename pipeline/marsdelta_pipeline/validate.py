"""Provenance and integrity checks for the evidence bundles. Exit code = number of failures."""
from __future__ import annotations

import json
import math
from pathlib import Path

from .common import ROOT, WEB_DATA, MANIFEST, sha256

FAILS: list[str] = []
OKS: list[str] = []


def check(cond: bool, msg: str):
    (OKS if cond else FAILS).append(msg)


def main() -> int:
    FAILS.clear(); OKS.clear()
    m = json.loads(MANIFEST.read_text())
    for k, v in m["sources"].items():
        lp = v.get("local_path")
        if lp and (ROOT / lp).exists():
            check(sha256(ROOT / lp) == v.get("sha256"), f"hash matches manifest: {k}")
        elif lp:
            check("data/raw" in lp, f"raw file not present locally (ok in a clean clone, re-fetch to verify): {k}")
        check(bool(v.get("credit") or k.startswith("derived")), f"credit recorded: {k}")
    # Nili evidence
    e = json.loads((WEB_DATA / "nili" / "change_evidence.json").read_text())
    reg = e["registration"]
    check(reg["heldout_rms_px"] < 1.0, f"Nili held-out registration residual {reg['heldout_rms_px']:.2f} px < 1 px")
    check(e["false_positive_check"]["final_mask_fraction_on_bedrock"] < 0.05, "Nili bedrock false-positive rate < 5%")
    ids = [r["id"] for r in e["regions"]]
    check(len(ids) == len(set(ids)), "Nili region IDs unique")
    for r in e["regions"]:
        lon, lat = r["centroid_lonlat"]
        check(67.2 < lon < 67.45 and 8.6 < lat < 9.1, f"{r['id']} centroid inside Nili Patera study area")
        d = r["displacement"]
        check(d["status"] in ("measured", "unresolved"), f"{r['id']} displacement status explicit")
        if d["status"] == "unresolved":
            check(not any(k in d for k in ("magnitude_m", "dx_east_m", "rate_m_per_day")), f"{r['id']} no invented displacement")
        check(r["classification"] in ("Verified", "Requires Review", "Uncertain") and r["explanation"], f"{r['id']} class + explanation")
    for p in e["previews"].values():
        check((WEB_DATA / "nili" / p).exists(), f"preview present: {p}")
    # Jezero bundle must not contain Nili content
    for f in (WEB_DATA / "jezero").rglob("*.json"):
        txt = f.read_text()
        check("PSP_004339" not in txt and "PSP_005684" not in txt and "NP-" not in txt, f"no Nili evidence leaks into {f.relative_to(WEB_DATA)}")
    t = json.loads((WEB_DATA / "jezero" / "terrain.json").read_text())
    g = t["grid"]
    check((WEB_DATA / "jezero" / g["file"]).stat().st_size == g["width"] * g["height"] * 2, "elevation grid size matches metadata")
    ph = json.loads((WEB_DATA / "jezero" / "photos.json").read_text())["photos"]
    check(len(ph) >= 2, f"{len(ph)} ground photos packaged (>= 2)")
    wp = {s["rmc"] for s in json.loads((WEB_DATA / "jezero" / "rover_waypoints.json").read_text())["stops"]}
    for p in ph:
        check(p["mission_record"]["rmc"] in wp, f"photo {p['product_id'][:24]} tied to a waypoint by RMC")
        check((WEB_DATA / "jezero" / p["local_file"]).exists(), "photo file present")
        check(p["target_position"] is None, "photographed-object position not invented")
    meda = json.loads((WEB_DATA / "jezero" / "meda.json").read_text())
    check(meda["status"] in ("available", "unavailable"), f"MEDA status explicit: {meda['status']}")
    if meda["status"] == "unavailable":
        check("sols" not in meda, "no MEDA values when unavailable")
    dust = json.loads((WEB_DATA / "dust_context.json").read_text())["areas"]
    check(dust["jezero"]["cell"]["lon_min"] <= 77.4 <= dust["jezero"]["cell"]["lon_max"], "Jezero dust cell contains corridor")
    check(dust["nili"]["cell"]["lon_min"] <= 67.3 <= dust["nili"]["cell"]["lon_max"], "Nili dust cell contains study area")
    size = sum(f.stat().st_size for f in WEB_DATA.rglob("*") if f.is_file())
    check(size < 40e6, f"evidence bundles total {size / 1e6:.1f} MB (< 40 MB demo limit)")
    for f in FAILS:
        print("FAIL", f)
    print(f"validate: {len(OKS)} checks passed, {len(FAILS)} failed")
    return len(FAILS)
