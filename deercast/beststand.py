"""Rank stands for a day's morning and evening sits: forecast activity × scent fit (wind + thermals) × history."""

from __future__ import annotations

from datetime import timezone

import pandas as pd

from . import terrain
from .scent import angle_diff

DIRS = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315}
AM_END_HOUR, PM_START_HOUR = 11, 14


def session_hours(day_df: pd.DataFrame, session: str) -> pd.DataFrame:
    legal = day_df[day_df["legal"]]
    if session == "Morning":
        return legal[legal.index.hour < AM_END_HOUR]
    return legal[legal.index.hour >= PM_START_HOUR]


def scent_ok(stand: dict, wind_from: float, drift_to: float | None) -> bool | None:
    """Is scent going where this stand needs it to? Good wind 'N' = wind from N = scent heading S."""
    goods = [DIRS[g] for g in stand.get("good_winds", []) if g in DIRS]
    if not goods:
        return None
    if drift_to is None:
        return any(angle_diff(wind_from, g) <= 22.5 for g in goods)
    return any(angle_diff(drift_to, (g + 180) % 360) <= 30 for g in goods)


def history_rates(hunts: list[dict], stand_label: str, session: str) -> tuple[float, float]:
    """(deer seen, hours hunted) at a stand for morning or evening sits."""
    seen = hours = 0.0
    for h in hunts:
        if h.get("stand") != stand_label:
            continue
        for hr in h.get("hours", []):
            t = pd.Timestamp(hr["hour"])
            is_am = t.hour < 12
            if (session == "Morning") != is_am:
                continue
            hours += hr.get("minutes", 0) / 60
            seen += hr.get("seen", 0)
    return seen, hours


def rank(stands: list[dict], day_df: pd.DataFrame, session: str, hunts: list[dict],
         slopes: dict[str, tuple[float, float]] | None = None) -> list[dict]:
    """List of {stand, score, activity, fit, fit_hours, n_hours, history, reasons} sorted best first."""
    hrs = session_hours(day_df, session)
    if hrs.empty or not stands:
        return []
    # pooled history prior: average deer/hour across all stands (or 0.5)
    tot_seen = tot_hours = 0.0
    for s in stands:
        a, b = history_rates(hunts, f"Stand: {s['name']}", session)
        tot_seen, tot_hours = tot_seen + a, tot_hours + b
    K = 4.0  # prior weight in hours
    # baseline = pooled rate across your stands, shrunk toward ~1 deer/hour so one stand's data can stand out
    prior = (tot_seen + 1.0 * K) / (tot_hours + K)

    out = []
    for s in stands:
        slope, up = (slopes or {}).get(s["id"], (0.0, 0.0))
        oks, notes = [], []
        for t, r in hrs.iterrows():
            phase, strength = terrain.thermal_phase(s["lat"], s["lon"], t.tz_convert(timezone.utc).to_pydatetime())
            d = terrain.combine(float(r.wind_dir), float(r.wind_mph), slope, up, phase, strength)
            drift_to = d["to_bearing"] if slope >= 1.5 else None
            oks.append(scent_ok(s, float(r.wind_dir), drift_to))
            if d["influence"] > 0.35 and d["thermal_to"] is not None:
                notes.append(("downhill" if phase == "down" else "uphill", d["thermal_to"]))
        known = [o for o in oks if o is not None]
        fit = (sum(known) / len(known)) if known else 0.5
        top = hrs["score"].nlargest(min(3, len(hrs))).mean()
        seen, hours = history_rates(hunts, f"Stand: {s['name']}", session)
        rate = (seen + prior * K) / (hours + K)
        hist = max(0.7, min(1.4, rate / prior)) if prior > 0 else 1.0
        score = top * (0.35 + 0.65 * fit) * hist

        reasons = []
        if known:
            reasons.append(f"scent fits {sum(known)}/{len(known)} legal hours")
        else:
            reasons.append("no good winds set for this stand")
        if notes:
            from .weather import deg_to_cardinal

            way, to = notes[len(notes) // 2]
            reasons.append(f"thermals pull scent {way} to {deg_to_cardinal(to)}")
        if hours >= 1:
            reasons.append(f"{seen:.0f} deer in {hours:.1f} logged {session.lower()} hours")
        out.append({"stand": s, "score": score, "activity": top, "fit": fit, "fit_hours": sum(known),
                    "n_hours": len(known), "history": hist, "reasons": reasons})
    return sorted(out, key=lambda x: -x["score"])
