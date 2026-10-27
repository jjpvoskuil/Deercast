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
    for p in [None, "app_pages/map.py", "app_pages/regs.py", "app_pages/dev.py"]:
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
