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
