"""Terrain slope + thermal drift: combines wind with time-of-day thermals to estimate where scent goes.

Thermals (hunter rule of thumb, backed by mountain-meteorology basics):
- As the sun warms slopes in the morning, air rises → scent is pulled UPHILL.
- As slopes cool (late afternoon into night), air sinks → scent drains DOWNHILL.
- Around sunrise and an hour or so before sunset the flow switches and is variable/swirly.
Thermal flow is gentle (~0.5–3 mph) — it controls scent in light wind and is overpowered by steady wind.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta

import numpy as np

from . import astro
from .scent import YD, destination

SPACING_M = 40.0  # elevation sample offset for slope at a point


def slope_points(lat: float, lon: float, d_m: float = SPACING_M):
    """Center + N, S, E, W sample points for a finite-difference slope."""
    return [(lat, lon), destination(lat, lon, 0, d_m), destination(lat, lon, 180, d_m),
            destination(lat, lon, 90, d_m), destination(lat, lon, 270, d_m)]


def slope_from(elev5: list[float], d_m: float = SPACING_M) -> tuple[float, float]:
    """(slope in degrees, bearing pointing UPHILL) from [center, N, S, E, W] elevations in meters."""
    _, n, s, e, w = elev5
    gy = (n - s) / (2 * d_m)  # rise per m toward north
    gx = (e - w) / (2 * d_m)  # rise per m toward east
    g = math.hypot(gx, gy)
    slope = math.degrees(math.atan(g))
    up = (math.degrees(math.atan2(gx, gy)) + 360) % 360 if g > 1e-6 else 0.0
    return slope, up


def grid_slopes(elev: np.ndarray, d_m: float) -> tuple[np.ndarray, np.ndarray]:
    """Slope (deg) and uphill bearing for each cell of a north-up elevation grid (row 0 = north)."""
    gy = -np.gradient(elev, d_m, axis=0)  # rows go south → negate for north
    gx = np.gradient(elev, d_m, axis=1)
    g = np.hypot(gx, gy)
    return np.degrees(np.arctan(g)), (np.degrees(np.arctan2(gx, gy)) + 360) % 360


def thermal_phase(lat: float, lon: float, when_utc: datetime) -> tuple[str, float]:
    """('up' | 'down' | 'switching', strength 0–1) from sun altitude and morning/evening."""
    alt = astro.sun_altitude_deg(lat, lon, when_utc)
    rising = astro.sun_altitude_deg(lat, lon, when_utc + timedelta(hours=1)) > alt
    if rising:  # morning
        if alt < 5:
            return "down", 0.8 if alt < 0 else 0.5
        if alt < 15:
            return "switching", 0.0
        return "up", min(1.0, 0.5 + (alt - 15) / 20)
    # afternoon / evening
    if alt > 15:
        return "up", min(1.0, 0.4 + (alt - 15) / 25)
    if alt > 8:
        return "switching", 0.0
    return "down", 1.0 if alt < 0 else 0.6


def thermal_mph(slope_deg: float, strength: float) -> float:
    if slope_deg < 1.5:
        return 0.0
    return strength * min(3.0, 0.45 * slope_deg)


def combine(wind_from_deg: float, wind_mph: float, slope_deg: float, uphill_deg: float, phase: str,
            strength: float) -> dict:
    """Resulting scent drift: bearing it travels TOWARD, speed, and how much thermals matter."""
    to = math.radians((wind_from_deg + 180) % 360)
    vx, vy = wind_mph * math.sin(to), wind_mph * math.cos(to)
    t = thermal_mph(slope_deg, strength) if phase in ("up", "down") else 0.0
    t_dir = uphill_deg if phase == "up" else (uphill_deg + 180) % 360
    if t:
        vx += t * math.sin(math.radians(t_dir))
        vy += t * math.cos(math.radians(t_dir))
    mph = math.hypot(vx, vy)
    bearing = (math.degrees(math.atan2(vx, vy)) + 360) % 360 if mph > 1e-6 else (wind_from_deg + 180) % 360
    influence = t / (t + max(wind_mph, 0.5)) if t else 0.0
    switching = phase == "switching" and slope_deg >= 1.5
    extra_half = 15 * influence + (12 if switching else 0)
    return {"to_bearing": bearing, "mph": mph, "thermal_mph": t, "thermal_to": t_dir if t else None,
            "phase": phase, "slope": slope_deg, "uphill": uphill_deg, "influence": influence,
            "extra_half": extra_half, "switching": switching}


def describe(c: dict) -> str:
    from .weather import deg_to_cardinal

    if c["slope"] < 1.5:
        return "flat ground — wind only"
    if c["switching"]:
        return f"{c['slope']:.0f}° slope, thermals switching — expect swirling scent"
    if not c["thermal_mph"]:
        return f"{c['slope']:.0f}° slope"
    way = "uphill" if c["phase"] == "up" else "downhill"
    pct = c["influence"]
    level = "thermals dominate" if pct > 0.5 else ("thermals bend it" if pct > 0.2 else "wind dominates")
    return (f"{c['slope']:.0f}° slope · thermals pulling {way} to {deg_to_cardinal(c['thermal_to'])} "
            f"({c['thermal_mph']:.1f} mph) — {level}")
