"""Made-up lake / island / pond / stream cases for the recovery water rule (shared by tests and the JS fixtures).

The hit sites are synthetic points, not stands. The bundled-Nolin case uses a made-up spot ~250 m from the shore."""
import json
from pathlib import Path

from deercast.scent import destination

LAT, LON = 37.29, -86.04
D = 0.0001  # ~11 m north-south, ~9 m east-west


def _geom(pts):
    return [{"lat": a, "lon": b} for a, b in pts]


def lake_relation():
    """A ~1.2 x 0.5 km lake 145 m north of (LAT, LON), as a multipolygon split into 3 ways (one reversed),
    with a ~100 m island in the middle."""
    s, n, w, e = LAT + 13 * D, LAT + 60 * D, LON - 60 * D, LON + 60 * D
    sw, se, ne, nw = (s, w), (s, e), (n, e), (n, w)
    mid_s, mid_n = (s, LON), (n, LON)
    ways = [[sw, mid_s, se], [ne, se], [ne, mid_n, nw, sw]]  # the 2nd runs ne→se, against the ring's direction
    isl = [(LAT + 32 * D, LON - 5 * D), (LAT + 32 * D, LON + 5 * D), (LAT + 41 * D, LON + 5 * D),
           (LAT + 41 * D, LON - 5 * D), (LAT + 32 * D, LON - 5 * D)]
    members = [{"type": "way", "role": "outer", "geometry": _geom(g)} for g in ways]
    members.append({"type": "way", "role": "inner", "geometry": _geom(isl)})
    return {"type": "relation", "tags": {"type": "multipolygon", "natural": "water", "water": "reservoir"},
            "members": members}


def narrow_lake():
    """A 130 m wide arm of water 145 m north of the hit, with dry land (the far bank) beyond it."""
    s, n = LAT + 13 * D, LAT + 25 * D
    r = [(s, LON - 200 * D), (s, LON + 200 * D), (n, LON + 200 * D), (n, LON - 200 * D), (s, LON - 200 * D)]
    return {"type": "way", "tags": {"natural": "water", "water": "lake"}, "geometry": _geom(r)}


def stream():
    return {"type": "way", "tags": {"waterway": "stream"},
            "geometry": _geom([(LAT + 8 * D, LON - 40 * D), (LAT + 9 * D, LON), (LAT + 7 * D, LON + 40 * D)])}


def pond():
    """A ~30 m farm pond 60 m east of the hit (closed way) — small enough to run around, not a barrier."""
    c = (LAT, LON + 7 * D)
    r = [(c[0] - 1.5 * D, c[1] - 1.6 * D), (c[0] - 1.5 * D, c[1] + 1.6 * D), (c[0] + 1.5 * D, c[1] + 1.6 * D),
         (c[0] + 1.5 * D, c[1] - 1.6 * D), (c[0] - 1.5 * D, c[1] - 1.6 * D)]
    return {"type": "way", "tags": {"natural": "water", "water": "pond"}, "geometry": _geom(r)}


def nolin_spot():
    """A made-up point ~250 m inland of a Nolin shore vertex, and the bearing toward the lake."""
    d = json.loads((Path(__file__).resolve().parents[1] / "web/public/data/nolin_water.json").read_text())
    v = d["lakes"][0][0][2000]
    return destination(v[0], v[1], 180, 250), 0.0


def cases():
    liver = (100, 200, 400)
    nolin_hit, nolin_run = nolin_spot()
    return [
        {"name": "facing the lake", "hit": (LAT, LON), "yards": liver, "run": 0.0, "elements": [lake_relation()]},
        {"name": "far bank across the water", "hit": (LAT, LON), "yards": liver, "run": 0.0,
         "elements": [narrow_lake()]},
        {"name": "lake behind", "hit": (LAT, LON), "yards": liver, "run": 180.0, "elements": [lake_relation()]},
        {"name": "on the island", "hit": (LAT + 36.5 * D, LON), "yards": (30, 60, 120), "run": None,
         "elements": [lake_relation()]},
        {"name": "stream + pond", "hit": (LAT, LON), "yards": (30, 80, 150), "run": 90.0,
         "elements": [stream(), pond()], "marks": [{"type": "water", "lat": LAT - 20 * D, "lon": LON, "radius_yd": 30}]},
        {"name": "overpass failed - bundled Nolin", "hit": nolin_hit, "yards": liver, "run": nolin_run,
         "elements": None, "bundled": True},
        {"name": "overpass + bundled Nolin", "hit": nolin_hit, "yards": liver, "run": None,
         "elements": [stream()], "bundled": True},
    ]
