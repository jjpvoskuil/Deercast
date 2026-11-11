"""Build web/public/data/nolin_water.json — Nolin River Lake as an open-water polygon for the recovery map.

  pip install shapely
  python tools/make_nolin_water.py <Voskuil-Fishin-Magician>/web/public/depth/contours.json

Source: the 514-ft contour of the Fishin Magician lake-depth build (KyFromAbove Phase 2 lidar, public data), i.e.
the shoreline 1 ft under summer pool (515 ft). It comes as two open lines that leave the lidar box at its north
(Nolin River arm, lat 37.388) and east (lon -86.098) edges; joined they make the lake's outer ring. The small closed
514-ft loops inside it are islands. Upstream of those two edges the arms are cut off — OpenStreetMap covers them.

(The digitized 1966 topo shoreline in that repo, data/nolin_shoreline.geojson, was not used: it is 1,366 separate
fragments covering only ~37% of the lake, so most of the water would test as land.)
"""
import json
import sys
from pathlib import Path

from shapely.geometry import Polygon
from shapely.validation import make_valid

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "web/public/data/nolin_water.json"


def main(src):
    c = json.loads(Path(src).read_text())
    lines = [ln["c"] for ln in c["lines"] if ln["e"] == 514 and not ln.get("est")]
    open_ = sorted([ln for ln in lines if ln[0] != ln[-1]], key=len, reverse=True)
    loops = [ln for ln in lines if ln[0] == ln[-1]]
    assert len(open_) == 2, f"expected 2 open shoreline pieces, got {len(open_)}"
    a, b = open_
    outer = make_valid(Polygon(a + b))
    outer = max(getattr(outer, "geoms", [outer]), key=lambda g: g.area if g.geom_type == "Polygon" else 0)
    outer = outer.simplify(0.00002)  # ~2 m
    islands = [Polygon(r) for r in loops if outer.contains(Polygon(r))]
    ll = lambda ring: [[round(y, 5), round(x, 5)] for x, y in ring.coords]  # [lat, lon] like the rest of the app
    out = {
        "name": "Nolin River Lake",
        "level_ft": 514,
        "source": "514-ft shoreline from KyFromAbove Phase 2 lidar (Kentucky Division of Geographic Information), "
                  "via the Voskuil-Fishin-Magician depth build; summer pool is 515 ft. Arms upstream of lat 37.388 / "
                  "lon -86.098 are not included.",
        "bbox": [round(v, 4) for v in (outer.bounds[1], outer.bounds[0], outer.bounds[3], outer.bounds[2])],
        "lakes": [[ll(outer.exterior)] + [ll(p.exterior) for p in islands]],
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, separators=(",", ":")))
    print(f"{OUT.relative_to(ROOT)}: outer {len(outer.exterior.coords)} pts, {len(islands)} islands, "
          f"{OUT.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main(sys.argv[1])
