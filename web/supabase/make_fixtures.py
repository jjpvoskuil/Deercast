"""Regenerate web/src/lib/fixtures.json from the Python model (synthetic points only) — JS parity test reads it."""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]; sys.path.insert(0, str(ROOT))
import numpy as np
from deercast import scent, terrain
from deercast.weather import deg_to_cardinal

P = (37.30, -86.06)
fx = {"dest": [[*P, b, d, *scent.destination(*P, b, d)] for b in (0, 37, 135, 290) for d in (10, 400)],
      "cone": [[w, m, scent.scent_cone(*P, w, m, frac=0.66)] for w, m in ((225, 2), (0, 7), (310, 14))],
      "drift": [[b, m, x, scent.drift_cone(*P, b, m, x)] for b, m, x in ((80, 3, 20), (200, 12, 0))],
      "ok": [[w, g, scent.wind_ok_for_stand(w, g)] for w, g in ((10, ["N"]), (60, ["N", "SW"]), (230, ["SW"]), (5, []))],
      "card": [[d, deg_to_cardinal(d)] for d in (0, 11.2, 11.3, 100, 359)],
      "slope": [[e, *terrain.slope_from(e)] for e in ([200, 205, 195, 201, 199], [100, 100, 100, 100, 100], [50, 48, 52, 55, 45])],
      "combine": [[a, terrain.combine(*a)] for a in ((270, 2, 6, 90, "up", 0.8), (0, 10, 4, 180, "down", 1.0),
                                                    (45, 1, 3, 300, "switching", 0.0), (90, 0, 0.5, 0, "down", 1.0))],
      "describe": []}
for a, c in fx["combine"]:
    fx["describe"].append([a, terrain.describe(c)])
E = np.array([[100 + 2 * r + 0.5 * c * c for c in range(5)] for r in range(4)], float)
s, u = terrain.grid_slopes(E, 120)
fx["grid"] = [E.tolist(), s.tolist(), u.tolist()]
from datetime import datetime, timedelta, timezone
t0 = datetime(2026, 11, 5, 10, tzinfo=timezone.utc)
fx["phase"] = [[(t0 + timedelta(hours=h)).timestamp() * 1000, *terrain.thermal_phase(*P, t0 + timedelta(hours=h))]
               for h in range(24)]
Path(ROOT / "web/src/lib/fixtures.json").write_text(json.dumps(fx))
