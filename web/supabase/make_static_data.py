"""Regenerate the web app's copies of static Python data (public, no secrets):
web/src/lib/regs/data.json (Kentucky regs + state agencies) and web/src/lib/archery.fixtures.json (parity cases).
Run after editing deercast/regs/*.py (every season!) or deercast/archery.py."""
import json, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[2]; sys.path.insert(0, str(ROOT))
from deercast import archery, regs
from deercast.regs import kentucky as ky

data = {"agencies": regs.STATE_AGENCIES, "curated": {"KY": {
    "state": ky.STATE, "agency": ky.AGENCY, "season": ky.SEASON, "verified": ky.VERIFIED.isoformat(), "links": ky.LINKS,
    "seasons": [[n, s.isoformat(), e.isoformat(), note] for n, s, e, note in ky.SEASONS],
    "zones": ky.ZONES, "zoneBag": {str(k): v for k, v in ky.ZONE_BAG.items()}, "statewide": ky.STATEWIDE,
    "cwdCounties": sorted(ky.CWD_COUNTIES), "cwdRules": ky.CWD_RULES}}}
Path(ROOT / "web/src/lib/regs/data.json").write_text(json.dumps(data, indent=1))
cases = []
for bt in archery.BOW_TYPES:
    for tip in archery.TIP_FACTOR:
        for dw, aw, dl, chrono in ((60, 436, 29.5, None), (45, 300, 27, None), (70, 520, 30, None), (65, 425, 29, 288)):
            s = {"bow_type": bt, "rated_fps": 314 if bt != "Crossbow" else 400, "rated_bolt_gr": 400, "draw_weight": dw,
                 "draw_length": dl, "arrow_gr": aw, "tip_type": tip, "string_gr": 15, "chrono_fps": chrono}
            cases.append([s, archery.summary(s), [archery.flight_time(archery.estimate_speed(s) or 0, y) for y in (10, 20, 30, 40)]])
Path(ROOT / "web/src/lib/archery.fixtures.json").write_text(json.dumps(cases))
print("ok", len(data["curated"]["KY"]["zones"]), "counties,", len(cases), "archery cases")
