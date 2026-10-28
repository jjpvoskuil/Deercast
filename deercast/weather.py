"""Weather data from Open-Meteo (free, no API key, up to 16-day hourly forecasts)."""

from __future__ import annotations

import pandas as pd
import requests

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
# Bump whenever the columns/meaning of fetched weather change — cached forecasts keyed on it are refetched.
SCHEMA = 2  # 2 = low/mid/high cloud + sky_pct (v0.6.3)
TIMEOUT = 15
HPA_TO_INHG = 0.0295300

HOURLY_VARS = [
    "temperature_2m",
    "precipitation",
    "precipitation_probability",
    "cloud_cover",
    "cloud_cover_low",
    "cloud_cover_mid",
    "cloud_cover_high",
    "pressure_msl",
    "wind_speed_10m",
    "wind_direction_10m",
    "wind_gusts_10m",
    "weather_code",
]
CURRENT_VARS = ["temperature_2m", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"]


def _params(lat: float, lon: float, **extra) -> dict:
    p = {
        "latitude": lat,
        "longitude": lon,
        "temperature_unit": "fahrenheit",
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": "auto",
        "timeformat": "unixtime",
    }
    p.update(extra)
    return p


def fetch_hourly(lat: float, lon: float, days: int = 15) -> tuple[pd.DataFrame, str]:
    """Hourly forecast (plus the previous day, needed for 24h trends).

    Returns (df indexed by tz-aware local time, IANA timezone name).
    Units: °F, mph, inches, inHg.
    """
    r = requests.get(
        FORECAST_URL,
        params=_params(lat, lon, hourly=",".join(HOURLY_VARS), forecast_days=days, past_days=1),
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    data = r.json()
    tz = data.get("timezone", "UTC")
    h = data["hourly"]
    idx = pd.to_datetime(h.pop("time"), unit="s", utc=True).tz_convert(tz)
    df = pd.DataFrame(h, index=idx)
    df = df.rename(
        columns={
            "temperature_2m": "temp_f",
            "precipitation": "precip_in",
            "precipitation_probability": "precip_prob",
            "cloud_cover": "cloud_pct",
            "cloud_cover_low": "cloud_low_pct",
            "cloud_cover_mid": "cloud_mid_pct",
            "cloud_cover_high": "cloud_high_pct",
            "pressure_msl": "pressure_hpa",
            "wind_speed_10m": "wind_mph",
            "wind_direction_10m": "wind_dir",
            "wind_gusts_10m": "gust_mph",
        }
    )
    df["pressure_inhg"] = df["pressure_hpa"] * HPA_TO_INHG
    return add_sky(df), tz


def add_sky(df: pd.DataFrame) -> pd.DataFrame:
    """sky_pct = low + mid cloud combined (what actually darkens the woods). High cirrus is excluded — it pushes
    'total cloud cover' to 100% while stars still show through at night."""
    if "cloud_low_pct" in df and "cloud_mid_pct" in df:
        lo = df["cloud_low_pct"].fillna(0).clip(0, 100) / 100
        mid = df["cloud_mid_pct"].fillna(0).clip(0, 100) / 100
        df["sky_pct"] = (100 * (1 - (1 - lo) * (1 - mid))).round(0)
    else:
        df["sky_pct"] = df.get("cloud_pct")
    if "cloud_high_pct" not in df:
        df["cloud_high_pct"] = float("nan")
    return df


ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"


def _frame(data: dict) -> tuple[pd.DataFrame, str]:
    tz = data.get("timezone", "UTC")
    h = data["hourly"]
    idx = pd.to_datetime(h.pop("time"), unit="s", utc=True).tz_convert(tz)
    df = pd.DataFrame(h, index=idx).rename(
        columns={
            "temperature_2m": "temp_f", "precipitation": "precip_in", "precipitation_probability": "precip_prob",
            "cloud_cover": "cloud_pct", "cloud_cover_low": "cloud_low_pct", "cloud_cover_mid": "cloud_mid_pct",
            "cloud_cover_high": "cloud_high_pct", "pressure_msl": "pressure_hpa", "wind_speed_10m": "wind_mph",
            "wind_direction_10m": "wind_dir", "wind_gusts_10m": "gust_mph",
        }
    )
    if "precip_prob" not in df:
        df["precip_prob"] = (df["precip_in"] > 0.01) * 100.0
    df["pressure_inhg"] = df["pressure_hpa"] * HPA_TO_INHG
    return add_sky(df), tz


def fetch_hourly_range(lat: float, lon: float, start_date, end_date) -> tuple[pd.DataFrame, str]:
    """Hourly weather for a past date range (for scoring logged hunts).

    Uses the forecast API (covers roughly the last 3 months) and falls back to the historical archive.
    `start_date` should be the day BEFORE the hunt so 24 h trends can be computed.
    """
    s, e = pd.Timestamp(start_date).date().isoformat(), pd.Timestamp(end_date).date().isoformat()
    try:
        r = requests.get(FORECAST_URL, params=_params(lat, lon, hourly=",".join(HOURLY_VARS), start_date=s,
                                                      end_date=e), timeout=TIMEOUT)
        r.raise_for_status()
        return _frame(r.json())
    except Exception:
        archive_vars = [v for v in HOURLY_VARS if v != "precipitation_probability"]
        r = requests.get(ARCHIVE_URL, params=_params(lat, lon, hourly=",".join(archive_vars), start_date=s,
                                                     end_date=e), timeout=TIMEOUT)
        r.raise_for_status()
        return _frame(r.json())


def fetch_current_wind(lat: float, lon: float) -> dict:
    """Current conditions: wind speed (mph), direction wind is FROM (deg), gusts, temp."""
    r = requests.get(FORECAST_URL, params=_params(lat, lon, current=",".join(CURRENT_VARS)), timeout=TIMEOUT)
    r.raise_for_status()
    c = r.json()["current"]
    return {
        "time": pd.to_datetime(c["time"], unit="s", utc=True),
        "temp_f": c["temperature_2m"],
        "wind_mph": c["wind_speed_10m"],
        "wind_dir": c["wind_direction_10m"],
        "gust_mph": c["wind_gusts_10m"],
    }


def fetch_hourly_wind(lat: float, lon: float, hours: int = 48) -> pd.DataFrame:
    """Next N hours of wind for the scent planner."""
    r = requests.get(
        FORECAST_URL,
        params=_params(
            lat, lon, hourly="wind_speed_10m,wind_direction_10m,wind_gusts_10m", forecast_hours=hours
        ),
        timeout=TIMEOUT,
    )
    r.raise_for_status()
    data = r.json()
    h = data["hourly"]
    idx = pd.to_datetime(h.pop("time"), unit="s", utc=True).tz_convert(data.get("timezone", "UTC"))
    return pd.DataFrame(h, index=idx).rename(
        columns={"wind_speed_10m": "wind_mph", "wind_direction_10m": "wind_dir", "wind_gusts_10m": "gust_mph"}
    )


CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"]
CARDINALS_8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def deg_to_cardinal(deg: float, points: int = 16) -> str:
    names = CARDINALS if points == 16 else CARDINALS_8
    step = 360 / len(names)
    return names[int(((deg % 360) + step / 2) // step) % len(names)]
