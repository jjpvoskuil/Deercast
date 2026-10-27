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
         mock.patch("deercast.weather.fetch_hourly_wind", fake_hourly_wind):
        at = AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=60)
        at.run()
        if page_path:
            at.switch_page(page_path)
            at.run()
        return at


def test_pages_render():
    for p in [None, "app_pages/map.py", "app_pages/dev.py"]:
        at = run(p)
        assert not at.exception, (p, [e.value for e in at.exception])
