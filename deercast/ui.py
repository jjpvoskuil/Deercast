"""Shared Streamlit helpers: storage, location state, cached data fetches."""

from __future__ import annotations

import uuid
from datetime import datetime

import pandas as pd
import streamlit as st

from . import geo, scoring, weather
from .storage import make_store

# Home area: Cub Run, Hart County, KY (town center — not a stand location).
DEFAULT_LOCATION = geo.Location(lat=37.3006, lon=-86.0608, label="Cub Run, Hart Co., KY", state="KY", zip_code="42729")
DEFAULT_COUNTY = "Hart"


@st.cache_resource
def get_store():
    try:
        return make_store(st.secrets)
    except Exception:
        return make_store(None)


def load(name: str, default):
    key = f"_data_{name}"
    if key not in st.session_state:
        try:
            st.session_state[key] = get_store().get(name, default)
        except Exception as e:  # network / auth problems shouldn't kill the page
            st.error(f"Couldn't load {name}: {e}")
            st.session_state[key] = default
    return st.session_state[key]


def save(name: str, obj, message: str = "") -> bool:
    try:
        get_store().put(name, obj, message)
        st.session_state[f"_data_{name}"] = obj
        return True
    except Exception as e:
        st.error(f"Couldn't save {name}: {e}")
        return False


def new_id() -> str:
    return uuid.uuid4().hex[:8]


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def get_location() -> geo.Location:
    if "location" not in st.session_state:
        st.session_state.location = DEFAULT_LOCATION
    return st.session_state.location


def set_location(loc: geo.Location) -> None:
    st.session_state.location = loc


@st.cache_data(ttl=3600, show_spinner="Fetching 14-day weather forecast…")
def cached_hourly(lat: float, lon: float):
    return weather.fetch_hourly(round(lat, 3), round(lon, 3), days=15)


@st.cache_data(ttl=600, show_spinner=False)
def cached_current_wind(lat: float, lon: float):
    return weather.fetch_current_wind(round(lat, 3), round(lon, 3))


@st.cache_data(ttl=1800, show_spinner=False)
def cached_hourly_wind(lat: float, lon: float):
    return weather.fetch_hourly_wind(round(lat, 3), round(lon, 3), hours=48)


@st.cache_data(ttl=86400)
def cached_zip(z: str):
    return geo.geocode_zip(z)


def location_picker(container=st.sidebar) -> geo.Location:
    """ZIP entry + stand quick-pick; map pins are set on the Map page."""
    loc = get_location()
    with container:
        st.markdown(f"**📍 {loc.label}**")
        st.caption(f"{loc.lat:.4f}, {loc.lon:.4f}")
        with st.form("zip_form", clear_on_submit=True, border=False):
            z = st.text_input("ZIP code", placeholder="e.g. 42729", max_chars=5)
            if st.form_submit_button("Use ZIP", width="stretch") and z:
                try:
                    set_location(cached_zip(z))
                    st.rerun()
                except ValueError as e:
                    st.error(str(e))
        stands = load("stands", [])
        if stands:
            names = ["—"] + [s["name"] for s in stands]
            pick = st.selectbox("…or a stand", names, key="stand_pick")
            if pick != "—" and st.button("Forecast this stand", width="stretch"):
                s = next(s for s in stands if s["name"] == pick)
                set_location(geo.Location(s["lat"], s["lon"], f"Stand: {s['name']}"))
                st.rerun()
        if (loc.lat, loc.lon) != (DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon):
            if st.button(f"🏠 Back to home ({DEFAULT_COUNTY} Co.)", width="stretch"):
                set_location(DEFAULT_LOCATION)
                st.session_state.pop("map_center", None)
                st.rerun()
        st.caption("Tip: tap the map on the 🗺️ Map page to forecast any pin.")
    return get_location()


def rut_peak_setting(lat: float, container=st.sidebar):
    default = scoring.rut_peak_for(pd.Timestamp.now(), lat)
    with container:
        override = st.date_input(
            "Peak breeding (rut) date",
            value=st.session_state.get("rut_peak", default),
            help="Defaults by latitude. Use your state wildlife agency's peak breeding date for best results "
            "(southern states vary widely).",
        )
    st.session_state.rut_peak = override
    return override


# ---------------------------------------------------------------- charts
# Red = poor conditions → green = best (John's preference).
SCORE_COLORSCALE = [[0.0, "#8b1a14"], [0.25, "#d7261e"], [0.45, "#e07b24"], [0.6, "#e9c46a"], [0.8, "#8cc152"],
                    [1.0, "#1f8a3e"]]
PLOTLY_CONFIG = {"displayModeBar": False, "scrollZoom": False, "doubleClick": False, "showTips": False}


def score_color(score: float) -> str:
    """Hex color for a 0–10 score on SCORE_COLORSCALE."""
    import plotly.colors as pc

    return pc.sample_colorscale(SCORE_COLORSCALE, [max(0.0, min(1.0, score / 10))], colortype="rgb")[0]


def lock_figure(fig, height: int | None = None):
    """Fixed charts: no zoom/pan/rescale on touch — tap still shows values."""
    fig.update_layout(dragmode=False, margin=dict(l=0, r=0, t=10, b=0), **({"height": height} if height else {}))
    fig.update_xaxes(fixedrange=True)
    fig.update_yaxes(fixedrange=True)
    return fig


def html_frame(html: str, height: int):
    """Embed our own (trusted) HTML+JS. Uses st.iframe on newer Streamlit, components.html on older."""
    if hasattr(st, "iframe"):
        return st.iframe(html, height=height)
    import streamlit.components.v1 as components  # pragma: no cover

    return components.html(html, height=height)
