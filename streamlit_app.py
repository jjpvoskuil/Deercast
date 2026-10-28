"""Deercast — whitetail deer activity forecast. Entry point for Streamlit.

Sign-in:
- Google sign-in when an `[auth]` section (client_id/secret, redirect_uri, cookie_secret, server_metadata_url) is in
  Streamlit secrets. Only emails listed in users.json may use the app; ADMIN_EMAILS from secrets are always admins.
- Otherwise falls back to the shared APP_PASSWORD (single owner — the first admin email, or 'local').
"""

import hashlib
import hmac
from pathlib import Path

import streamlit as st

from deercast import __version__, accounts, ui

st.set_page_config(page_title="Deercast", page_icon=str(Path(__file__).parent / "static" / "favicon.png"),
                   layout="wide", initial_sidebar_state="collapsed")

TOKEN_PARAM = "k"


def _secret(key, default=None):
    try:
        return st.secrets.get(key, default)
    except Exception:
        return default


def admin_emails() -> list[str]:
    raw = _secret("ADMIN_EMAILS") or _secret("ADMIN_EMAIL") or []
    if isinstance(raw, str):
        raw = [x for x in raw.replace(";", ",").split(",")]
    return [accounts.norm_email(x) for x in raw if str(x).strip()]


def google_configured() -> bool:
    try:
        a = st.secrets.get("auth")
        return bool(a and a.get("client_id") and a.get("redirect_uri"))
    except Exception:
        return False


def login_token(pw: str) -> str:
    """Signed token kept in the URL so a reconnect (Safari backgrounded, phone locked) stays logged in."""
    return hmac.new(str(pw).encode(), b"deercast-login-v1", hashlib.sha256).hexdigest()[:24]


def check_password() -> bool:
    """Shared-password gate (used until Google sign-in is configured)."""
    pw = _secret("APP_PASSWORD")
    if not pw:
        return True
    tok = login_token(pw)
    if not st.session_state.get("authed") and hmac.compare_digest(st.query_params.get(TOKEN_PARAM, ""), tok):
        st.session_state.authed = True
    if st.session_state.get("authed"):
        if st.query_params.get(TOKEN_PARAM) != tok:
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


def sign_in() -> tuple[str, str] | None:
    """Returns (email, display name) of the signed-in person, or None after drawing the sign-in screen."""
    if google_configured():
        if not st.user.is_logged_in:
            st.title("🦌 Deercast")
            st.caption("Whitetail activity forecasts, stand maps and hunt logs.")
            st.button("Sign in with Google", type="primary", width="stretch", on_click=st.login)
            return None
        return accounts.norm_email(st.user.email), (st.user.get("name") or st.user.email)
    if not check_password():
        return None
    admins = admin_emails()
    return (admins[0] if admins else accounts.LOCAL_EMAIL), "Owner"


def setup_account(email: str, google_name: str) -> bool:
    """Bootstrap admins, one-time data migration, and the allow-list check. Returns True if allowed in."""
    store = ui.get_store()
    users = store.get("users", {}) or {}
    admins = admin_emails() or ([email] if not google_configured() else [])
    users, changed = accounts.bootstrap_users(users, admins)
    if changed:
        store.put("users", users, "Users: admins from secrets")
    if email in admins and email != accounts.LOCAL_EMAIL and accounts.claim_local(store, email):
        users = store.get("users", {}) or {}
    if email in admins and store.get("grounds", None) is None:
        home = {"lat": ui.DEFAULT_LOCATION.lat, "lon": ui.DEFAULT_LOCATION.lon, "state": "KY",
                "zip": ui.DEFAULT_LOCATION.zip_code}
        accounts.migrate_legacy(store, email, _secret("FIRST_GROUND_NAME", "Lewis/Klein Property"), home)
        users = store.get("users", {}) or {}
    rec = users.get(email)
    if rec is None:
        return False
    if google_name and rec.get("name") in (None, "", email.split("@")[0]) and google_name != email:
        rec["name"] = google_name
        store.put("users", users, f"Users: name for {email}")
    st.session_state.identity = {"email": email, "name": rec.get("name") or email, "role": rec.get("role", "user")}
    for k in [k for k in st.session_state.keys() if str(k).startswith(("_data_users", "_data_grounds", "_t_"))]:
        del st.session_state[k]
    return True


ui.add_home_screen_tags()
who = sign_in()
if who is None:
    st.stop()
email, gname = who
if st.session_state.get("_acct_for") != email:
    if not setup_account(email, gname):
        st.title("🦌 Deercast")
        st.warning(f"**{email}** isn't set up for Deercast yet. Ask the app owner to add you on the Grounds page.")
        st.button("Sign out", on_click=st.logout)
        st.stop()
    st.session_state._acct_for = email

# ---------------------------------------------------------------- hunting ground
if (pending := st.session_state.pop("_ground_next", None)):
    ui.set_ground(pending)
mine = ui.my_grounds()
if "ground_id" not in st.session_state and mine:
    last = (ui.load("users", {}) or {}).get(email, {}).get("last_ground")
    ui.set_ground(last if any(g["id"] == last for g in mine) else mine[0]["id"], remember=False)

pages = [
    st.Page("app_pages/forecast.py", title="Forecast", icon="📈", default=True),
    st.Page("app_pages/map.py", title="Map & Wind", icon="🗺️"),
    st.Page("app_pages/log.py", title="Hunt Log", icon="🗒️"),
    st.Page("app_pages/track.py", title="Shot & Recovery", icon="🎯"),
    st.Page("app_pages/gear.py", title="Bow Setup", icon="🏹"),
    st.Page("app_pages/regs.py", title="Regulations", icon="📜"),
    st.Page("app_pages/grounds.py", title="Grounds", icon="🏞️"),
]
if ui.is_admin():
    pages.append(st.Page("app_pages/dev.py", title="Development", icon="🛠️"))
nav = st.navigation(pages, position="top")

g = ui.current_ground()
with st.popover(f"🏞️ {g['name'] if g else 'No hunting ground yet'}"):
    if mine:
        ids = [x["id"] for x in mine]
        pick = st.radio("Hunting ground", ids, index=ids.index(g["id"]) if g else 0,
                        format_func=lambda i: next(x["name"] for x in mine if x["id"] == i)
                        + ("" if next(x for x in mine if x["id"] == i)["owner"] == email else " (shared)"),
                        key=f"ground_pick_{g['id'] if g else 'none'}")
        if g and pick != g["id"]:
            st.session_state._ground_next = pick
            st.rerun()
    st.page_link("app_pages/grounds.py", label="Manage grounds & members", icon="⚙️")

me = ui.identity()
st.sidebar.markdown(f"👤 **{me['name']}**" + (" · admin" if ui.is_admin() else ""))
st.sidebar.caption(f"Deercast v{__version__}")
if google_configured():
    st.sidebar.button("Sign out", on_click=st.logout)
elif _secret("APP_PASSWORD") and st.sidebar.button("Log out"):
    st.session_state.authed = False
    st.query_params.clear()
    st.rerun()
nav.run()
