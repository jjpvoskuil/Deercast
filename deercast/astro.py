"""Sun and moon calculations (offline, via PyEphem)."""

from __future__ import annotations

import math
from datetime import datetime, timezone

import ephem
import pandas as pd

def _observer(lat: float, lon: float) -> ephem.Observer:
    o = ephem.Observer()
    o.lat, o.lon = str(lat), str(lon)
    o.pressure = 0  # use horizon convention below rather than refraction model
    o.horizon = "-0:34"
    return o


def _to_utc(d: ephem.Date) -> pd.Timestamp:
    return pd.Timestamp(ephem.Date(d).datetime().replace(tzinfo=timezone.utc))


def moon_phase(when_utc: datetime) -> dict:
    """Illumination (0-1), waxing flag, phase name and emoji for a UTC instant."""
    d = ephem.Date(when_utc)
    m = ephem.Moon(d)
    illum = m.phase / 100.0
    waxing = ephem.next_full_moon(d) < ephem.next_new_moon(d)
    if illum < 0.02:
        name, emoji = "New Moon", "🌑"
    elif illum > 0.98:
        name, emoji = "Full Moon", "🌕"
    elif illum < 0.35:
        name, emoji = ("Waxing Crescent", "🌒") if waxing else ("Waning Crescent", "🌘")
    elif illum < 0.65:
        name, emoji = ("First Quarter", "🌓") if waxing else ("Last Quarter", "🌗")
    else:
        name, emoji = ("Waxing Gibbous", "🌔") if waxing else ("Waning Gibbous", "🌖")
    return {"illum": illum, "waxing": waxing, "name": name, "emoji": emoji}


def daily_astro(lat: float, lon: float, dates: list, tz: str) -> pd.DataFrame:
    """Per local date: sunrise, sunset, moon phase, and solunar event times (local tz).

    Solunar events: moon transit (overhead) and anti-transit (underfoot) = "major";
    moonrise / moonset = "minor".
    """
    rows = []
    for d in dates:
        local_midnight = pd.Timestamp(d).tz_localize(tz)
        start = local_midnight.tz_convert("UTC").to_pydatetime()
        o = _observer(lat, lon)
        o.date = ephem.Date(start)
        sun, moon = ephem.Sun(), ephem.Moon()

        def nxt(fn, body):
            try:
                t = _to_utc(fn(body, start=ephem.Date(start)))
                return t.tz_convert(tz) if t < (local_midnight + pd.Timedelta(days=1)).tz_convert("UTC") else None
            except (ephem.AlwaysUpError, ephem.NeverUpError):
                return None

        sunrise = nxt(o.next_rising, sun)
        sunset = nxt(o.next_setting, sun)
        majors = [t for t in (nxt(o.next_transit, moon), nxt(o.next_antitransit, moon)) if t is not None]
        minors = [t for t in (nxt(o.next_rising, moon), nxt(o.next_setting, moon)) if t is not None]
        noon_utc = (local_midnight + pd.Timedelta(hours=12)).tz_convert("UTC").to_pydatetime()
        ph = moon_phase(noon_utc)
        rows.append(
            {
                "date": pd.Timestamp(d).date(),
                "sunrise": sunrise,
                "sunset": sunset,
                "moon_illum": ph["illum"],
                "moon_waxing": ph["waxing"],
                "moon_name": ph["name"],
                "moon_emoji": ph["emoji"],
                "solunar_major": majors,
                "solunar_minor": minors,
            }
        )
    return pd.DataFrame(rows).set_index("date")


def sun_altitude_deg(lat: float, lon: float, when_utc: datetime) -> float:
    o = _observer(lat, lon)
    o.date = ephem.Date(when_utc)
    s = ephem.Sun(o)
    return math.degrees(float(s.alt))
