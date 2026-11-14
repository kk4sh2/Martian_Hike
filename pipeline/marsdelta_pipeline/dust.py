"""Regional dust context from the LMD/Montabone gridded column dust optical depth (CDOD) climatology.

We extract ONE grid cell per mission area and a dated window around the mission/observation dates.
This is a regional atmospheric-column quantity (9.3 um absorption optical depth); it is NOT a surface
visibility, NOT a landing limit and NOT a forecast.  Empty grid cells stay empty (no interpolation).
"""
from __future__ import annotations

import datetime as dt

import netCDF4 as nc
import numpy as np

from .common import RAW, WEB_DATA, download, write_json, now_iso

BASE = "https://www-mars.lmd.jussieu.fr/mars/dust_climatology/dataset_v2/"
CREDIT = ("Montabone et al. (2015, Icarus 251; 2020, JGR Planets) - LMD Mars dust climatology v2, "
          "CC BY-SA 3.0. Gridded (observation-only) maps.")
MJD0 = dt.datetime(1858, 11, 17)

JOBS = {
    "jezero": {"file": "griddedcdod_MY36_v2-5-1.nc", "lon": 77.405, "lat": 18.4525,
               "start": dt.datetime(2022, 3, 25), "end": dt.datetime(2022, 11, 15),
               "why": "Perseverance delta-front campaign (sols ~400-620, Mars Year 36)"},
    "nili": {"file": "griddedcdod_MY28_v2-0.nc", "lon": 67.324, "lat": 8.78,
             "start": dt.datetime(2007, 6, 1), "end": dt.datetime(2007, 11, 15), "ls_range": (260.0, 335.0),
             "why": "Interval between HiRISE PSP_004339_1890 (2007-06-30) and PSP_005684_1890 (2007-10-13), Mars Year 28"},
}


def main():
    out = {}
    for area, j in JOBS.items():
        p = download(BASE + j["file"], RAW / "dust" / j["file"], key=f"lmd_{j['file']}", credit=CREDIT,
                     product_id=j["file"], purpose=f"regional dust context for {area}")
        d = nc.Dataset(p)
        lons, lats = d["longitude"][:], d["latitude"][:]
        il = int(np.argmin(np.abs(((lons - j["lon"] + 180) % 360) - 180)))
        ia = int(np.argmin(np.abs(lats - j["lat"])))
        dlon = float(np.abs(lons[1] - lons[0])); dlat = float(np.abs(lats[1] - lats[0]))
        if "aveMJD" in d.variables:
            mjd = d["aveMJD"][:]
            t0 = (j["start"] - MJD0).total_seconds() / 86400
            t1 = (j["end"] - MJD0).total_seconds() / 86400
            sel = np.where((mjd >= t0) & (mjd <= t1))[0]
        else:  # older files carry no dates: select by solar longitude from the HiRISE labels
            mjd = None
            ls = d["Ls"][:]
            sel = np.where((ls >= j["ls_range"][0]) & (ls <= j["ls_range"][1]))[0]
        series = []
        for k in sel:
            v = d["cdod610"][k, ia, il]
            u = d["cdod610unc"][k, ia, il]
            n = d["cdodnum"][k, ia, il]
            masked = np.ma.is_masked(v) or not np.isfinite(float(v)) or float(v) < 0
            series.append({
                "utc": None if mjd is None else (MJD0 + dt.timedelta(days=float(mjd[k]))).strftime("%Y-%m-%dT%H:%M"),
                "ls": round(float(d["Ls"][k]), 2), "sol_of_year": int(d["SOY"][k]),
                "cdod610": None if masked else round(float(v), 3),
                "uncertainty": None if (masked or np.ma.is_masked(u) or not np.isfinite(float(u))) else round(float(u), 3),
                "n_obs": None if (np.ma.is_masked(n) or not np.isfinite(float(n))) else int(n),
            })
        valid = [s for s in series if s["cdod610"] is not None]
        out[area] = {
            "label": "Regional climate context (orbital, gridded)", "kind": "regional_context",
            "quantity": "Column dust optical depth, 9.3 um absorption, normalised to 610 Pa", "units": "Pa/Pa (dimensionless)",
            "cell": {"lon_center": float(lons[il]), "lat_center": float(lats[ia]), "dlon_deg": dlon, "dlat_deg": dlat,
                     "lon_min": float(lons[il]) - dlon / 2, "lon_max": float(lons[il]) + dlon / 2,
                     "lat_min": float(lats[ia]) - dlat / 2, "lat_max": float(lats[ia]) + dlat / 2},
            "file": j["file"], "url": BASE + j["file"], "credit": CREDIT, "window_reason": j["why"],
            "time_resolution": "one map per sol (time steps as stored in the file)",
            "n_steps": len(series), "n_with_data": len(valid),
            "caveat": ("Describes the whole atmospheric column over a cell hundreds of km across. It is not astronaut "
                       "visibility, a landing limit or a forecast. Converting it to either would need separate, validated modelling."),
            "series": series,
        }
        print(area, "cell", out[area]["cell"], "steps", len(series), "with data", len(valid))
    write_json(WEB_DATA / "dust_context.json", {"generated": now_iso(), "areas": out})


if __name__ == "__main__":
    main()
