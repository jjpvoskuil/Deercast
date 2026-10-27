"""Render every page headlessly with synthetic weather (no network)."""
import sys
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / "tests"))

import pandas as pd
from streamlit.testing.v1 import AppTest
from synthetic import synthetic_weather

TZ = "America/Chicago"


def fake_hourly(lat, lon, days=15):
    return synthetic_weather(TZ), TZ


def fake_current(lat, lon):
    return {"time": pd.Timestamp.now(tz="UTC"), "temp_f": 50, "wind_mph": 7, "wind_dir": 225, "gust_mph": 12}


def fake_hourly_wind(lat, lon, hours=48):
    idx = pd.date_range(pd.Timestamp.now(tz=TZ).floor("h"), periods=hours, freq="h")
    return pd.DataFrame({"wind_mph": 6.0, "wind_dir": 270.0, "gust_mph": 10.0}, index=idx)


def run(page_path):
    with mock.patch("deercast.weather.fetch_hourly", fake_hourly), \
         mock.patch("deercast.weather.fetch_current_wind", fake_current), \
         mock.patch("deercast.weather.fetch_hourly_wind", fake_hourly_wind), \
         mock.patch("deercast.regs.county_for_point", lambda lat, lon: {"county": "Hart", "state": "KY", "fips": "21099"}):
        at = AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=60)
        at.run()
        if page_path:
            at.switch_page(page_path)
            at.run()
        return at


def test_pages_render():
    for p in [None, "app_pages/map.py", "app_pages/log.py", "app_pages/track.py", "app_pages/regs.py", "app_pages/dev.py"]:
        at = run(p)
        assert not at.exception, (p, [e.value for e in at.exception])


def test_regs_page_content():
    at = run("app_pages/regs.py")
    vals = [m.value for m in at.metric]
    assert "Hart" in vals and "Zone 1" in vals and "No" in vals
    assert any("Modern gun" in str(df.value) for df in at.dataframe)


def test_map_defaults_to_satellite():
    import re
    src = (ROOT / "app_pages" / "map.py").read_text()
    assert src.count("show=False") >= 2 and 'name="Satellite"' in src


def test_regs_falls_back_to_hart_when_lookup_fails():
    def boom(lat, lon):
        raise RuntimeError("offline")
    with mock.patch("deercast.weather.fetch_hourly", fake_hourly), mock.patch("deercast.regs.county_for_point", boom):
        at = AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=60)
        at.run(); at.switch_page("app_pages/regs.py"); at.run()
    assert not at.exception
    assert "Hart" in [m.value for m in at.metric] and "Zone 1" in [m.value for m in at.metric]


def test_default_location_is_hart_county():
    from deercast import ui
    from deercast.regs import kentucky as k
    assert ui.DEFAULT_COUNTY == "Hart" and k.zone_for(ui.DEFAULT_COUNTY) == 1
    assert abs(ui.DEFAULT_LOCATION.lat - 37.3006) < 0.01 and abs(ui.DEFAULT_LOCATION.lon + 86.0608) < 0.01


def test_track_page_with_shot():
    with mock.patch("deercast.weather.fetch_hourly", fake_hourly), \
         mock.patch("deercast.recovery.fetch_elevations", lambda pts: [180.0 - i * 0.1 for i in range(len(pts))]), \
         mock.patch("deercast.recovery.fetch_osm_features", lambda lat, lon, r: {
             "water": [[(lat - 0.002, lon + 0.0015), (lat + 0.002, lon + 0.0015)]], "cover": []}):
        at = AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=60)
        at.run(); at.switch_page("app_pages/track.py")
        at.session_state["shot_cross"] = (-6.0, 1.0)  # broadside, behind the shoulder
        at.run()
    assert not at.exception, [e.value for e in at.exception]
    md = " ".join(m.value for m in at.markdown)
    assert "Double lung" in md
    vals = [m.value for m in at.metric]
    assert "30 min" in vals


def _patched():
    return [mock.patch("deercast.weather.fetch_hourly", fake_hourly),
            mock.patch("deercast.weather.fetch_current_wind", fake_current),
            mock.patch("deercast.weather.fetch_hourly_wind", fake_hourly_wind)]


def test_hunt_log_flow():
    import contextlib
    with contextlib.ExitStack() as stack:
        for p in _patched():
            stack.enter_context(p)
        at = AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=60)
        at.run(); at.switch_page("app_pages/log.py"); at.run()
        start = next(b for b in at.button if "Start hunt" in b.label)
        start.click().run()
        assert not at.exception, [e.value for e in at.exception]
        next(b for b in at.button if b.label == "+ Doe").click().run()
        next(b for b in at.button if b.label == "+ Buck").click().run()
        assert "Time on stand" in [m.label for m in at.metric]
        # end & save
        next(b for b in at.button if "End & save" in b.label).click().run()
        assert not at.exception, [e.value for e in at.exception]
        import json, pathlib
        hunts = json.loads(pathlib.Path(".deercast_data/hunts.json").read_text())
        assert len(hunts) == 1 and len(hunts[0]["sightings"]) == 2
        assert hunts[0]["hours"] and hunts[0]["hours"][0]["score"] is not None
        assert any("2 deer" in e.label for e in at.expander)


def test_validation_math():
    from deercast import huntlog
    mk = lambda score, seen: {"hour": "2026-11-05T07:00:00-06:00", "score": score, "minutes": 60, "seen": seen}
    hunts = [{"id": str(i), "hours": [mk(2, 0), mk(5, 1), mk(8.5, 3)]} for i in range(6)]
    v = huntlog.validation(hunts)
    assert v["rho"] > 0.8 and "tracking your sightings well" in v["verdict"]
    b = v["bands"].set_index("band")["deer_per_hour"]
    assert b["8–10"] > b["4–6"] > b["0–2"]


def test_bait_marks_on_map():
    import contextlib, json, pathlib
    pathlib.Path(".deercast_data").mkdir()
    pathlib.Path(".deercast_data/features.json").write_text(json.dumps([
        {"id": "a", "type": "feeder", "name": "Back feeder", "lat": 37.301, "lon": -86.06, "radius_yd": 10,
         "last_filled": "2026-10-20"},
        {"id": "b", "type": "corn_ear", "name": "Ear pile", "lat": 37.302, "lon": -86.061, "radius_yd": 10}]))
    with contextlib.ExitStack() as stack:
        for p in _patched():
            stack.enter_context(p)
        at = AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=60)
        at.run(); at.switch_page("app_pages/map.py"); at.run()
    assert not at.exception, [e.value for e in at.exception]
    assert any("Bait & food sites (2)" in e.label for e in at.expander)
    assert any(b.label == "Filled today" for b in at.button)
