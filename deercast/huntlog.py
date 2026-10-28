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


LOC_FIELDS = ("dir", "dist_yd", "came_from", "went_to", "lat", "lon")


def locate(anchor_lat: float, anchor_lon: float, direction: str | None, dist_yd: float | None):
    """Map position of a sighting from the stand: compass direction + distance."""
    from .scent import destination
    from .weather import CARDINALS

    if not direction or not dist_yd or direction not in CARDINALS:
        return None
    lat, lon = destination(anchor_lat, anchor_lon, CARDINALS.index(direction) * 22.5, float(dist_yd) * 0.9144)
    return round(lat, 6), round(lon, 6)


def where_text(e: dict) -> str:
    bits = []
    if e.get("dist_yd") and e.get("dir"):
        bits.append(f"{int(e['dist_yd'])} yd {e['dir']} of stand")
    elif e.get("dir"):
        bits.append(f"{e['dir']} of stand")
    if e.get("came_from"):
        bits.append(f"came from {e['came_from']}")
    if e.get("went_to"):
        bits.append(f"went {e['went_to']}")
    return " · ".join(bits)


def group_sightings(sightings: list[dict]) -> list[dict]:
    """Merge records entered together (same `group` id) into one display entry, in time order."""
    out, by_group = [], {}
    for i, s in enumerate(sightings):
        g = s.get("group") or f"_{i}"
        if g not in by_group:
            by_group[g] = {"group": g, "time": s["time"], "deer": [], "activity": s.get("activity", ""),
                           "bait": s.get("bait", ""), "notes": s.get("notes", ""), "idx": [],
                           **{k: s.get(k) for k in LOC_FIELDS}}
            out.append(by_group[g])
        by_group[g]["deer"].append((s["kind"], int(s.get("count", 1))))
        by_group[g]["idx"].append(i)
    return sorted(out, key=lambda e: e["time"])


def deer_text(deer: list[tuple[str, int]]) -> str:
    order = {k: i for i, k in enumerate(KINDS)}
    parts = []
    for kind, n in sorted(deer, key=lambda d: order.get(d[0], 9)):
        label = kind if n == 1 or kind == "Unknown" else kind + "s"
        parts.append(f"{n} {label}" if kind != "Unknown" else f"{n} unknown")
    return ", ".join(parts)
