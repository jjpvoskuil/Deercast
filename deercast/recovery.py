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


# ---------------------------------------------------------------- water & cover
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# How strongly each outcome pulls the deer toward water / heavy cover (wounded deer seek both to bed).
# Quick-kill hits still run for cover, but die before distance matters much → weaker pull.
WATER_BIAS = {"liver": 1.2, "paunch": 1.5, "single_lung": 1.0, "kidneys": 0.8, "muscle": 0.8, "shoulder_only": 0.8,
              "neck_vessels": 0.6, "femoral": 0.5, "double_lung": 0.3, "heart": 0.3, "aorta": 0.3}
COVER_BIAS = {"liver": 1.4, "paunch": 1.5, "single_lung": 1.2, "kidneys": 1.0, "muscle": 1.0, "shoulder_only": 1.0,
              "neck_vessels": 0.8, "femoral": 0.6, "double_lung": 0.5, "heart": 0.5, "aorta": 0.5}


def fetch_osm_features(lat: float, lon: float, radius_m: float) -> dict | None:
    """Water (streams, ponds, lakes, wetlands) and cover (woods, scrub, wetland) from OpenStreetMap.

    Returns {"water": [[(lat, lon), ...], ...], "cover": [[...], ...]} — each item a line or closed ring.
    """
    r = int(min(max(radius_m, 200), 2500))
    q = f"""
    [out:json][timeout:20];
    (
      way(around:{r},{lat},{lon})["waterway"~"^(stream|river|brook|ditch|canal|drain)$"];
      way(around:{r},{lat},{lon})["natural"="water"];
      way(around:{r},{lat},{lon})["natural"="wetland"];
      way(around:{r},{lat},{lon})["natural"~"^(wood|scrub|heath)$"];
      way(around:{r},{lat},{lon})["landuse"="forest"];
      relation(around:{r},{lat},{lon})["natural"~"^(water|wetland|wood)$"];
      relation(around:{r},{lat},{lon})["landuse"="forest"];
    );
    out tags geom;
    """
    try:
        resp = requests.post(OVERPASS_URL, data={"data": q}, timeout=25,
                             headers={"User-Agent": "Deercast/0.3 (deer recovery map)"})
        resp.raise_for_status()
        out = {"water": [], "cover": []}
        for el in resp.json().get("elements", []):
            t = el.get("tags", {})
            if el.get("type") == "relation":  # multipolygons (big lakes, forests): use outer member rings
                geoms = [[(g["lat"], g["lon"]) for g in mbr.get("geometry", [])]
                         for mbr in el.get("members", []) if mbr.get("role") in ("outer", "")]
            else:
                geoms = [[(g["lat"], g["lon"]) for g in el.get("geometry", [])]]
            for geom in geoms:
                if len(geom) < 2:
                    continue
                if "waterway" in t or t.get("natural") == "water":
                    out["water"].append(geom)
                if t.get("natural") == "wetland":
                    out["water"].append(geom)
                    out["cover"].append(geom)
                if t.get("natural") in ("wood", "scrub", "heath") or t.get("landuse") == "forest":
                    out["cover"].append(geom)
        return out
    except Exception:
        return None


def _xy(lat0: float, lon0: float, pts):
    """Local equirectangular meters around (lat0, lon0)."""
    k = math.cos(math.radians(lat0))
    a = np.asarray(pts, float)
    return np.column_stack([(a[:, 1] - lon0) * 111_320 * k, (a[:, 0] - lat0) * 110_540])


def _dist_to_polyline(p, line):
    a, b = line[:-1], line[1:]
    ab = b - a
    t = np.clip(((p - a) * ab).sum(1) / np.maximum((ab * ab).sum(1), 1e-9), 0, 1)
    proj = a + ab * t[:, None]
    return float(np.min(np.hypot(*(p - proj).T)))


def _inside(p, ring):
    x, y = p
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-12) + x1:
            inside = not inside
    return inside


def feature_distances(cells, lat0: float, lon0: float, osm: dict | None, marks: list[dict]):
    """Per cell: meters to nearest water, meters to nearest cover (0 if inside), and bedding-mark proximity."""
    centers = _xy(lat0, lon0, [c["center"] for c in cells])
    water = [_xy(lat0, lon0, g) for g in (osm or {}).get("water", [])]
    cover = [_xy(lat0, lon0, g) for g in (osm or {}).get("cover", [])]
    out = []
    for p in centers:
        dw = min((_dist_to_polyline(p, g) for g in water), default=math.inf)
        dc = math.inf
        for g in cover:
            closed = len(g) > 3 and np.hypot(*(g[0] - g[-1])) < 5
            if closed and _inside(p, g):
                dc = 0.0
                break
            dc = min(dc, _dist_to_polyline(p, g))
        # hunter-marked features (circles)
        for mk in marks:
            mp = _xy(lat0, lon0, [(mk["lat"], mk["lon"])])[0]
            d = max(0.0, float(np.hypot(*(p - mp))) - mk.get("radius_yd", 40) * YD)
            if mk["type"] == "water":
                dw = min(dw, d)
            elif mk["type"] in ("cover", "bedding"):
                dc = min(dc, d)
        bed = min((max(0.0, float(np.hypot(*(p - _xy(lat0, lon0, [(m["lat"], m["lon"])])[0])))
                       - m.get("radius_yd", 40) * YD) for m in marks if m["type"] == "bedding"), default=math.inf)
        out.append((dw, dc, bed))
    return out


def habitat_multiplier(dists, water_bias: float, cover_bias: float):
    """× weight per cell: closer to water / inside cover = higher. Bedding areas count extra."""
    m = []
    for dw, dc, bed in dists:
        f = 1.0
        if math.isfinite(dw):
            f *= 1 + water_bias * math.exp(-dw / 90)  # strongest within ~100 yd of water
        if math.isfinite(dc):
            f *= 1 + cover_bias * math.exp(-dc / 40)
        if math.isfinite(bed):
            f *= 1 + 1.5 * cover_bias * math.exp(-bed / 40)
        m.append(f)
    return np.array(m)
