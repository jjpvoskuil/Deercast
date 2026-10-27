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
