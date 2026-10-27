"""Deer activity model.

Hourly score 0-10 built from multiplicative factors:

    raw = diel(time of day, rut, moon) x season(day of year vs. rut peak)
          x temperature x pressure x wind x precipitation x cloud x solunar
    score = 10 * clip(raw / SCALE, 0, 1)

Every factor is ~1.0 under "ordinary" conditions, so an ordinary peak-rut
sunrise lands near 8 and a cold, rising-pressure, calm rut morning reaches 10.
All tunable constants live in MODEL so they can be adjusted as we learn.
See docs/MODEL.md for the reasoning and evidence behind each factor.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date

import numpy as np
import pandas as pd

from . import astro

MODEL = {
    "scale": 1.25,
    # Diel curve
    "dawn_offset_min": -10,  # activity peak relative to sunrise
    "dusk_offset_min": 15,  # activity peak relative to sunset
    "peak_sigma_min": 70,  # width of dawn/dusk peaks
    "peak_height": 0.82,
    "midday_base": 0.18,
    "night_base": 0.40,
    "rut_midday_boost": 0.20,  # extra midday movement while bucks are seeking/chasing
    # Moon (daily phase) — modest weights; evidence is mixed
    "full_moon_dawn_penalty": 0.08,
    "full_moon_midday_boost": 0.10,
    "new_moon_twilight_boost": 0.05,
    # Solunar
    "solunar_major_boost": 0.06,
    "solunar_major_window_min": 60,
    "solunar_minor_boost": 0.03,
    "solunar_minor_window_min": 30,
}

# Season curve: knots of (days relative to peak breeding date, factor 0-1)
SEASON_KNOTS = [
    (-75, 0.72),  # early season, bucks still patterned on food
    (-50, 0.66),
    (-35, 0.60),  # October lull
    (-24, 0.62),
    (-16, 0.80),  # pre-rut: scraping, rubbing
    (-8, 1.00),  # seeking / chasing — best daylight buck movement
    (-2, 0.97),
    (4, 0.85),  # peak breeding / lockdown
    (12, 0.72),  # post-rut
    (22, 0.74),
    (28, 0.80),  # second rut (unbred does, doe fawns)
    (36, 0.74),
    (60, 0.76),  # late season, food-driven
    (100, 0.70),
]

# Hot-weather thresholds (°F) by month — above these, daylight movement drops.
HOT_THRESHOLD_F = {1: 55, 2: 58, 3: 62, 4: 70, 5: 75, 6: 80, 7: 82, 8: 82, 9: 78, 10: 70, 11: 60, 12: 55}


def default_rut_peak(lat: float, year: int) -> date:
    """Approximate peak breeding date from latitude.

    Rough Midwest/Northern pattern. Southern states (esp. AL, MS, LA, FL, GA, SC)
    vary widely and can peak Dec-Jan — users should override with their state
    agency's date.
    """
    if lat >= 40:
        return date(year, 11, 10)
    if lat >= 36:
        return date(year, 11, 14)
    if lat >= 33:
        return date(year, 11, 22)
    return date(year, 12, 15)


@dataclass
class Settings:
    rut_peak: date
    legal_minutes_before_sunrise: int = 30
    legal_minutes_after_sunset: int = 30
    model: dict = field(default_factory=lambda: dict(MODEL))


# ---------------------------------------------------------------- factors


def season_factor(days_from_peak: np.ndarray) -> np.ndarray:
    xs, ys = zip(*SEASON_KNOTS)
    d = np.asarray(days_from_peak, dtype=float)
    # wrap: treat far-off dates as late/early season
    return np.interp(d, xs, ys, left=ys[0], right=ys[-1])


def rut_intensity(days_from_peak: np.ndarray) -> np.ndarray:
    """0-1, peaks during seeking/chasing (~6 days before peak breeding)."""
    d = np.asarray(days_from_peak, dtype=float)
    return np.clip(1 - np.abs(d + 6) / 12, 0, 1)


def temperature_factor(temp_f, dtemp_24h, month) -> np.ndarray:
    temp_f = np.asarray(temp_f, dtype=float)
    hot = np.array([HOT_THRESHOLD_F[int(m)] for m in month])
    heat = np.clip(1 - 0.03 * np.clip(temp_f - hot, 0, None), 0.55, 1.0)
    trend = np.clip(1 - 0.015 * np.nan_to_num(dtemp_24h), 0.85, 1.25)
    return heat * trend


def pressure_factor(p_inhg, tendency_3h) -> np.ndarray:
    p = np.asarray(p_inhg, dtype=float)
    t = np.nan_to_num(np.asarray(tendency_3h, dtype=float))
    level = np.where(p >= 30.0, 1.04, np.where(p >= 29.8, 1.0, 0.92))
    level = np.where(p > 30.45, 1.0, level)
    tend = np.where(t >= 0.03, 1.08, np.where(t <= -0.06, 1.04, np.where(t <= -0.02, 0.97, 1.0)))
    return level * tend


def wind_factor(wind_mph, gust_mph) -> np.ndarray:
    w = np.asarray(wind_mph, dtype=float)
    f = np.interp(w, [0, 3, 10, 15, 20, 30], [0.97, 1.0, 1.0, 0.88, 0.74, 0.6])
    g = np.where(np.nan_to_num(np.asarray(gust_mph, dtype=float)) > 25, 0.9, 1.0)
    return f * g


def precip_factor(precip_in, rain_prev_6h) -> np.ndarray:
    p = np.nan_to_num(np.asarray(precip_in, dtype=float))
    prev = np.nan_to_num(np.asarray(rain_prev_6h, dtype=float))
    f = np.where(p < 0.02, 1.0, np.where(p < 0.10, 0.85, 0.65))
    clearing = (p < 0.01) & (prev >= 0.05)
    return np.where(clearing, 1.12, f)


def cloud_factor(cloud_pct, daylight) -> np.ndarray:
    c = np.nan_to_num(np.asarray(cloud_pct, dtype=float))
    return np.where(np.asarray(daylight) & (c >= 70), 1.04, 1.0)


def _gauss(x_min, sigma):
    return np.exp(-0.5 * (np.asarray(x_min, dtype=float) / sigma) ** 2)


# ---------------------------------------------------------------- main


def score_forecast(weather: pd.DataFrame, lat: float, lon: float, tz: str, settings: Settings) -> pd.DataFrame:
    """Add feature, factor and score columns to an hourly weather frame.

    `weather` must include the prior 24h (for trends); output starts at local
    midnight today.
    """
    M = settings.model
    df = weather.copy().sort_index()

    # trends (hourly rows, unix-time based so DST-safe)
    df["dtemp_24h"] = df["temp_f"] - df["temp_f"].shift(24)
    df["p_tend_3h"] = df["pressure_inhg"] - df["pressure_inhg"].shift(3)
    df["rain_prev_6h"] = df["precip_in"].shift(1).rolling(6, min_periods=1).sum()

    local_dates = sorted({ts.date() for ts in df.index})
    ast = astro.daily_astro(lat, lon, local_dates, tz)
    df["date"] = [ts.date() for ts in df.index]

    sr = df["date"].map(ast["sunrise"])
    ss = df["date"].map(ast["sunset"])
    idx = df.index.to_series()
    df["min_from_sunrise"] = (idx - pd.to_datetime(sr)).dt.total_seconds() / 60
    df["min_from_sunset"] = (idx - pd.to_datetime(ss)).dt.total_seconds() / 60
    # treat each hourly value as representative of the half-hour mark
    mid = idx + pd.Timedelta(minutes=30)
    df["sun_alt"] = [astro.sun_altitude_deg(lat, lon, t.tz_convert("UTC").to_pydatetime()) for t in mid]
    df["daylight"] = df["sun_alt"] > 0
    df["legal"] = (df["min_from_sunrise"] + 60 >= -settings.legal_minutes_before_sunrise) & (
        df["min_from_sunset"] <= settings.legal_minutes_after_sunset
    )

    # season
    peak = pd.Timestamp(settings.rut_peak)
    days_from_peak = np.array([(pd.Timestamp(d) - peak).days for d in df["date"]])
    df["days_from_rut_peak"] = days_from_peak
    df["f_season"] = season_factor(days_from_peak)
    rut = rut_intensity(days_from_peak)

    # moon (daily phase)
    illum = df["date"].map(ast["moon_illum"]).to_numpy(dtype=float)
    df["moon_illum"] = illum

    # diel curve, shifted by moon phase
    off_mid = 30  # hourly bucket midpoint
    dawn = _gauss(df["min_from_sunrise"] + off_mid - M["dawn_offset_min"], M["peak_sigma_min"])
    dusk = _gauss(df["min_from_sunset"] + off_mid - M["dusk_offset_min"], M["peak_sigma_min"])
    dark = np.clip((6 - df["sun_alt"].to_numpy()) / 12, 0, 1)  # 0 at alt>=6°, 1 at alt<=-6°
    base = M["midday_base"] + rut * M["rut_midday_boost"] * (1 - dark)
    base = base + (M["night_base"] - base) * dark

    full = np.clip((illum - 0.6) / 0.4, 0, 1)
    new = np.clip((0.25 - illum) / 0.25, 0, 1)
    dawn_w = 1 - M["full_moon_dawn_penalty"] * full + M["new_moon_twilight_boost"] * new
    dusk_w = 1 + M["new_moon_twilight_boost"] * new
    midday_w = 1 + M["full_moon_midday_boost"] * full * (1 - dark)
    peak_term = M["peak_height"] * np.maximum(dawn * dawn_w, dusk * dusk_w)
    df["f_diel"] = np.minimum(1.0, base * midday_w + peak_term)

    # solunar
    def solunar(row_time, events, window):
        if not events:
            return 0.0
        mins = min(abs((row_time + pd.Timedelta(minutes=30) - e).total_seconds()) / 60 for e in events)
        return max(0.0, 1 - mins / window)

    maj = df["date"].map(ast["solunar_major"])
    mnr = df["date"].map(ast["solunar_minor"])
    sol = [
        1
        + M["solunar_major_boost"] * solunar(t, a, M["solunar_major_window_min"])
        + M["solunar_minor_boost"] * solunar(t, b, M["solunar_minor_window_min"])
        for t, a, b in zip(df.index, maj, mnr)
    ]
    df["f_solunar"] = sol

    # weather
    df["f_temp"] = temperature_factor(df["temp_f"], df["dtemp_24h"], df.index.month)
    df["f_pressure"] = pressure_factor(df["pressure_inhg"], df["p_tend_3h"])
    df["f_wind"] = wind_factor(df["wind_mph"], df["gust_mph"])
    df["f_precip"] = precip_factor(df["precip_in"], df["rain_prev_6h"])
    df["f_cloud"] = cloud_factor(df["cloud_pct"], df["daylight"])
    df["f_weather"] = df[["f_temp", "f_pressure", "f_wind", "f_precip", "f_cloud"]].prod(axis=1)

    raw = df["f_diel"] * df["f_season"] * df["f_weather"] * df["f_solunar"]
    df["score"] = np.clip(10 * raw / M["scale"], 0, 10).round(1)

    # attach daily astro for display
    for col in ["sunrise", "sunset", "moon_name", "moon_emoji"]:
        df[col] = df["date"].map(ast[col])

    today = pd.Timestamp.now(tz=tz).normalize()
    df = df[df.index >= today]
    # forecast confidence by lead day
    lead = np.array([(pd.Timestamp(d) - today.tz_localize(None)).days for d in df["date"]])
    df["confidence"] = np.where(lead <= 2, "High", np.where(lead <= 6, "Medium", "Low"))
    return df


def best_windows(scored: pd.DataFrame, legal_only: bool = True) -> pd.DataFrame:
    """Best hour per day plus a daily summary."""
    s = scored[scored["legal"]] if legal_only else scored
    rows = []
    for d, g in s.groupby("date"):
        top = g["score"].idxmax()
        rows.append(
            {
                "date": d,
                "best_hour": top,
                "best_score": g.loc[top, "score"],
                "am_score": g[g.index.hour < 12]["score"].max() if (g.index.hour < 12).any() else math.nan,
                "pm_score": g[g.index.hour >= 12]["score"].max() if (g.index.hour >= 12).any() else math.nan,
                "avg_daylight": g["score"].mean(),
                "hi": scored[scored["date"] == d]["temp_f"].max(),
                "lo": scored[scored["date"] == d]["temp_f"].min(),
                "moon": f"{g['moon_emoji'].iloc[0]} {g['moon_name'].iloc[0]}",
                "confidence": g["confidence"].iloc[0],
            }
        )
    return pd.DataFrame(rows).set_index("date")
