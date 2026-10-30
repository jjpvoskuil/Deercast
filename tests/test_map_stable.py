"""The map must not change between reruns when nothing changed — otherwise st_folium remounts it, the remount
reports center/zoom, that reruns the script, and the map flickers in a loop (thermals / drift field)."""
import sys
import time
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT)); sys.path.insert(0, str(ROOT / "tests"))

import streamlit_folium as sf
import test_app as T


def fake_elev(points):  # a tilted plane: real slope everywhere so thermals matter
    return [200 + 3000 * (a - 37.3) + 1500 * (b + 86.06) for a, b in points]


def creeping_sun(lat, lon, when_utc):  # sun altitude that keeps moving, like mid-morning / afternoon
    return 18.0 + (when_utc.timestamp() % 600) / 60


def test_map_identical_across_reruns():
    hashes = []
    orig = sf.generate_js_hash

    def rec(*a, **k):
        h = orig(*a, **k)
        hashes.append(h)
        return h

    with mock.patch("deercast.weather.fetch_hourly", T.fake_hourly), \
         mock.patch("deercast.weather.fetch_current_wind", T.fake_current), \
         mock.patch("deercast.weather.fetch_hourly_wind", T.fake_hourly_wind), \
         mock.patch("deercast.recovery.fetch_elevations", fake_elev), \
         mock.patch("deercast.astro.sun_altitude_deg", creeping_sun), \
         mock.patch("streamlit_folium.generate_js_hash", rec), \
         mock.patch("deercast.regs.county_for_point", lambda lat, lon: {"county": "Hart", "state": "KY", "fips": "21099"}):
        at = T.AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=60)
        at.run()
        at.switch_page("app_pages/map.py")
        at.run()
        at.session_state["show_field"] = True
        at.session_state["last_click"] = [37.301, -86.061]  # tap-to-test cone uses thermals too
        at.run()
        n = len(hashes)
        for _ in range(2):
            time.sleep(1.2)
            at.run()
        assert not at.exception
    assert len(set(hashes[n - 1:])) == 1, "map changed between identical reruns → flicker"
