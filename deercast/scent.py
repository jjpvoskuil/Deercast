"""Scent-drift geometry: downwind cones from a point given wind speed/direction."""

from __future__ import annotations

import math

EARTH_R = 6_371_000.0
YD = 0.9144


def destination(lat: float, lon: float, bearing_deg: float, dist_m: float) -> tuple[float, float]:
    """Point reached travelling dist_m along bearing (great-circle)."""
    br = math.radians(bearing_deg)
    p1, l1 = math.radians(lat), math.radians(lon)
    d = dist_m / EARTH_R
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(br))
    l2 = l1 + math.atan2(math.sin(br) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return math.degrees(p2), (math.degrees(l2) + 540) % 360 - 180


def cone_params(wind_mph: float) -> tuple[float, float]:
    """(length in yards, half-angle in degrees).

    Light, variable wind → short, wide, swirling cone. Steady wind → long,
    narrow cone. These are visual planning aids, not a dispersion model.
    """
    length_yd = max(150.0, min(150.0 + 30.0 * wind_mph, 700.0))
    if wind_mph < 4:
        half = 40.0
    elif wind_mph < 10:
        half = 25.0
    else:
        half = 17.0
    return length_yd, half


def scent_cone(lat: float, lon: float, wind_from_deg: float, wind_mph: float, frac: float = 1.0, steps: int = 16):
    """Polygon [(lat, lon), ...] for the downwind scent cone.

    wind_from_deg is meteorological (direction wind blows FROM); scent travels
    toward wind_from + 180.
    """
    length_yd, half = cone_params(wind_mph)
    dist = length_yd * YD * frac
    downwind = (wind_from_deg + 180) % 360
    pts = [(lat, lon)]
    for i in range(steps + 1):
        b = downwind - half + 2 * half * i / steps
        pts.append(destination(lat, lon, b, dist))
    pts.append((lat, lon))
    return pts


def angle_diff(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def wind_ok_for_stand(wind_from_deg: float, good_winds: list[str]) -> bool | None:
    """True if current wind is within ±22.5° of any of the stand's good wind directions."""
    if not good_winds:
        return None
    dirs = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315}
    return any(angle_diff(wind_from_deg, dirs[w]) <= 22.5 for w in good_winds if w in dirs)
