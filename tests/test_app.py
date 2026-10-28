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
    for p in [None, "app_pages/map.py", "app_pages/log.py", "app_pages/track.py", "app_pages/gear.py", "app_pages/regs.py", "app_pages/dev.py"]:
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
        assert any("since" in m.value for m in at.markdown)
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


def test_past_hunt_entry_last_season():
    """Past hunt: 1 doe + 2 fawns as ONE entry, saves, then the form clears for the next hunt."""
    import contextlib, json, pathlib
    from datetime import date, time as dtime
    with contextlib.ExitStack() as stack:
        for p in _patched():
            stack.enter_context(p)
        stack.enter_context(mock.patch("deercast.weather.fetch_hourly_range",
                                       lambda lat, lon, s, e: (synthetic_weather(TZ), TZ)))
        at = AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=60)
        at.run(); at.switch_page("app_pages/log.py"); at.run()
        at.date_input(key="past_date").set_value(date(2025, 11, 8))
        at.time_input(key="past_stime").set_value(dtime(7, 10))
        at.number_input(key="past_c_Doe").set_value(1)
        at.number_input(key="past_c_Fawn").set_value(2)
        at.button(key="past_gadd").click().run()
        assert not at.exception, [e.value for e in at.exception]
        assert at.number_input(key="past_c_Fawn").value == 0  # counts reset after Add
        assert any("1 Doe, 2 Fawns" in m.value for m in at.markdown)
        at.text_area(key="past_notes").input("cold & calm")
        next(b for b in at.button if "Save past hunt" in b.label).click().run()
        assert not at.exception, [e.value for e in at.exception]
        assert any("form is clear" in s.value for s in at.success)
        assert at.text_area(key="past_notes").value == ""
        assert at.date_input(key="past_date").value != date(2025, 11, 8)
        assert at.session_state["past_sightings"] == []
    hunts = json.loads(pathlib.Path(".deercast_data/hunts.json").read_text())
    sg = hunts[0]["sightings"]
    assert hunts[0]["date"] == "2025-11-08" and len(sg) == 2 and sg[0]["group"] == sg[1]["group"]
    assert {(x["kind"], x["count"]) for x in sg} == {("Doe", 1), ("Fawn", 2)}


def test_rut_peak_follows_season():
    from deercast import scoring
    assert str(scoring.rut_peak_for("2025-11-08", 37.3)) == "2025-11-14"
    assert str(scoring.rut_peak_for("2027-01-05", 37.3)) == "2026-11-14"


def test_login_persists_via_url_token():
    import sys
    sys.path.insert(0, str(ROOT))
    with mock.patch("deercast.weather.fetch_hourly", fake_hourly):
        at = AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=60)
        at.secrets["APP_PASSWORD"] = "buck"
        at.run()
        assert at.text_input[0].label == "Password"
        at.text_input[0].input("buck").run()
        tok = at.query_params["k"][0] if isinstance(at.query_params["k"], list) else at.query_params["k"]
        assert tok and at.session_state["authed"]
        # brand-new session (e.g. Safari reconnect) with the token in the URL → no password prompt
        at2 = AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=60)
        at2.secrets["APP_PASSWORD"] = "buck"
        at2.query_params["k"] = tok
        at2.run()
        assert not any(t.label == "Password" for t in at2.text_input)
        # wrong token → prompt
        at3 = AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=60)
        at3.secrets["APP_PASSWORD"] = "buck"
        at3.query_params["k"] = "nope"
        at3.run()
        assert any(t.label == "Password" for t in at3.text_input)


def test_gear_page_and_shot_integration():
    import contextlib, json, pathlib
    pathlib.Path(".deercast_data").mkdir(exist_ok=True)
    pathlib.Path(".deercast_data/gear.json").write_text(json.dumps({"active": "g1", "setups": [
        {"id": "g1", "name": "Light bow", "bow_type": "Compound", "rated_fps": 300, "draw_weight": 45,
         "draw_length": 27, "arrow_gr": 300, "tip_type": "Mechanical / expandable broadhead", "string_gr": 10}]}))
    with contextlib.ExitStack() as stack:
        for p in _patched():
            stack.enter_context(p)
        stack.enter_context(mock.patch("deercast.recovery.fetch_elevations", lambda pts: None))
        stack.enter_context(mock.patch("deercast.recovery.fetch_osm_features", lambda lat, lon, r: None))
        at = AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=60)
        at.run(); at.switch_page("app_pages/gear.py"); at.run()
        assert not at.exception, [e.value for e in at.exception]
        assert any("Low" in m.delta for m in at.metric if m.delta)
        at.switch_page("app_pages/track.py")
        at.session_state["shot_cross"] = (-13.5, 0.0)  # on the shoulder, broadside
        at.run()
        assert not at.exception, [e.value for e in at.exception]
        radio = next(r for r in at.radio if "shoulder bone" in r.label)
        assert radio.value.startswith("No, stopped")  # low bone rating → defaults to stopped
        at.selectbox(key="shot_arrow").set_value("Arrow stayed in deer / partial penetration").run()
        assert any("No exit hole" in i.value for i in at.info)


def test_gear_save_new_setup():
    with mock.patch("deercast.weather.fetch_hourly", fake_hourly):
        at = AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=60)
        at.run(); at.switch_page("app_pages/gear.py"); at.run()
        at.text_input[0].input("Hoyt")
        next(b for b in at.button if "Save setup" in b.label).click().run()
        assert not at.exception, [e.value for e in at.exception]
        assert at.selectbox(key="gear_pick").value == "Hoyt"
        assert any(m.label == "Arrow speed" for m in at.metric)
        assert any("Active setup" in s.value for s in at.success)


def test_sighting_location_recorded_and_mapped():
    import contextlib, json, pathlib
    from datetime import date, time as dtime
    pathlib.Path(".deercast_data").mkdir(exist_ok=True)
    pathlib.Path(".deercast_data/stands.json").write_text(json.dumps([
        {"id": "s1", "name": "Ridge", "lat": 37.30, "lon": -86.06, "type": "Ladder", "good_winds": ["N"]}]))
    with contextlib.ExitStack() as stack:
        for p in _patched():
            stack.enter_context(p)
        stack.enter_context(mock.patch("deercast.weather.fetch_hourly_range",
                                       lambda lat, lon, s, e: (synthetic_weather(TZ), TZ)))
        at = AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=60)
        at.run(); at.switch_page("app_pages/log.py"); at.run()
        at.selectbox(key="past_where").set_value("Stand: Ridge")
        at.date_input(key="past_date").set_value(date(2025, 11, 8))
        at.time_input(key="past_stime").set_value(dtime(7, 10))
        at.number_input(key="past_c_Buck").set_value(1)
        at.selectbox(key="past_g_dir").set_value("NE")
        at.number_input(key="past_g_dist").set_value(60)
        at.selectbox(key="past_g_from").set_value("N")
        at.selectbox(key="past_g_to").set_value("S")
        at.button(key="past_gadd").click().run()
        assert not at.exception, [e.value for e in at.exception]
        assert any("60 yd NE of stand · came from N · went S" in m.value for m in at.markdown)
        assert at.selectbox(key="past_g_dir").value == "—"  # cleared after Add
        next(b for b in at.button if "Save past hunt" in b.label).click().run()
        at.switch_page("app_pages/map.py"); at.run()
        assert not at.exception, [e.value for e in at.exception]
        assert any("1 logged sighting" in c.value for c in at.caption)
    sg = json.loads(pathlib.Path(".deercast_data/hunts.json").read_text())[0]["sightings"][0]
    assert sg["dir"] == "NE" and sg["dist_yd"] == 60 and sg["came_from"] == "N"
    assert sg["lat"] > 37.30 and sg["lon"] > -86.06  # NE of the stand


def test_edit_logged_hunt():
    import contextlib, json, pathlib
    from datetime import date, time as dtime
    pathlib.Path(".deercast_data").mkdir(exist_ok=True)
    pathlib.Path(".deercast_data/stands.json").write_text(json.dumps([
        {"id": "s1", "name": "Ridge", "lat": 37.30, "lon": -86.06}]))
    pathlib.Path(".deercast_data/hunts.json").write_text(json.dumps([{
        "id": "h1", "date": "2025-11-08", "stand": "Stand: Ridge", "lat": 37.30, "lon": -86.06,
        "start": "2025-11-08T06:15:00-06:00", "end": "2025-11-08T09:30:00-06:00", "notes": "", "harvest": False,
        "hours": [], "sightings": [
            {"time": "2025-11-08T07:10:00-06:00", "kind": "Doe", "count": 1, "group": "g1", "dir": "E", "dist_yd": 40},
            {"time": "2025-11-08T07:10:00-06:00", "kind": "Fawn", "count": 2, "group": "g1"}]}]))
    with contextlib.ExitStack() as stack:
        for p in _patched():
            stack.enter_context(p)
        stack.enter_context(mock.patch("deercast.weather.fetch_hourly_range",
                                       lambda lat, lon, s, e: (synthetic_weather(TZ), TZ)))
        at = AppTest.from_file(str(ROOT / "streamlit_app.py"), default_timeout=60)
        at.run(); at.switch_page("app_pages/log.py"); at.run()
        at.button(key="edit_h1").click().run()
        assert not at.exception, [e.value for e in at.exception]
        assert at.time_input(key="ed_start").value == dtime(6, 15)
        # fix times + date, add a buck, save
        at.time_input(key="ed_start").set_value(dtime(6, 0))
        at.time_input(key="ed_end").set_value(dtime(10, 15))
        at.date_input(key="ed_date").set_value(date(2025, 11, 9))
        at.run()
        at.time_input(key="ed_stime").set_value(dtime(8, 5))
        at.number_input(key="ed_c_Buck").set_value(1)
        at.button(key="ed_gadd").click().run()
        assert not at.exception, [e.value for e in at.exception]
        at.button(key="ed_save").click().run()
        assert not at.exception, [e.value for e in at.exception]
        assert any("Updated the Nov 9 hunt" in s.value for s in at.success)
        assert "ed_id" not in at.session_state
    h = json.loads(pathlib.Path(".deercast_data/hunts.json").read_text())[0]
    assert h["id"] == "h1" and h["start"].startswith("2025-11-09T06:00") and h["end"].startswith("2025-11-09T10:15")
    kinds = sorted((x["kind"], x["time"][:16]) for x in h["sightings"])
    assert kinds == [("Buck", "2025-11-09T08:05"), ("Doe", "2025-11-09T07:10"), ("Fawn", "2025-11-09T07:10")]
    doe = next(x for x in h["sightings"] if x["kind"] == "Doe")
    assert doe["lon"] > -86.06  # re-placed east of the stand
