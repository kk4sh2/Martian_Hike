"""Perseverance ground photos tied to science stops by mission record (RMC = site/drive), never by appearance.

For each selected product we save the image, the raw-image API JSON record, and derive:
  * camera position  = the localized rover position for the image's site/drive (NASA waypoint file);
                       the mast camera is ~2 m above and within ~1 m of that origin.
  * viewing azimuth  = camera pointing vector (rover frame, from the record's camera model) rotated by
                       the rover attitude quaternion (rover->site frame, +X north, +Y east, +Z down).
                       Cross-checked against rover yaw + mast azimuth; if the two disagree by >10 deg
                       the heading is withheld and no viewing cone is drawn.
  * horizontal FOV   = 2 atan((W/2) / |A x H|) from the CAHV(ORE) model.
  * photographed-object position: NOT AVAILABLE (no range in the record) and is never guessed.

Image selection: the reviewer (Claude, 2026-11-14) looked at contact sheets of all Mastcam-Z frames whose
site/drive equals a corridor waypoint and chose frames that show rock layers.  Which stop a photo belongs to
comes only from the record's site/drive.
"""
from __future__ import annotations

import json
import math
import urllib.request

import numpy as np
from pyproj import Transformer

from .common import RAW, WEB_DATA, download, write_json, local_proj4, now_iso

API = "https://mars.nasa.gov/rss/api/?feed=raw_images&category=mars2020&feedtype=json&id="
OUT = WEB_DATA / "jezero" / "photos"
RAWD = RAW / "jezero" / "photos"

SELECTED = [
    # (image id, stop key, why it was chosen)
    ("ZL0_0414_0703684150_456EBY_N0220788ZCAM08428_1100LMJ", "habitat", "Distant layered butte seen from the crater floor"),
    ("ZL0_0414_0703684168_488EBY_N0220788ZCAM08428_1100LMJ", "habitat", "Distant butte profile from the crater floor"),
    ("ZL0_0420_0704236463_331ECM_N0232872ZCAM08439_110085J", "scarp_base", "Blocks and sand at the base of the delta front"),
    ("ZL1_0464_0708130241_144ECM_N0260630ZCAM03381_0340LMJ", "delta_layers", "Layered sedimentary outcrop at the delta front"),
    ("ZL5_0464_0708122319_318ECM_N0260630ZCAM03377_1100LMJ", "delta_layers", "Close view of thin, inclined layers"),
]


def qrot(q, v):
    w, x, y, z = q
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y)],
                  [2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x)],
                  [2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)]])
    return R @ v


def vec(s):
    return np.array([float(t) for t in s.strip("()").split(",")])


def main():
    wp = json.loads((WEB_DATA / "jezero" / "rover_waypoints.json").read_text())
    by_rmc = {s["rmc"]: s for s in wp["stops"]}
    to_local = Transformer.from_crs("+proj=longlat +R=3396190 +no_defs", local_proj4("jezero"), always_xy=True)
    OUT.mkdir(parents=True, exist_ok=True)
    out = []
    for img_id, stop, why in SELECTED:
        rec = json.loads(download(API + img_id, RAWD / f"{img_id}.json", key=f"m2020_raw_{img_id}_record",
                                  credit="NASA/JPL-Caltech/ASU", product_id=img_id, purpose="raw image mission record").read_text())
        im = rec["image"][0] if "image" in rec else (rec if "imageid" in rec else rec["images"][0])
        url = im["image_files"]["large"]
        cred = im.get("credit", "NASA/JPL-Caltech")
        download(url, OUT / f"{img_id}.jpg", key=f"m2020_raw_{img_id}_image", credit=cred, product_id=img_id,
                 purpose="ground photo (1200 px browse)")
        rmc = f"{int(im['site'])}_{int(im['drive'])}"
        w = by_rmc.get(rmc)
        if w is None:
            raise RuntimeError(f"{img_id}: RMC {rmc} not in corridor waypoints; refusing to assign a position")
        x, y = to_local.transform(w["lon"], w["lat"])
        cam = im["camera"]
        comps = cam["camera_model_component_list"].split(";")
        A, H = vec(comps[1]), vec(comps[2])
        hs = float(np.linalg.norm(np.cross(A, H)))
        ext = im["extended"]
        sub = vec(ext["subframeRect"])
        width_px = sub[2]
        hfov = math.degrees(2 * math.atan((width_px / 2) / hs))
        az_q = math.degrees(math.atan2(*qrot(vec(im["attitude"]), vec(cam["camera_vector"]))[[1, 0]])) % 360
        az_m = (w["yaw_deg"] + float(ext["mastAz"])) % 360
        diff = abs((az_q - az_m + 180) % 360 - 180)
        heading_ok = diff <= 10
        out.append({
            "product_id": img_id, "stop": stop, "selection_note": why,
            "camera": cam["instrument"], "sol": im["sol"], "date_utc": im["date_taken_utc"], "lmst": im["date_taken_mars"],
            "credit": cred, "source_page": im["link"], "record_url": API + img_id, "image_url": url,
            "local_file": f"photos/{img_id}.jpg", "caption": im.get("caption"),
            "mission_record": {"site": int(im["site"]), "drive": int(im["drive"]), "rmc": rmc},
            "camera_position": {"lon": w["lon"], "lat": w["lat"], "x": round(x, 2), "y": round(y, 2),
                                "elev_geoid_m": w["elev_geoid_m"], "source": "NASA localized waypoint for this site/drive (rover origin; mast ~2 m above)"},
            "target_position": None, "target_position_note": "Not available: the record has no range to the photographed object.",
            "heading": {"azimuth_deg": round(az_q, 1) if heading_ok else None,
                        "from_attitude_quaternion_deg": round(az_q, 1), "from_yaw_plus_mastAz_deg": round(az_m, 1),
                        "agreement_deg": round(diff, 1), "hfov_deg": round(hfov, 1),
                        "elevation_deg": round(float(ext["mastEl"]), 1),
                        "status": "derived" if heading_ok else "withheld (methods disagree)"},
        })
        print(img_id, stop, rmc, round(az_q, 1), round(az_m, 1), round(hfov, 1))
    write_json(WEB_DATA / "jezero" / "photos.json", {"generated": now_iso(), "photos": out,
                                                    "method": __doc__})


if __name__ == "__main__":
    main()
