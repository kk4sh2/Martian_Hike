"""Perseverance MEDA: parse PDS4 CSV products + XML labels placed in data/raw/meda/.

The archive (https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html)
could not be reached from the build machine; place the CSV + .xml pairs there (any sol in the corridor window)
and re-run `python -m marsdelta_pipeline meda`.  Without files, a status record saying so is written and the
app shows "No MEDA observation packaged" - never substitute values.

Parsing rules
  * Field names, units and missing-value constants come from the label (Field_Delimited / Special_Constants).
  * Rows whose value equals a missing constant, is empty, or is NaN become null.
  * Gaps: consecutive samples farther apart than 5x the median cadence are listed explicitly.
  * Station position: the rover's localized position for that sol from NASA's waypoint file (last final
    waypoint on or before the sol), converted to local coordinates.
"""
from __future__ import annotations

import csv
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from pyproj import Transformer

from .common import RAW, WEB_DATA, write_json, sha256, now_iso, record_source, local_proj4, ROOT

D = RAW / "meda"
UPLOADS = Path("/mnt/project-files/uploads/hearth")
ARCHIVE = "https://pds-atmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html"

QUANT = {  # regex on field name -> (quantity key, label)
    r"^PRESSURE$|^P$|PRESSURE": ("pressure_pa", "Atmospheric pressure"),
    r"ATS.*TEMP|AIR.?TEMP|^ATS_LOCAL_TEMP|TEMPERATURE": ("air_temp_k", "Air temperature"),
    r"HORIZONTAL_WIND_SPEED|WIND_SPEED|^WS$": ("wind_ms", "Horizontal wind speed"),
}


def strip_ns(root):
    for el in root.iter():
        if "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]
    return root


def parse_label(xml_path: Path) -> dict:
    root = strip_ns(ET.parse(xml_path).getroot())
    fields = []
    for f in root.iter("Field_Delimited"):
        sc = f.find("Special_Constants")
        missing = [c.text.strip() for c in sc] if sc is not None else []
        fields.append({"name": (f.findtext("name") or "").strip(), "unit": (f.findtext("unit") or "").strip(),
                       "type": (f.findtext("data_type") or "").strip(), "missing": missing,
                       "description": (f.findtext("description") or "").strip()[:200]})
    title = root.findtext(".//Identification_Area/title") or ""
    lid = root.findtext(".//Identification_Area/logical_identifier") or ""
    skip = root.findtext(".//Table_Delimited/offset")
    hdr = root.findtext(".//Table_Delimited/records")
    return {"title": title.strip(), "lid": lid.strip(), "fields": fields, "file": root.findtext(".//File/file_name"),
            "records": hdr}


def lmst_minutes(s: str) -> float | None:
    m = re.search(r"(\d+):(\d+):(\d+(?:\.\d+)?)", s or "")
    return int(m.group(1)) * 60 + int(m.group(2)) + float(m.group(3)) / 60 if m else None


def station_for_sol(sol: int):
    wp = json.loads((RAW / "jezero" / "M20_waypoints.json").read_text())
    best = None
    for f in wp["features"]:
        p = f["properties"]
        if p.get("final") == "y" and p["sol"] <= sol and (best is None or p["sol"] >= best["sol"]):
            best = p
    return best


def main():
    D.mkdir(parents=True, exist_ok=True)
    # pick up files the user dropped into the project uploads (named by id, no extension): sniff content
    if UPLOADS.exists():
        for f in UPLOADS.iterdir():
            try:
                head = f.read_bytes()[:400]
            except Exception:
                continue
            if b"<Product_Observational" in head or b"<?xml" in head and b"pds" in head.lower():
                lab = parse_label(f)
                name = lab["file"] or f.name + ".xml"
                (D / (Path(name).stem + ".xml")).write_bytes(f.read_bytes())
            elif head[:1].isalpha() and b"," in head and (b"SCLK" in head.upper() or b"LMST" in head.upper()):
                # CSV: name assigned after we see its label's file_name; keep under its id meanwhile
                (D / (f.name + ".csv")).write_bytes(f.read_bytes())
    pairs = []
    for xml in sorted(D.glob("*.xml")):
        lab = parse_label(xml)
        csvp = D / (lab["file"] or "")
        if not csvp.exists():
            # match an uploaded csv by header field names
            for c in D.glob("*.csv"):
                with open(c, newline="") as fh:
                    hdr = next(csv.reader(fh))
                if [h.strip() for h in hdr][:3] == [f["name"] for f in lab["fields"]][:3]:
                    csvp = c
                    break
        if csvp.exists():
            pairs.append((xml, csvp, lab))
    out = {"generated": now_iso(), "archive": ARCHIVE}
    if not pairs:
        out.update({"status": "unavailable",
                    "reason": ("The PDS Atmospheres MEDA archive could not be reached from the build machine (TLS failure through the "
                               "network proxy). No MEDA CSV/label pair is in data/raw/meda/, so no surface weather is packaged.")})
        write_json(WEB_DATA / "jezero" / "meda.json", out)
        print("MEDA: no files; wrote unavailable status")
        return out
    to_local = Transformer.from_crs("+proj=longlat +R=3396190 +no_defs", local_proj4("jezero"), always_xy=True)
    sols = {}
    products = []
    for xml, csvp, lab in pairs:
        fields = {f["name"]: f for f in lab["fields"]}
        rows = list(csv.DictReader(open(csvp, newline="")))
        rows = [{k.strip(): (v.strip() if isinstance(v, str) else v) for k, v in r.items()} for r in rows]
        names = list(rows[0].keys()) if rows else []
        lmst_key = next((n for n in names if "LMST" in n.upper()), None)
        utc_key = next((n for n in names if "UTC" in n.upper() or n.upper() in ("SCET", "TIME")), None)
        qmap = {}
        for n in names:
            for rx, (k, lbl) in QUANT.items():
                if k not in qmap.values() and re.search(rx, n.upper()) and "UNCERT" not in n.upper() and "FLAG" not in n.upper():
                    qmap[n] = k
        sol_m = re.search(r"_(\d{4})_", csvp.name) or re.search(r"(\d{4})", csvp.name)
        sol = int(sol_m.group(1)) if sol_m else None
        for n, k in qmap.items():
            products.append({"file": csvp.name, "label": xml.name, "sha256": sha256(csvp), "quantity": QUANT_LABEL(k),
                             "field": n, "units": fields.get(n, {}).get("unit", ""), "missing_constants": fields.get(n, {}).get("missing", [])})
            record_source(f"meda_{csvp.name}", local_path=str(csvp.relative_to(ROOT)), sha256=sha256(csvp), label=xml.name,
                          credit="NASA/JPL-Caltech/CAB (MEDA team); PDS Atmospheres Node", url=ARCHIVE, retrieved=now_iso(),
                          purpose="Perseverance MEDA historical observation")
        S = sols.setdefault(sol, {"sol": sol, "samples": {}})
        for r in rows:
            lm = r.get(lmst_key, "") if lmst_key else ""
            key = lm or r.get(utc_key, "")
            smp = S["samples"].setdefault(key, {"lmst": re.sub(r"^.*?M?(\d+:\d+:\d+).*$", r"\1", lm) if lm else "", "utc": r.get(utc_key) if utc_key else None})
            for n, k in qmap.items():
                v = r.get(n, "")
                miss = fields.get(n, {}).get("missing", [])
                try:
                    fv = float(v)
                    ok = v not in miss and np.isfinite(fv) and not any(_eqf(fv, m) for m in miss)
                except ValueError:
                    ok = False
                smp[k] = fv if ok else None
    out_sols = []
    for sol, S in sorted(sols.items(), key=lambda kv: (kv[0] is None, kv[0])):
        smps = sorted(S["samples"].values(), key=lambda s: lmst_minutes(s["lmst"]) or 0)
        # thin to 1 sample per minute for the browser (mean of valid values within the minute)
        by_min = {}
        for s in smps:
            m = lmst_minutes(s["lmst"])
            if m is None:
                continue
            by_min.setdefault(int(m), []).append(s)
        thin = []
        for m in sorted(by_min):
            grp = by_min[m]
            rec = {"lmst": f"{m // 60:02d}:{m % 60:02d}", "utc": grp[0].get("utc")}
            for k in ("pressure_pa", "air_temp_k", "wind_ms"):
                vals = [g.get(k) for g in grp if g.get(k) is not None]
                rec[k] = round(float(np.mean(vals)), 3) if vals else None
            thin.append(rec)
        mins = sorted(by_min)
        gaps = []
        if len(mins) > 2:
            cad = float(np.median(np.diff(mins)))
            for a, b in zip(mins[:-1], mins[1:]):
                if b - a > max(5 * cad, 5):
                    gaps.append({"from_lmst": f"{a // 60:02d}:{a % 60:02d}", "to_lmst": f"{b // 60:02d}:{b % 60:02d}", "minutes": int(b - a)})
        st = station_for_sol(sol) if sol else None
        xy = to_local.transform(st["lon"], st["lat"]) if st else None
        out_sols.append({"sol": sol, "samples": thin, "gaps": gaps,
                         "station_xy": [round(xy[0], 1), round(xy[1], 1)] if xy else None,
                         "station_lonlat": [st["lon"], st["lat"]] if st else None,
                         "site_drive": st["RMC"] if st else None,
                         "station_note": (f"Rover localized at RMC {st['RMC']} (sol {st['sol']}), the last localization on or before sol {sol}." if st else "unknown")})
    out.update({"status": "available", "instrument": "Perseverance MEDA (Mars Environmental Dynamics Analyzer)",
                "products": products, "sols": out_sols})
    write_json(WEB_DATA / "jezero" / "meda.json", out)
    print("MEDA:", [(s["sol"], len(s["samples"]), len(s["gaps"])) for s in out_sols])
    return out


def QUANT_LABEL(k):
    return {"pressure_pa": "Atmospheric pressure", "air_temp_k": "Air temperature", "wind_ms": "Horizontal wind speed"}[k]


def _eqf(v, m):
    try:
        return abs(v - float(m)) < 1e-9
    except ValueError:
        return False


if __name__ == "__main__":
    main()


FEED_URL = "https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json"


def daily_feed():
    """NASA's published MEDA daily summaries (the feed behind mars.nasa.gov/mars2020/weather).

    The feed only carries the most recent sols. We snapshot what it returns at build time, keep '--' as an explicit
    gap, and place the station at the rover's localization for that sol. Values are never filled in or interpolated.
    """
    from .common import download
    dest = RAW / "meda" / "m20_weather_feed.json"
    download(FEED_URL, dest, key="mars2020_weather_feed", credit="NASA/JPL-Caltech/CAB(CSIC-INTA)",
             product_id="Mars 2020 MEDA daily weather summary feed",
             purpose="Jezero surface weather: MEDA daily min/max air temperature, pressure, sunrise/sunset")
    feed = json.loads(dest.read_text())
    tf = Transformer.from_crs("+proj=longlat +R=3396190 +no_defs", local_proj4("jezero"), always_xy=True)
    num = lambda v: None if v in (None, "--", "") else float(v)
    sols = []
    for s in sorted(feed.get("sols", []), key=lambda q: int(q["sol"])):
        st = station_for_sol(int(s["sol"]))
        xy = list(tf.transform(st["lon"], st["lat"])) if st else None
        sols.append({
            "sol": int(s["sol"]), "earth_date": s["terrestrial_date"], "ls_deg": num(s.get("ls")), "season": s.get("season"),
            "min_air_temp_c": num(s.get("min_temp")), "max_air_temp_c": num(s.get("max_temp")), "pressure_pa": num(s.get("pressure")),
            "sunrise_lmst": s.get("sunrise"), "sunset_lmst": s.get("sunset"),
            "station": None if not st else {"sol_of_fix": st["sol"], "rmc": st["RMC"], "lon": st["lon"], "lat": st["lat"], "x": round(xy[0], 1), "y": round(xy[1], 1)},
        })
    out = {"schema": "marsdelta.meda_daily.v1", "source": FEED_URL, "retrieved": now_iso(), "sha256": sha256(dest),
           "instrument": "MEDA (Mars Environmental Dynamics Analyzer), Perseverance rover",
           "note": "Daily summary values as published by NASA. '--' in the feed is kept as missing. Archived measurements, not a forecast.",
           "sols": sols}
    write_json(WEB_DATA / "jezero" / "meda_daily.json", out)
    print(f"meda daily: {len(sols)} sols {sols[0]['sol'] if sols else '-'}-{sols[-1]['sol'] if sols else '-'}")
