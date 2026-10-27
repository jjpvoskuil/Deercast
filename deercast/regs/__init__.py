"""Hunting regulations data. Curated per state; verify against the official guide."""

from __future__ import annotations

import requests

from . import kentucky

CURATED = {"KY": kentucky}

STATE_AGENCIES = {
    "AL": ("Alabama", "Alabama DCNR – Wildlife & Freshwater Fisheries"),
    "AR": ("Arkansas", "Arkansas Game & Fish Commission"),
    "AZ": ("Arizona", "Arizona Game & Fish Department"),
    "CA": ("California", "California Dept. of Fish & Wildlife"),
    "CO": ("Colorado", "Colorado Parks & Wildlife"),
    "CT": ("Connecticut", "Connecticut DEEP Wildlife Division"),
    "DE": ("Delaware", "Delaware Division of Fish & Wildlife"),
    "FL": ("Florida", "Florida Fish & Wildlife Conservation Commission"),
    "GA": ("Georgia", "Georgia DNR Wildlife Resources Division"),
    "IA": ("Iowa", "Iowa DNR"),
    "ID": ("Idaho", "Idaho Fish & Game"),
    "IL": ("Illinois", "Illinois DNR"),
    "IN": ("Indiana", "Indiana DNR Fish & Wildlife"),
    "KS": ("Kansas", "Kansas Dept. of Wildlife & Parks"),
    "KY": ("Kentucky", "Kentucky Dept. of Fish & Wildlife Resources"),
    "LA": ("Louisiana", "Louisiana Dept. of Wildlife & Fisheries"),
    "MA": ("Massachusetts", "MassWildlife"),
    "MD": ("Maryland", "Maryland DNR Wildlife & Heritage Service"),
    "ME": ("Maine", "Maine Dept. of Inland Fisheries & Wildlife"),
    "MI": ("Michigan", "Michigan DNR"),
    "MN": ("Minnesota", "Minnesota DNR"),
    "MO": ("Missouri", "Missouri Dept. of Conservation"),
    "MS": ("Mississippi", "Mississippi Dept. of Wildlife, Fisheries & Parks"),
    "MT": ("Montana", "Montana Fish, Wildlife & Parks"),
    "NC": ("North Carolina", "NC Wildlife Resources Commission"),
    "ND": ("North Dakota", "North Dakota Game & Fish"),
    "NE": ("Nebraska", "Nebraska Game & Parks"),
    "NH": ("New Hampshire", "New Hampshire Fish & Game"),
    "NJ": ("New Jersey", "NJ Division of Fish & Wildlife"),
    "NM": ("New Mexico", "New Mexico Dept. of Game & Fish"),
    "NV": ("Nevada", "Nevada Dept. of Wildlife"),
    "NY": ("New York", "NY DEC"),
    "OH": ("Ohio", "Ohio DNR Division of Wildlife"),
    "OK": ("Oklahoma", "Oklahoma Dept. of Wildlife Conservation"),
    "OR": ("Oregon", "Oregon Dept. of Fish & Wildlife"),
    "PA": ("Pennsylvania", "Pennsylvania Game Commission"),
    "RI": ("Rhode Island", "Rhode Island DEM Fish & Wildlife"),
    "SC": ("South Carolina", "South Carolina DNR"),
    "SD": ("South Dakota", "South Dakota Game, Fish & Parks"),
    "TN": ("Tennessee", "Tennessee Wildlife Resources Agency"),
    "TX": ("Texas", "Texas Parks & Wildlife"),
    "UT": ("Utah", "Utah Division of Wildlife Resources"),
    "VA": ("Virginia", "Virginia Dept. of Wildlife Resources"),
    "VT": ("Vermont", "Vermont Fish & Wildlife"),
    "WA": ("Washington", "Washington Dept. of Fish & Wildlife"),
    "WI": ("Wisconsin", "Wisconsin DNR"),
    "WV": ("West Virginia", "West Virginia DNR"),
    "WY": ("Wyoming", "Wyoming Game & Fish"),
}


def county_for_point(lat: float, lon: float) -> dict:
    """{'county': 'Hart', 'state': 'KY', 'fips': '21099'} via the FCC Census Block API (free, no key)."""
    r = requests.get(
        "https://geo.fcc.gov/api/census/block/find",
        params={"latitude": lat, "longitude": lon, "format": "json", "showall": "false"},
        timeout=10,
    )
    r.raise_for_status()
    d = r.json()
    name = (d.get("County") or {}).get("name") or ""
    for suffix in (" County", " Parish", " Borough"):
        if name.endswith(suffix):
            name = name[: -len(suffix)]
    return {"county": name or None, "state": (d.get("State") or {}).get("code"), "fips": (d.get("County") or {}).get("FIPS")}
