"""Location helpers: US ZIP code geocoding."""

from __future__ import annotations

from dataclasses import dataclass

import requests

TIMEOUT = 10


@dataclass
class Location:
    lat: float
    lon: float
    label: str
    state: str | None = None
    zip_code: str | None = None


def geocode_zip(zip_code: str) -> Location:
    """Resolve a 5-digit US ZIP to a lat/lon centroid.

    Primary: zippopotam.us (free, no key). Fallback: Open-Meteo geocoding.
    Raises ValueError if the ZIP can't be resolved.
    """
    z = zip_code.strip()[:5]
    if not (len(z) == 5 and z.isdigit()):
        raise ValueError("Enter a 5-digit US ZIP code.")

    try:
        r = requests.get(f"https://api.zippopotam.us/us/{z}", timeout=TIMEOUT)
        if r.status_code == 200:
            data = r.json()
            place = data["places"][0]
            return Location(
                lat=float(place["latitude"]),
                lon=float(place["longitude"]),
                label=f"{place['place name']}, {place['state abbreviation']} {z}",
                state=place["state abbreviation"],
                zip_code=z,
            )
    except (requests.RequestException, KeyError, IndexError, ValueError):
        pass

    try:
        r = requests.get(
            "https://geocoding-api.open-meteo.com/v1/search",
            params={"name": z, "count": 5, "country_code": "US"},
            timeout=TIMEOUT,
        )
        for res in r.json().get("results", []) or []:
            if z in (res.get("postcodes") or []) or res.get("name") == z:
                return Location(
                    lat=res["latitude"],
                    lon=res["longitude"],
                    label=f"{res.get('name')}, {res.get('admin1', '')} {z}",
                    state=None,
                    zip_code=z,
                )
    except (requests.RequestException, KeyError, ValueError):
        pass

    raise ValueError(f"Couldn't find ZIP code {z}.")


def pin_location(lat: float, lon: float) -> Location:
    return Location(lat=round(lat, 5), lon=round(lon, 5), label=f"Map pin {lat:.4f}, {lon:.4f}")
