"""Regenerate web/src/lib/model/fixtures.json: the Python model's answers on synthetic weather (no real data)."""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]; sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / "tests"))
import pandas as pd
from synthetic import synthetic_weather
from deercast import astro, beststand, rut, scoring

LAT, LON, TZ = 37.29, -86.04, "America/Chicago"
wx = synthetic_weather(TZ, seed=7)
start = wx.index[24]
peak = scoring.rut_peak_for(start, LAT, None, lon=LON, state="KY")
sc = scoring.score_forecast(wx, LAT, LON, TZ, scoring.Settings(rut_peak=peak), start=start)
cols = ["temp_f", "pressure_inhg", "wind_mph", "wind_dir", "gust_mph", "precip_in", "cloud_pct", "sky_pct"]
rows = [{"time": int(t.timestamp() * 1000), **{c: float(wx.loc[t, c]) for c in cols}} for t in wx.index]
F = ["score", "f_diel", "f_season", "f_temp", "f_pressure", "f_wind", "f_precip", "f_cloud", "f_solunar", "sun_alt"]
out_rows = [{"time": int(t.timestamp() * 1000), "date": str(r.date), "legal": bool(r.legal),
             **{f: float(r[f]) for f in F}} for t, r in sc.iterrows()]
daily = scoring.best_windows(sc)
days = [{"date": str(d), "bestHour": int(r.best_hour.timestamp() * 1000), "bestScore": float(r.best_score)} for d, r in daily.iterrows()]
ast = astro.daily_astro(LAT, LON, sorted(set(sc["date"])), TZ)
astro_days = {str(d): {"sunrise": int(r.sunrise.timestamp() * 1000), "sunset": int(r.sunset.timestamp() * 1000),
                       "illum": float(r.moon_illum), "name": r.moon_name,
                       "majors": sorted(int(t.timestamp() * 1000) for t in r.solunar_major),
                       "minors": sorted(int(t.timestamp() * 1000) for t in r.solunar_minor)} for d, r in ast.iterrows()}
# best stand: made-up stands + hunts
stands = [{"id": "a", "name": "Ridge", "lat": 37.291, "lon": -86.041, "good_winds": ["W", "NW"]},
          {"id": "b", "name": "Creek", "lat": 37.288, "lon": -86.037, "good_winds": ["E"]},
          {"id": "c", "name": "Field", "lat": 37.29, "lon": -86.044, "good_winds": []}]
slopes = {"a": (4.0, 90.0), "b": (0.5, 0.0), "c": (2.0, 200.0)}
hunts = [{"stand": "Stand: Ridge", "hours": [{"hour": "2026-10-27T16:00:00-05:00", "minutes": 60, "seen": 3},
                                             {"hour": "2026-10-27T17:00:00-05:00", "minutes": 45, "seen": 1}]},
         {"stand": "Stand: Creek", "hours": [{"hour": "2026-10-28T07:00:00-05:00", "minutes": 60, "seen": 0}]}]
day2 = sorted(set(sc["date"]))[2]
best = {s: [{"id": r["stand"]["id"], "score": r["score"], "fit": r["fit"], "history": r["history"], "reasons": r["reasons"]}
            for r in beststand.rank(stands, sc[sc["date"] == day2], s, hunts, slopes)] for s in ("Morning", "Evening")}
ruts = [[st, la, lo, list(rut.peak_for(st, la, lo).__dict__.values())[:2]] for st, la, lo in
        [("KY", 37.3, -86), ("TX", 28, -99), ("TX", 32, -96), ("AL", 34, -87), ("AL", 32, -87), ("MS", 31, -89),
         ("GA", 31, -84.5), ("FL", 26, -81), ("LA", 30.5, -90.5), ("OH", 40, -83), ("ZZ", 41, -100), ("ZZ", 30, -90)]]
peaks = [[d, st, scoring.rut_peak_for(pd.Timestamp(d), 37.3, None, lon=-86, state=st).isoformat()] for d, st in
         [("2026-11-04", "KY"), ("2027-01-10", "KY"), ("2026-12-20", "AL"), ("2027-01-03", "AL")]]
Path(ROOT / "web/src/lib/model/fixtures.json").write_text(json.dumps({
    "lat": LAT, "lon": LON, "tz": TZ, "start": int(start.timestamp() * 1000), "rutPeak": peak.isoformat(),
    "rows": rows, "scored": out_rows, "days": days, "astro": astro_days, "stands": stands,
    "slopes": slopes, "hunts": hunts, "day2": str(day2), "best": best, "ruts": ruts, "peaks": peaks}))
print("ok", len(out_rows), "hours", peak)
