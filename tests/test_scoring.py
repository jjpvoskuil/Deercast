import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / "tests"))

from synthetic import synthetic_weather
from deercast import scoring, scent


def _scored():
    lat, lon, tz = 37.35, -86.12, "America/Chicago"
    return scoring.score_forecast(synthetic_weather(tz), lat, lon, tz,
                                  scoring.Settings(rut_peak=scoring.default_rut_peak(lat, 2026)))


def test_range_and_horizon():
    s = _scored()
    assert s["score"].between(0, 10).all()
    assert s["date"].nunique() >= 14


def test_twilight_beats_midday():
    s = _scored()
    d = s[s["date"] == s["date"].iloc[30]]
    sunrise_hr = d["sunrise"].iloc[0].hour
    assert d[d.index.hour == sunrise_hr]["score"].iloc[0] > d[d.index.hour == 12]["score"].iloc[0]


def test_cold_front_boosts():
    s = _scored()
    best = scoring.best_windows(s)["best_score"]
    assert best.iloc[5] > best.iloc[3]  # synthetic front arrives on day 5


def test_scent_cone_points_downwind():
    pts = scent.scent_cone(37.0, -86.0, wind_from_deg=270, wind_mph=8)  # west wind → scent east
    assert all(lon >= -86.0 for _, lon in pts)
    assert scent.wind_ok_for_stand(260, ["W"]) and not scent.wind_ok_for_stand(90, ["W"])


def test_compass_svg():
    from deercast.compass import Compass, compass_svg
    svg = compass_svg(225, 8)
    assert svg.startswith("<svg") and ">N<" in svg and "rotate(45 " in svg  # SW wind → arrow points NE
    assert "rotate(" not in compass_svg(None)
    import folium
    m = folium.Map()
    Compass(225, 8, "SW 8 mph").add_to(m)
    assert "deercast-compass" in m.get_root().render()


def test_kentucky_zones():
    from deercast.regs import kentucky as k
    assert len(k.ZONES) == 120
    assert k.zone_for("Hart County") == 1 and k.zone_for("Edmonson") == 2 and k.zone_for("Grayson") == 1
    assert k.zone_for("Rockcastle") == 3 and k.zone_for("Bell") == 4
    assert "Hardin" in k.CWD_COUNTIES and "Hart" not in k.CWD_COUNTIES


def _hit(yaw, pitch, x, z, weapon="Bow"):
    import numpy as np
    from deercast import shot
    d, r, u = shot.view_basis(yaw, pitch)
    p = np.array([x, 0, z], float)
    res = shot.trace(p @ r, p @ u, yaw, pitch)
    return shot.classify(res, weapon)


def test_shot_classification():
    assert _hit(0, 0, 6, 1)[0] == "double_lung"
    assert _hit(0, 0, 12.5, -4.5)[0] == "heart"
    assert _hit(0, 0, -1, 0)[0] == "liver"
    assert _hit(0, 0, -9, -2)[0] == "paunch"
    assert _hit(0, 0, 6, 8.6)[0] == "spine"
    assert _hit(0, 0, 6, 14)[0] == "miss"
    prim, stopped, _ = _hit(0, 0, 13.5, 0)  # on the shoulder with a bow
    assert prim == "double_lung" and stopped == "shoulder_only"
    assert _hit(0, 0, 13.5, 0, "Rifle / shotgun slug")[1] is None
    assert _hit(0, 25, 6, 3)[0] == "double_lung"  # from a tree stand


def test_render_and_recovery():
    from deercast import recovery, shot_render as R
    img = R.deer_view(30, 15, True, (0, 0), True, {"lung_l"})
    assert img.size == (720, 600)
    sx, sy = R.screen_to_model(360, 300, 720, 600, False)
    assert abs(sx) < 1e-6 and abs(sy) < 1e-6
    cells = recovery.search_grid(37.3, -86.06, (80, 200, 400), 90.0)
    w = recovery.weight_cells(cells, (80, 200, 400), 90.0, None, None, 0)
    best = cells[int(w.argmax())]
    assert 45 <= best["bearing"] <= 135 and 80 <= best["dist_yd"] <= 260


def test_habitat_pulls_search_toward_water():
    import math
    import numpy as np
    from deercast import recovery
    lat, lon = 37.30, -86.06
    east = 150 / (111320 * math.cos(math.radians(lat)))
    osm = {"water": [[(lat - 0.01, lon + east), (lat + 0.01, lon + east)]], "cover": []}
    cells = recovery.search_grid(lat, lon, (80, 200, 400), None)
    w = recovery.weight_cells(cells, (80, 200, 400), None, None, None, 0)
    w2 = w * recovery.habitat_multiplier(recovery.feature_distances(cells, lat, lon, osm, []), 1.5, 1.5)
    best = cells[int(np.argmax(w2))]
    assert 30 <= best["bearing"] <= 150  # pulled toward the creek to the east
    # bedding mark dominates
    marks = [{"type": "bedding", "lat": lat + 0.0018, "lon": lon, "radius_yd": 30}]
    w3 = w * recovery.habitat_multiplier(recovery.feature_distances(cells, lat, lon, None, marks), 1.5, 1.5)
    b3 = cells[int(np.argmax(w3))]
    assert b3["bearing"] < 30 or b3["bearing"] > 330


def test_archery_math():
    from deercast import archery
    comp = {"bow_type": "Compound", "rated_fps": 340, "draw_weight": 65, "draw_length": 28.5, "arrow_gr": 420,
            "string_gr": 15, "tip_type": "Fixed-blade broadhead"}
    v = archery.estimate_speed(comp)
    assert 270 < v < 290  # 340 − 15 − 31.7 − 5 − 8.5 ≈ 280
    s = archery.summary(comp)
    assert 65 < s["ke"] < 80 and 0.48 < s["momentum"] < 0.56 and s["bone"] == "High"
    assert archery.estimate_speed({**comp, "chrono_fps": 301}) == 301
    xb = {"bow_type": "Crossbow", "rated_fps": 400, "rated_bolt_gr": 400, "arrow_gr": 425,
          "tip_type": "Mechanical / expandable broadhead"}
    assert 385 < archery.estimate_speed(xb) < 392
    light = {**comp, "draw_weight": 45, "arrow_gr": 300, "tip_type": "Mechanical / expandable broadhead"}
    assert archery.bone_rating(light)[0] == "Low"


def test_state_rut_table():
    from deercast import rut, scoring
    ky = rut.peak_for("KY", 37.3, -86.06)
    assert (ky.month, ky.day, ky.confidence) == (11, 15, "agency")
    assert rut.peak_for("AL", 31.5, -87.9).month == 1  # south/central Alabama: late January
    assert str(scoring.rut_peak_for("2026-11-01", 31.5, lon=-87.9, state="AL")) == "2027-01-28"
    assert str(scoring.rut_peak_for("2027-01-10", 31.5, lon=-87.9, state="AL")) == "2027-01-28"
    assert rut.peak_for("TX", 27.8, -98.0).month == 12
    assert str(scoring.rut_peak_for("2026-10-27", 37.3, override="2026-11-20", lon=-86.06, state="KY")) == "2026-11-20"


def test_thermals():
    from datetime import datetime, timezone
    from deercast import terrain
    slope, up = terrain.slope_from([100, 100, 100, 104, 96])  # rises to the east
    assert 5 < slope < 6.5 and abs(up - 90) < 1
    morning = terrain.thermal_phase(37.3, -86.06, datetime(2026, 10, 28, 16, 0, tzinfo=timezone.utc))  # 11 AM CDT
    evening = terrain.thermal_phase(37.3, -86.06, datetime(2026, 10, 28, 23, 30, tzinfo=timezone.utc))  # 6:30 PM
    assert morning[0] == "up" and evening[0] == "down"
    light = terrain.combine(0, 2, slope, up, "down", 1.0)   # N wind 2 mph, thermals drain west
    strong = terrain.combine(0, 12, slope, up, "down", 1.0)
    assert 200 < light["to_bearing"] < 260 and light["influence"] > 0.5
    assert 175 < strong["to_bearing"] < 200 and strong["influence"] < 0.25
    assert terrain.combine(0, 5, 0.5, 0, "up", 1.0)["thermal_mph"] == 0  # flat ground


def test_best_stand_ranking():
    import pandas as pd
    from deercast import beststand, scoring
    from synthetic import synthetic_weather  # wind from W (270) all day
    lat, lon, tz = 37.3, -86.06, "America/Chicago"
    sc = scoring.score_forecast(synthetic_weather(tz), lat, lon, tz,
                                scoring.Settings(rut_peak=scoring.rut_peak_for("2026-10-27", lat, lon=lon, state="KY")))
    day = sc[sc["date"] == sc["date"].iloc[30]]
    stands = [{"id": "a", "name": "West wind stand", "lat": lat, "lon": lon, "good_winds": ["W"]},
              {"id": "b", "name": "East wind stand", "lat": lat, "lon": lon, "good_winds": ["E"]},
              {"id": "c", "name": "No winds set", "lat": lat, "lon": lon, "good_winds": []}]
    r = beststand.rank(stands, day, "Evening", [])
    assert [x["stand"]["id"] for x in r] == ["a", "c", "b"]
    assert r[0]["fit"] == 1.0 and r[-1]["fit"] == 0.0
    # history boosts a stand with lots of deer logged in the evening
    hunts = [{"stand": "Stand: East wind stand", "hours": [
        {"hour": "2026-10-20T17:00:00-05:00", "minutes": 60, "seen": 6}] * 5}]
    r2 = beststand.rank(stands[1:2] + stands[:1], day, "Evening", hunts)
    hist = {x["stand"]["id"]: x["history"] for x in r2}
    assert hist["b"] > 1.2 and abs(hist["a"] - 1.0) < 1e-9
