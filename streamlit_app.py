"""Deercast — whitetail deer activity forecast. Entry point for Streamlit."""

import hmac

import streamlit as st

from deercast import __version__

st.set_page_config(page_title="Deercast", page_icon="🦌", layout="wide", initial_sidebar_state="collapsed")


import hashlib  # noqa: E402

TOKEN_PARAM = "k"


def _app_password():
    try:
        return st.secrets.get("APP_PASSWORD")
    except Exception:
        return None


def login_token(pw: str) -> str:
    """Signed token kept in the URL so a reconnect (Safari backgrounded, phone locked) stays logged in.
    Changing APP_PASSWORD invalidates every old token."""
    return hmac.new(str(pw).encode(), b"deercast-login-v1", hashlib.sha256).hexdigest()[:24]


def check_password() -> bool:
    """Shared-password gate. Set APP_PASSWORD in Streamlit secrets to enable."""
    pw = _app_password()
    if not pw:
        return True
    tok = login_token(pw)
    if not st.session_state.get("authed") and hmac.compare_digest(st.query_params.get(TOKEN_PARAM, ""), tok):
        st.session_state.authed = True
    if st.session_state.get("authed"):
        if st.query_params.get(TOKEN_PARAM) != tok:  # keep the token on every page's URL
            st.query_params[TOKEN_PARAM] = tok
        return True
    st.title("🦌 Deercast")
    entered = st.text_input("Password", type="password")
    if entered:
        if hmac.compare_digest(entered, str(pw)):
            st.session_state.authed = True
            st.query_params[TOKEN_PARAM] = tok
            st.rerun()
        st.error("Incorrect password")
    return False


if not check_password():
    st.stop()

pages = [
    st.Page("app_pages/forecast.py", title="Forecast", icon="📈", default=True),
    st.Page("app_pages/map.py", title="Map & Wind", icon="🗺️"),
    st.Page("app_pages/log.py", title="Hunt Log", icon="🗒️"),
    st.Page("app_pages/track.py", title="Shot & Recovery", icon="🎯"),
    st.Page("app_pages/regs.py", title="Regulations", icon="📜"),
    st.Page("app_pages/dev.py", title="Development", icon="🛠️"),
]
nav = st.navigation(pages, position="top")
st.sidebar.caption(f"Deercast v{__version__}")
if _app_password() and st.sidebar.button("Log out"):
    st.session_state.authed = False
    st.query_params.clear()
    st.rerun()
nav.run()
