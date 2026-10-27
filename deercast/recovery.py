"""Recovery search map: where a hit deer is likely to be, from shot outcome + run direction + terrain."""

from __future__ import annotations

import math

import numpy as np
import requests

from .scent import destination

YD = 0.9144
ELEV_URL = "https://api.open-meteo.com/v1/elevation"


def fetch_elevations(points: list[tuple[float, float]]) -> list[float] | None:
    """Elevation (m) for up to 100 points per request (Open-Meteo, free)."""
    out = []
    try:
        for i in range(0, len(points), 100):
            chunk = points[i:i + 100]
            r = requests.get(
                ELEV_URL,
                params={"latitude": ",".join(f"{p[0]:.5f}" for p in chunk),
                        "longitude": ",".join(f"{p[1]:.5f}" for p in chunk)},
                timeout=10,
            )
            r.raise_for_status()
            out += r.json()["elevation"]
        return out
    except Exception:
        return None


def search_grid(lat: float, lon: float, yards: tuple, run_dir: float | None, rings: int = 8, sectors: int = 12):
    """Polar grid of cells around the shot. Returns list of dicts with polygon + center + distance + bearing."""
    lo, med, hi = yards
    r_max = max(hi * 1.15, 60)
    if run_dir is None:
        bearings = np.linspace(0, 360, sectors + 1)
    else:
        bearings = np.linspace(run_dir - 100, run_dir + 100, sectors + 1)
    radii = np.linspace(0, r_max, rings + 1)
    cells = []
    for i in range(rings):
        for j in range(sectors):
            r0, r1 = radii[i], radii[i + 1]
            b0, b1 = bearings[j], bearings[j + 1]
            arc = np.linspace(b0, b1, 5)
            poly = [destination(lat, lon, b, r1 * YD) for b in arc] + \
                   [destination(lat, lon, b, max(r0, 0.5) * YD) for b in arc[::-1]]
            rc, bc = (r0 + r1) / 2, (b0 + b1) / 2
            cells.append({"poly": poly, "center": destination(lat, lon, bc, rc * YD), "dist_yd": rc,
                          "bearing": bc % 360})
    return cells


def weight_cells(cells, yards: tuple, run_dir: float | None, elev: list[float] | None, shot_elev: float | None,
                 downhill_bias: float):
    """Probability weights: distance (log-normal from outcome range) × direction × downhill tendency."""
    lo, med, hi = yards
    med = max(med, 10)
    sigma = max(0.35, math.log(max(hi, med + 1) / med) / 1.28)  # hi ≈ 90th percentile
    w = []
    for k, c in enumerate(cells):
        d = max(c["dist_yd"], 1)
        p = math.exp(-((math.log(d) - math.log(med)) ** 2) / (2 * sigma ** 2)) / d
        if run_dir is not None:
            dev = math.radians(((c["bearing"] - run_dir + 180) % 360) - 180)
            p *= math.exp(2.2 * (math.cos(dev) - 1))  # von Mises, ~±40° spread
        if elev is not None and shot_elev is not None and downhill_bias > 0:
            drop_m = shot_elev - elev[k]  # positive = downhill of the shot
            p *= math.exp(downhill_bias * max(-3, min(3, drop_m / 8)))
        w.append(p)
    w = np.array(w)
    return w / w.sum() if w.sum() > 0 else w


# How strongly each outcome biases toward lower ground / bedding cover
DOWNHILL_BIAS = {"liver": 0.5, "paunch": 0.6, "single_lung": 0.4, "muscle": 0.3, "shoulder_only": 0.3,
                 "kidneys": 0.3, "neck_vessels": 0.2}
