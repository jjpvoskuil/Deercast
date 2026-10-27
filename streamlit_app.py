"""Deercast — whitetail deer activity forecast. Entry point for Streamlit."""

import hmac

import streamlit as st

from deercast import __version__

st.set_page_config(page_title="Deercast", page_icon="🦌", layout="wide", initial_sidebar_state="collapsed")


def check_password() -> bool:
    """Simple shared-password gate. Set APP_PASSWORD in Streamlit secrets to enable."""
    try:
        pw = st.secrets.get("APP_PASSWORD")
    except Exception:
        pw = None
    if not pw or st.session_state.get("authed"):
        return True
    st.title("🦌 Deercast")
    entered = st.text_input("Password", type="password")
    if entered:
        if hmac.compare_digest(entered, str(pw)):
            st.session_state.authed = True
            st.rerun()
        st.error("Incorrect password")
    return False


if not check_password():
    st.stop()

pages = [
    st.Page("app_pages/forecast.py", title="Forecast", icon="📈", default=True),
    st.Page("app_pages/map.py", title="Map & Wind", icon="🗺️"),
    st.Page("app_pages/dev.py", title="Development", icon="🛠️"),
]
nav = st.navigation(pages, position="top")
st.sidebar.caption(f"Deercast v{__version__}")
nav.run()
