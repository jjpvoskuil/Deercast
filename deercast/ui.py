"""Shared Streamlit helpers: storage, location state, cached data fetches."""

from __future__ import annotations

import uuid
from datetime import datetime

import pandas as pd
import streamlit as st

import time

from . import accounts, geo, scoring, weather
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


# ---------------------------------------------------------------- identity & grounds
def identity() -> dict:
    """{'email', 'name', 'role'} of whoever is using the app (set at login in streamlit_app.py)."""
    return st.session_state.get("identity") or {"email": accounts.LOCAL_EMAIL, "name": "Owner", "role": "admin"}


def current_email() -> str:
    return identity()["email"]


def is_admin() -> bool:
    return identity().get("role") == "admin"


def grounds() -> list:
    return load("grounds", []) or []


def my_grounds() -> list:
    return accounts.my_grounds(grounds(), current_email())


def current_ground() -> dict | None:
    gid = st.session_state.get("ground_id")
    mine = my_grounds()
    g = next((x for x in mine if x["id"] == gid), None)
    return g or (mine[0] if mine else None)


def ground_id() -> str | None:
    g = current_ground()
    return g["id"] if g else None


def ground_location(g: dict) -> geo.Location:
    h = g.get("home") or {}
    if "lat" not in h:
        return DEFAULT_LOCATION
    return geo.Location(lat=h["lat"], lon=h["lon"], label=h.get("label") or g["name"], state=h.get("state"),
                        zip_code=h.get("zip"))


def set_ground(gid: str, remember: bool = True) -> None:
    """Switch hunting ground: location jumps to its home, map recenters, choice remembered for next time."""
    st.session_state.ground_id = gid
    g = current_ground()
    if g:
        set_location(ground_location(g))
    st.session_state.pop("map_center", None)
    st.session_state.pop("last_click", None)
    if remember and current_email() != accounts.LOCAL_EMAIL:
        users = load("users", {}) or {}
        u = users.get(current_email())
        if u is not None and u.get("last_ground") != gid:
            u["last_ground"] = gid
            save("users", users, "Remember last ground")


def _path(name: str) -> str:
    if name in accounts.GROUND_SCOPED:
        return accounts.path_for(name, None, ground_id())
    if name in accounts.USER_SCOPED:
        return accounts.path_for(name, current_email(), None)
    return name  # app-wide files (users, grounds, punchlist) — no ground lookup (avoids recursion)


SHARED_REFRESH_S = 90  # re-read shared (ground) data this often so members see each other's changes


def load(name: str, default):
    """Read a data file. Stands/features resolve to the current ground; hunts/gear/shots to the current user."""
    if name in accounts.GROUND_SCOPED and not ground_id():
        return default
    path = _path(name)
    key = f"_data_{path}"
    stale = (name in accounts.GROUND_SCOPED or name == "grounds") and \
        time.time() - st.session_state.get(f"_t_{path}", 0) > SHARED_REFRESH_S
    if key not in st.session_state or stale:
        try:
            st.session_state[key] = get_store().get(path, default)
            st.session_state[f"_t_{path}"] = time.time()
        except Exception as e:  # network / auth problems shouldn't kill the page
            st.error(f"Couldn't load {name}: {e}")
            st.session_state.setdefault(key, default)
    return st.session_state[key]


def save(name: str, obj, message: str = "") -> bool:
    try:
        path = _path(name)
        who = identity().get("name") or current_email()
        get_store().put(path, obj, f"{message} ({who})" if message else "")
        st.session_state[f"_data_{path}"] = obj
        st.session_state[f"_t_{path}"] = time.time()
        return True
    except Exception as e:
        st.error(f"Couldn't save {name}: {e}")
        return False


def load_path(path: str, default):
    """Raw read of any stored file (used to gather other members' hunts on a shared ground)."""
    key = f"_data_{path}"
    if key not in st.session_state or time.time() - st.session_state.get(f"_t_{path}", 0) > SHARED_REFRESH_S:
        try:
            st.session_state[key] = get_store().get(path, default)
            st.session_state[f"_t_{path}"] = time.time()
        except Exception:
            st.session_state.setdefault(key, default)
    return st.session_state[key]


def ground_hunts() -> list:
    """Every member's logged hunts on the current ground (for the shared sightings map and Best stand history)."""
    g = current_ground()
    if not g:
        return []
    out = []
    for m in g.get("members", []):
        hs = load("hunts", []) if m == current_email() else load_path(accounts.path_for("hunts", m, None), [])
        out += [h for h in (hs or []) if h.get("ground_id") == g["id"]]
    return out


def new_id() -> str:
    return uuid.uuid4().hex[:8]


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def get_location() -> geo.Location:
    if "location" not in st.session_state:
        g = current_ground()
        st.session_state.location = ground_location(g) if g else DEFAULT_LOCATION
    return st.session_state.location


def set_location(loc: geo.Location) -> None:
    st.session_state.location = loc


@st.cache_data(ttl=3600, show_spinner="Fetching 14-day weather forecast…")
def _hourly(lat: float, lon: float, schema: int):
    return weather.fetch_hourly(lat, lon, days=15)


def cached_hourly(lat: float, lon: float):
    """14-day hourly forecast, cached 1 h. Keyed on weather.SCHEMA so data-format changes force a refetch."""
    return _hourly(round(lat, 3), round(lon, 3), weather.SCHEMA)


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
        g = current_ground()
        home = ground_location(g) if g else DEFAULT_LOCATION
        if (loc.lat, loc.lon) != (home.lat, home.lon):
            if st.button(f"🏠 Back to {g['name'] if g else 'home'}", width="stretch"):
                set_location(home)
                st.session_state.pop("map_center", None)
                st.rerun()
        st.caption("Tip: tap the map on the 🗺️ Map page to forecast any pin.")
    return get_location()


@st.cache_data(ttl=30 * 86400, show_spinner=False)
def _state_for(lat: float, lon: float) -> str:
    from . import regs

    code = regs.county_for_point(lat, lon).get("state")
    if not code:
        raise RuntimeError("no state")  # failures stay out of the cache
    return code


def state_for(lat: float, lon: float) -> str | None:
    """Two-letter state for a point (FCC census lookup), cached on success."""
    try:
        return _state_for(round(lat, 3), round(lon, 3))
    except Exception:
        return None


def rut_info(lat: float, lon: float, state: str | None = None):
    from . import rut

    return rut.peak_for(state or state_for(lat, lon), lat, lon)


def rut_override():
    """User-chosen peak-rut date (month/day applied to any season), or None."""
    return st.session_state.get("rut_override")


def rut_for(d, lat: float, lon: float, state: str | None = None):
    """Peak-rut date for the season containing d at a location, honoring the user's override."""
    st_code = state or state_for(lat, lon)
    return scoring.rut_peak_for(d, lat, rut_override(), lon=lon, state=st_code)


def rut_peak_setting(lat: float, lon: float | None = None, state: str | None = None, container=st.sidebar):
    """Sidebar rut-date control: agency/regional date by default; changing it sets an override."""
    loc = get_location()
    lon = loc.lon if lon is None else lon
    st_code = state or loc.state or state_for(lat, lon)
    info = rut_info(lat, lon, st_code)
    default = scoring.rut_peak_for(pd.Timestamp.now(), lat, None, lon=lon, state=st_code)
    current = rut_for(pd.Timestamp.now(), lat, lon, st_code)

    def _changed():
        v = st.session_state.get("rut_input")
        st.session_state.rut_override = None if v == default else v

    if st.session_state.get("rut_input_default") != default or "rut_input" not in st.session_state:
        st.session_state.rut_input = current  # location changed → show that place's date
        st.session_state.rut_input_default = default
    with container:
        st.date_input("Peak breeding (rut) date", key="rut_input", on_change=_changed,
                      help="Defaults to your state wildlife agency's peak breeding date for this area (or a regional "
                           "average). Change it if you know your local peak.")
        src = f"[{info.source}]({info.url})" if info.url else info.source
        if rut_override():
            st.caption(f"✏️ Your date (default: {default:%b %-d} — {src})")
            if st.button("Reset to default rut date", width="stretch"):
                st.session_state.rut_override = None
                st.session_state.pop("rut_input_default", None)
                st.rerun()
        else:
            st.caption(("✅ " if info.confidence == "agency" else "≈ ") + src)
    return current


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


@st.cache_data(ttl=30 * 86400, show_spinner=False)
def _elevations(points: tuple) -> list:
    from . import recovery

    out = recovery.fetch_elevations([(round(a, 5), round(b, 5)) for a, b in points])
    if not out:
        raise RuntimeError("elevation lookup failed")  # raising keeps a failure out of the cache
    return out


def cached_elevations(points: tuple) -> list | None:
    """Elevations (m) for (lat, lon) points — cached a month on success, retried next time on failure."""
    try:
        return _elevations(points)
    except Exception:
        return None



HOME_SCREEN_JS = r"""
<meta charset="utf-8">
<div id="st" style="font:12px -apple-system,Helvetica,sans-serif;color:#e8e6df;white-space:pre-line"></div>
<script>
(async function () {
  const report = [];
  const docs = [];
  // Streamlit Community Cloud runs the app inside an outer page — iOS reads the icon/name from the TOP page.
  try { if (window.top && window.top.document) docs.push(["top", window.top.document]); } catch (e) { report.push("top page: not reachable"); }
  try { if (window.parent.document && (!docs.length || window.parent.document !== docs[0][1])) docs.push(["app", window.parent.document]); } catch (e) {}
  // find where the icon file is actually served
  const origin = window.parent.location.origin;
  const appPath = window.parent.location.pathname;
  const cands = [];
  const m = appPath.match(/^(.*?\/~\/\+)/);
  if (m) cands.push(origin + m[1] + "/app/static/apple-touch-icon.png");
  cands.push(origin + "/app/static/apple-touch-icon.png");
  cands.push(origin + "/~/+/app/static/apple-touch-icon.png");
  let icon = null;
  for (const u of cands) {
    try { const r = await fetch(u, {method: "GET", cache: "no-store"});
          const ct = r.headers.get("content-type") || "";
          if (r.ok && ct.startsWith("image")) { icon = u; break; } } catch (e) {}
  }
  if (!icon) { icon = "data:image/png;base64,__DATA__"; report.push("icon file: not served — using embedded copy"); }
  else report.push("icon file: " + icon);
  for (const [name, doc] of docs) {
    try {
      doc.querySelectorAll('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').forEach(e => e.remove());
      doc.querySelectorAll('meta[name="apple-mobile-web-app-title"]').forEach(e => e.remove());
      const add = (tag, attrs) => { const el = doc.createElement(tag); for (const k in attrs) el.setAttribute(k, attrs[k]);
                                   doc.head.appendChild(el); };
      add("link", {rel: "apple-touch-icon", sizes: "180x180", href: icon});
      add("meta", {name: "apple-mobile-web-app-title", content: "Deercast"});
      add("meta", {name: "application-name", content: "Deercast"});
      add("meta", {name: "apple-mobile-web-app-capable", content: "yes"});
      add("meta", {name: "mobile-web-app-capable", content: "yes"});
      add("meta", {name: "apple-mobile-web-app-status-bar-style", content: "black"});
      add("meta", {name: "theme-color", content: "#14191a"});
      report.push(name + " page: icon + name set ✓");
    } catch (e) { report.push(name + " page: blocked (" + e.message + ")"); }
  }
  const el = document.getElementById("st"); if (el && __SHOW__) el.textContent = report.join("\n");
})();
</script>
"""


def _icon_b64() -> str:
    import base64
    from pathlib import Path

    p = Path(__file__).resolve().parents[1] / "static" / "apple-touch-icon.png"
    return base64.b64encode(p.read_bytes()).decode() if p.exists() else ""


def add_home_screen_tags(show_status: bool = False):
    """iPhone 'Add to Home Screen': Deercast icon + name, full-screen, dark status bar.

    Writes the tags into the TOP page (Streamlit Cloud wraps the app in an outer page, and iOS only reads that one)
    and the app page. With show_status=True the frame prints what it did (Development page)."""
    js = HOME_SCREEN_JS.replace("__DATA__", _icon_b64()).replace("__SHOW__", "true" if show_status else "false")
    html_frame(js, height=80 if show_status else 1)
