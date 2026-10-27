"""Hunt log helpers: per-hour scoring of a hunt session and forecast validation stats."""

from __future__ import annotations

import math

import numpy as np
import pandas as pd

KINDS = ["Buck", "Doe", "Fawn", "Unknown"]
ACTIVITIES = ["Feeding", "Walking / cruising", "Chasing", "Rubbing / scraping", "Bedded", "Running (spooked)",
              "At bait / feeder", "Other"]


def session_hours(start: pd.Timestamp, end: pd.Timestamp, scored: pd.DataFrame, sightings: list[dict]) -> list[dict]:
    """Split a sit into clock hours with the model score, minutes hunted and deer seen in each."""
    out = []
    t = start.floor("h")
    while t < end:
        a, b = max(start, t), min(end, t + pd.Timedelta(hours=1))
        minutes = (b - a).total_seconds() / 60
        if minutes > 0:
            score = float(scored.loc[t, "score"]) if t in scored.index else math.nan
            seen = sum(int(s.get("count", 1)) for s in sightings
                       if t <= pd.Timestamp(s["time"]).tz_convert(t.tz) < t + pd.Timedelta(hours=1))
            out.append({"hour": t.isoformat(), "score": None if math.isnan(score) else round(score, 1),
                        "minutes": round(minutes), "seen": seen})
        t += pd.Timedelta(hours=1)
    return out


def hours_frame(hunts: list[dict]) -> pd.DataFrame:
    rows = []
    for h in hunts:
        for hr in h.get("hours", []):
            if hr.get("score") is None or hr.get("minutes", 0) < 10:
                continue
            rows.append({"hunt": h["id"], "stand": h.get("stand", ""), "hour": hr["hour"], "score": hr["score"],
                         "minutes": hr["minutes"], "seen": hr["seen"], "date": h.get("date")})
    return pd.DataFrame(rows)


def validation(hunts: list[dict]) -> dict:
    """Deer seen per hour by forecast-score band, plus rank correlation and a simple verdict."""
    df = hours_frame(hunts)
    if df.empty:
        return {"n_hours": 0}
    df["band"] = pd.cut(df["score"], bins=[-0.01, 2, 4, 6, 8, 10], labels=["0–2", "2–4", "4–6", "6–8", "8–10"])
    g = df.groupby("band", observed=False).agg(hours=("minutes", lambda m: m.sum() / 60), seen=("seen", "sum"))
    g["deer_per_hour"] = np.where(g["hours"] > 0, g["seen"] / g["hours"].replace(0, np.nan), np.nan)
    rate = df["seen"] / (df["minutes"] / 60)
    rho = float(df["score"].rank().corr(rate.rank())) if len(df) >= 3 and df["score"].nunique() > 1 else math.nan
    n = len(df)
    if n < 15:
        verdict = f"Only {n} hunted hours logged — keep logging; ~30+ hours (10+ sits) before trusting the trend."
    elif math.isnan(rho):
        verdict = "Not enough variation in scores yet."
    elif rho >= 0.3:
        verdict = "The forecast is tracking your sightings well — higher scores are producing more deer."
    elif rho >= 0.1:
        verdict = "Weak positive relationship — the forecast helps a little. More data will sharpen it."
    elif rho > -0.1:
        verdict = "No clear relationship yet between scores and sightings at your stands."
    else:
        verdict = "Scores are running opposite to your sightings — the model needs tuning for your property."
    return {"n_hours": n, "n_hunts": df["hunt"].nunique(), "bands": g.reset_index(), "rho": rho, "verdict": verdict,
            "frame": df}
