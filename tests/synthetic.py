"""Synthetic hourly weather for tests (no network)."""
import numpy as np
import pandas as pd

from deercast.weather import add_sky


def synthetic_weather(tz="America/Chicago", days=15, front_day=5, seed=1):
    rng = np.random.default_rng(seed)
    start = pd.Timestamp.now(tz=tz).normalize() - pd.Timedelta(days=1)
    idx = pd.date_range(start, periods=24 * (days + 1), freq="h", tz=tz)
    n = len(idx)
    hour = idx.hour.to_numpy()
    diurnal = -8 * np.cos((hour - 3) / 24 * 2 * np.pi)
    base = np.full(n, 50.0)
    front = (np.arange(n) >= 24 * (front_day + 1))
    base[front] -= 14  # cold front
    temp = base + diurnal + rng.normal(0, 1, n)
    pres = np.full(n, 29.95)
    i0 = 24 * (front_day + 1)
    pres[i0 - 12:i0] = np.linspace(29.95, 29.75, 12)
    pres[i0:i0 + 18] = np.linspace(29.75, 30.25, 18)
    pres[i0 + 18:] = 30.25
    precip = np.zeros(n)
    precip[i0 - 6:i0] = 0.12
    return pd.DataFrame({
        "temp_f": temp, "precip_in": precip, "precip_prob": precip * 500,
        "cloud_pct": np.where(precip > 0, 100, np.where((hour < 6) | (hour > 19), 100, 30)),
        "cloud_low_pct": np.where(precip > 0, 90, 10), "cloud_mid_pct": np.where(precip > 0, 60, 15),
        "cloud_high_pct": np.where((hour < 6) | (hour > 19), 100, 20),  # thin cirrus overnight "pressure_hpa": pres / 0.02953,
        "pressure_inhg": pres, "wind_mph": 6 + 3 * rng.random(n), "wind_dir": 270.0,
        "gust_mph": 12.0, "weather_code": 0,
    }, index=idx).pipe(add_sky)
