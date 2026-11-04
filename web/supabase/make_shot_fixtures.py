"""Regenerate web/src/lib/shot.fixtures.json: Python shot.py + recovery.py answers on synthetic inputs."""
import json, math, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]; sys.path.insert(0, str(ROOT))
import numpy as np
from deercast import recovery, shot

traces = []
for yaw in (-75, -45, 0, 30, 60):
    for pitch in (0, 22, 45):
        for sx in range(-40, 44, 8):
            for sy in range(-30, 32, 6):
                r = shot.trace(sx, sy, yaw, pitch)
                p, s, notes = shot.classify(r, "Bow")
                p2, s2, _ = shot.classify(r, "Rifle / shotgun slug")
                traces.append([sx, sy, yaw, pitch, None if r.missed else [list(map(float, r.entry)), list(map(float, r.exit))],
                               [[h.key, round(float(h.t_in), 6), round(float(h.t_out), 6), bool(h.after_bone)] for h in r.hits], p, s, notes, p2, s2])
LAT, LON = 37.29, -86.04
rec = []
for yards, run in (((30, 80, 150), None), ((80, 200, 400), 45.0), ((100, 500, 1500), 300.0)):
    cells = recovery.search_grid(LAT, LON, yards, run)
    elev = [200 + 3000 * (c["center"][0] - LAT) - 1500 * (c["center"][1] - LON) for c in cells]
    w = recovery.weight_cells(cells, yards, run, elev, 200.0, 0.5)
    osm = {"water": [[(LAT + 0.001, LON - 0.003), (LAT + 0.0012, LON + 0.003)]],
           "cover": [[(LAT - 0.001, LON - 0.001), (LAT - 0.001, LON + 0.001), (LAT - 0.002, LON + 0.001), (LAT - 0.002, LON - 0.001), (LAT - 0.001, LON - 0.001)]]}
    marks = [{"type": "bedding", "lat": LAT + 0.0005, "lon": LON + 0.001, "radius_yd": 40}, {"type": "water", "lat": LAT - 0.003, "lon": LON, "radius_yd": 30}]
    dist = recovery.feature_distances(cells, LAT, LON, osm, marks)
    hab = recovery.habitat_multiplier(dist, 1.2, 1.4)
    rec.append({"yards": yards, "run": run, "centers": [list(c["center"]) for c in cells], "dist": [c["dist_yd"] for c in cells],
                "bearing": [c["bearing"] for c in cells], "elev": elev, "w": list(map(float, w)), "osm": osm, "marks": marks,
                "fd": [[x if math.isfinite(x) else None for x in d] for d in dist], "hab": list(map(float, hab))})
Path(ROOT / "web/src/lib/shot.fixtures.json").write_text(json.dumps({"traces": traces, "rec": rec,
    "angles": [[h, d, shot.stand_angle(h, d)] for h, d in ((18, 20), (0, 30), (25, 10), (12, 0))]}))
print("ok", len(traces), "traces")
