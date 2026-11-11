"""Recovery search map: where a hit deer is likely to be, from shot outcome + run direction + terrain."""

from __future__ import annotations

import json
import math
from pathlib import Path

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
                          "bearing": bc % 360, "ring": i, "sector": j,
                          "r0": float(r0), "r1": float(r1), "b0": float(b0), "b1": float(b1)})
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


def _same(a, b):
    return abs(a[0] - b[0]) < 1e-9 and abs(a[1] - b[1]) < 1e-9


def assemble_rings(ways):
    """Join a multipolygon's member ways end-to-end into closed rings (OSM splits big lakes into many ways).

    Ways may run either direction. Chains that can't be closed are left out (they still count as shoreline)."""
    rings, open_ = [], []
    for w in ways:
        w = [tuple(p) for p in w]
        if len(w) < 2:
            continue
        (rings if len(w) >= 4 and _same(w[0], w[-1]) else open_).append(w)
    while open_:
        cur = open_.pop(0)
        grew = True
        while grew and not _same(cur[0], cur[-1]):
            grew = False
            for i, w in enumerate(open_):
                if _same(cur[-1], w[0]):
                    cur = cur + w[1:]
                elif _same(cur[-1], w[-1]):
                    cur = cur + w[::-1][1:]
                elif _same(cur[0], w[-1]):
                    cur = w + cur[1:]
                elif _same(cur[0], w[0]):
                    cur = w[::-1] + cur[1:]
                else:
                    continue
                open_.pop(i)
                grew = True
                break
        if len(cur) >= 4 and _same(cur[0], cur[-1]):
            rings.append(cur)
    return rings


def _is_open_water(t: dict) -> bool:
    """Lakes, ponds, reservoirs and river areas — places a deer can't go down. Seasonal (intermittent) ponds don't count."""
    if t.get("intermittent") == "yes" or t.get("seasonal") == "yes":
        return False
    return t.get("natural") == "water" or t.get("waterway") == "riverbank" or t.get("landuse") == "reservoir"


def parse_osm(elements: list) -> dict:
    """Overpass elements → {"water": lines, "cover": lines/rings, "lakes": [[ring, ...], ...]}.

    water = streams + every shoreline (lake rings and island rings too) — what the 'head for water' pull measures to.
    lakes = open-water areas, each a list of closed rings read even-odd (outer rings minus inner rings = islands).
    Coordinates are (lat, lon)."""
    out = {"water": [], "cover": [], "lakes": []}
    for el in elements:
        t = el.get("tags", {})
        if el.get("type") == "relation":
            mem = [(m.get("role", ""), [(g["lat"], g["lon"]) for g in m.get("geometry", [])])
                   for m in el.get("members", []) if m.get("type", "way") == "way"]
            outer = [g for r, g in mem if r in ("outer", "") and len(g) >= 2]
            inner = [g for r, g in mem if r == "inner" and len(g) >= 2]
        else:
            g = [(p["lat"], p["lon"]) for p in el.get("geometry", [])]
            outer, inner = ([g] if len(g) >= 2 else []), []
        water_area = _is_open_water(t)
        if "waterway" in t and t.get("waterway") != "riverbank" or water_area or t.get("natural") == "wetland":
            out["water"] += outer + inner
        if water_area:
            rings = assemble_rings(outer) + assemble_rings(inner)
            if rings:
                out["lakes"].append(rings)
        if t.get("natural") == "wetland":
            out["cover"] += outer
        if t.get("natural") in ("wood", "scrub", "heath") or t.get("landuse") == "forest":
            rings = assemble_rings(outer) if el.get("type") == "relation" else []
            out["cover"] += rings if rings else outer
    return out


def fetch_osm_features(lat: float, lon: float, radius_m: float) -> dict | None:
    """Water (streams, ponds, lakes, wetlands) and cover (woods, scrub, wetland) from OpenStreetMap — see parse_osm."""
    r = int(min(max(radius_m, 200), 2500))
    q = f"""
    [out:json][timeout:20];
    (
      way(around:{r},{lat},{lon})["waterway"~"^(stream|river|brook|ditch|canal|drain|riverbank)$"];
      way(around:{r},{lat},{lon})["natural"="water"];
      way(around:{r},{lat},{lon})["landuse"="reservoir"];
      way(around:{r},{lat},{lon})["natural"="wetland"];
      way(around:{r},{lat},{lon})["natural"~"^(wood|scrub|heath)$"];
      way(around:{r},{lat},{lon})["landuse"="forest"];
      relation(around:{r},{lat},{lon})["natural"~"^(water|wetland|wood)$"];
      relation(around:{r},{lat},{lon})["landuse"~"^(forest|reservoir)$"];
      relation(around:{r},{lat},{lon})["waterway"="riverbank"];
    );
    out tags geom;
    """
    try:
        resp = requests.post(OVERPASS_URL, data={"data": q}, timeout=25,
                             headers={"User-Agent": "Deercast/0.3 (deer recovery map)"})
        resp.raise_for_status()
        return parse_osm(resp.json().get("elements", []))
    except Exception:
        return None


# ---------------------------------------------------------------- bundled lake shorelines (work without Overpass)
BUNDLED_WATER = Path(__file__).resolve().parents[1] / "web/public/data/nolin_water.json"
NEAR_BUNDLED_M = 5000  # use the bundled lake when the hit is within ~3 miles of its bounding box


def near_bbox(lat: float, lon: float, bbox, margin_m: float = NEAR_BUNDLED_M) -> bool:
    s, w, n, e = bbox
    dlat = max(s - lat, 0, lat - n) * 110_540
    dlon = max(w - lon, 0, lon - e) * 111_320 * math.cos(math.radians(lat))
    return math.hypot(dlat, dlon) <= margin_m


def bundled_water(lat: float, lon: float, data: dict | None = None) -> dict | None:
    """Nolin River Lake from the bundled lidar shoreline, if the hit is near it."""
    if data is None:
        try:
            data = json.loads(BUNDLED_WATER.read_text())
        except Exception:
            return None
    if not near_bbox(lat, lon, data["bbox"]):
        return None
    lakes = [[[tuple(p) for p in r] for r in f] for f in data["lakes"]]
    return {"water": [r for f in lakes for r in f], "cover": [], "lakes": lakes}


def merge_features(*feats) -> dict | None:
    """Combine OSM + bundled data (water = union of both)."""
    got = [f for f in feats if f]
    if not got:
        return None
    return {k: [g for f in got for g in f.get(k, [])] for k in ("water", "cover", "lakes")}


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


# ---------------------------------------------------------------- open water: no-go, and no swimming across
SWIM_MAX_M = 50  # a straight run through more open water than this means the deer would have had to swim
REMOVED_NOTE = 0.15  # tell the hunter when at least this share of the probability was over water


def _seg_crossings(P, ring):
    """t in (0, 1) where the segment origin→P crosses the ring's edges."""
    A = ring[:-1] if len(ring) > 1 and (np.abs(ring[0] - ring[-1]) < 1e-8).all() else ring
    B = np.roll(A, -1, axis=0)
    E = B - A
    den = P[0] * E[:, 1] - P[1] * E[:, 0]
    ok = np.abs(den) > 1e-12
    t = (A[ok, 0] * E[ok, 1] - A[ok, 1] * E[ok, 0]) / den[ok]
    u = (A[ok, 0] * P[1] - A[ok, 1] * P[0]) / den[ok]
    return t[(t > 0) & (t < 1) & (u >= 0) & (u < 1)]


def water_mask(cells, lat0: float, lon0: float, feats: dict | None):
    """Per cell: (center is in open water, meters of open water on the straight line from the hit site to it)."""
    lakes = []
    for f in (feats or {}).get("lakes", []):
        rings = [_xy(lat0, lon0, r) for r in f if len(r) >= 4]
        if rings:
            allp = np.vstack(rings)
            start = sum(_inside((0.0, 0.0), r) for r in rings) % 2 == 1
            lakes.append((rings, allp.min(0), allp.max(0), start))
    centers = _xy(lat0, lon0, [c["center"] for c in cells])
    out = []
    for P in centers:
        lo, hi = np.minimum(P, 0), np.maximum(P, 0)
        spans, wet = [], False
        for rings, bmin, bmax, start in lakes:
            if (bmax < lo).any() or (bmin > hi).any():
                continue
            ts = np.sort(np.concatenate([_seg_crossings(P, r) for r in rings]))
            edges = [0.0, *ts.tolist(), 1.0]
            state = start
            for a, b in zip(edges[:-1], edges[1:]):
                if state:
                    spans.append((a, b))
                state = not state
            if (len(ts) % 2 == 1) != start:
                wet = True
        spans.sort()
        length, cur = 0.0, None
        for a, b in spans:  # union of wet stretches (OSM and bundled lakes overlap)
            if cur and a <= cur[1]:
                cur[1] = max(cur[1], b)
            else:
                if cur:
                    length += cur[1] - cur[0]
                cur = [a, b]
        if cur:
            length += cur[1] - cur[0]
        out.append((wet, float(length * np.hypot(*P))))
    return out


def apply_water(w, cells, mask):
    """Cells in open water, or only reachable by swimming, get zero. Their share goes to the last cell on dry,
    reachable ground along the same bearing — the deer ran that way and went down along the shore.

    Returns (normalized weights, share of the probability that was over / across water)."""
    w = np.asarray(w, float)
    total = w.sum()
    out = w.copy()
    removed = 0.0
    sectors = {}
    for k, c in enumerate(cells):
        sectors.setdefault(c["sector"], []).append(k)
    for ks in sectors.values():
        shore = None
        for k in sorted(ks, key=lambda k: cells[k]["ring"]):
            wet, water_m = mask[k]
            if not wet and water_m <= SWIM_MAX_M:
                shore = k
                continue
            removed += w[k]
            out[k] = 0.0
            if shore is not None:
                out[shore] += w[k]
    s = out.sum()
    return (out / s if s > 0 else out), (removed / total if total > 0 else 0.0)
