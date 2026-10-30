"""Hunting map: stand pins, map-pin forecasting, live wind and scent-drift cones."""

import folium
import pandas as pd
import streamlit as st
from folium.plugins import LocateControl
from streamlit_folium import st_folium

import math
from datetime import datetime, timezone

import numpy as np

from deercast import geo, huntlog, scent, terrain, ui
from deercast.compass import Compass
from deercast.weather import CARDINALS_8, deg_to_cardinal

st.title("🗺️ Map & Wind")

loc = ui.get_location()
stands = ui.load("stands", [])

if "map_center" not in st.session_state:
    st.session_state.map_center = [loc.lat, loc.lon]
    st.session_state.map_zoom = 16

# ---------------------------------------------------------------- wind source
c1, c2 = st.columns([2, 1])
with c2:
    mode = st.radio("Wind", ["Live now", "Forecast hour"], horizontal=True, label_visibility="collapsed")
center_lat, center_lon = st.session_state.map_center
wind = None
try:
    if mode == "Live now":
        w = ui.cached_current_wind(center_lat, center_lon)
        # Thermals use 'when' — snap it to the same 10-minute step as the live wind. A to-the-second time changes
        # the cones on every rerun, st_folium then remounts the map, which reruns the script → endless flicker.
        _now = datetime.now(timezone.utc)
        wind = {"mph": w["wind_mph"], "dir": w["wind_dir"], "gust": w["gust_mph"], "label": "Live (updates every 10 min)",
                "when": _now.replace(minute=_now.minute - _now.minute % 10, second=0, microsecond=0)}
    else:
        hw = ui.cached_hourly_wind(center_lat, center_lon)
        when = st.select_slider("Hour", options=list(hw.index), format_func=lambda t: t.strftime("%a %-I %p"))
        row = hw.loc[when]
        wind = {"mph": row.wind_mph, "dir": row.wind_dir, "gust": row.gust_mph, "label": when.strftime("Forecast %a %-I %p"),
                "when": when.tz_convert("UTC").to_pydatetime()}
except Exception as e:
    st.warning(f"Wind data unavailable: {e}")

with c1:
    if wind:
        st.markdown(
            f"### 💨 {wind['mph']:.0f} mph from **{deg_to_cardinal(wind['dir'])}** "
            f"<span style='font-size:0.8em;opacity:.7'>(gusts {wind['gust']:.0f}) · {wind['label']}</span>",
            unsafe_allow_html=True,
        )
        if st.button("↻ Refresh wind"):
            ui.cached_current_wind.clear()
            ui.cached_hourly_wind.clear()
            st.rerun()

# ---------------------------------------------------------------- map
m = folium.Map(location=st.session_state.map_center, zoom_start=st.session_state.map_zoom, tiles=None, control_scale=True)
folium.TileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attr="Esri, Maxar, Earthstar Geographics",
    name="Satellite",
    max_zoom=21,
    max_native_zoom=19,
    show=True,
).add_to(m)
folium.TileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attr="OpenTopoMap (CC-BY-SA)", name="Topo", max_zoom=21, max_native_zoom=17, show=False).add_to(m)
folium.TileLayer("OpenStreetMap", name="Streets", max_zoom=21, max_native_zoom=19, show=False).add_to(m)
folium.TileLayer(
    "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    attr="Esri", name="Labels", overlay=True, control=True,
).add_to(m)
LocateControl(auto_start=False, flyTo=True).add_to(m)
Compass(
    wind_from_deg=wind["dir"] if wind else None,
    wind_mph=wind["mph"] if wind else None,
    wind_label=f"{deg_to_cardinal(wind['dir'])} {wind['mph']:.0f} mph" if wind else "",
).add_to(m)

scent_fg = folium.FeatureGroup(name="Scent cones")
st.session_state.setdefault("use_thermals", True)
use_thermals = st.session_state.use_thermals


def drift_at(points):
    """Wind + thermal drift for each (lat, lon). Falls back to wind-only if terrain is unavailable."""
    if not wind:
        return [None] * len(points)
    if not use_thermals or not points:
        return [None] * len(points)
    pts5 = [p for lat_, lon_ in points for p in terrain.slope_points(lat_, lon_)]
    elev = ui.cached_elevations(tuple((round(a, 5), round(b, 5)) for a, b in pts5))
    if not elev or len(elev) != len(pts5):
        return [None] * len(points)
    phase, strength = terrain.thermal_phase(points[0][0], points[0][1], wind["when"])
    out = []
    for i in range(len(points)):
        slope, up = terrain.slope_from(elev[5 * i:5 * i + 5])
        out.append(terrain.combine(wind["dir"], wind["mph"], slope, up, phase, strength))
    return out


def draw_cone(lat, lon, color="#ff8c1a", drift=None):
    if not wind:
        return
    for frac, op in ((1.0, 0.12), (0.66, 0.18), (0.33, 0.28)):
        poly = (scent.drift_cone(lat, lon, drift["to_bearing"], drift["mph"], drift["extra_half"], frac=frac)
                if drift else scent.scent_cone(lat, lon, wind["dir"], wind["mph"], frac=frac))
        folium.Polygon(poly, color=color, weight=1, fill=True, fill_color=color, fill_opacity=op,
                       opacity=0.5).add_to(scent_fg)


st.session_state.setdefault("show_cones", True)
show_cones = st.session_state.show_cones
clicked = st.session_state.get("last_click")
_pts = [(s_["lat"], s_["lon"]) for s_ in stands] + ([tuple(clicked)] if clicked else [])
_drifts = drift_at(_pts)
stand_drift = {s_["id"]: d for s_, d in zip(stands, _drifts)}
click_drift = _drifts[-1] if clicked else None
for s in stands:
    ok = scent.wind_ok_for_stand(wind["dir"], s.get("good_winds", [])) if wind else None
    color = "green" if ok else ("red" if ok is False else "blue")
    tip = f"{s['name']}" + ("" if ok is None else (" ✅ good wind" if ok else " ❌ bad wind"))
    folium.Marker(
        [s["lat"], s["lon"]],
        tooltip=tip,
        popup=folium.Popup(
            f"<b>{s['name']}</b><br>{s.get('type','')}<br>Good winds: {', '.join(s.get('good_winds', [])) or '—'}"
            f"<br>{s.get('notes','')}",
            max_width=250,
        ),
        icon=folium.Icon(color=color, icon="tree-conifer", prefix="glyphicon"),
    ).add_to(m)
    if show_cones:
        draw_cone(s["lat"], s["lon"], drift=stand_drift.get(s["id"]))

features = ui.load("features", [])
FEATURE_STYLE = {"water": ("#3a86ff", "💧 Water"), "cover": ("#2d6a4f", "🌲 Thick cover"),
                 "bedding": ("#ffb703", "🛏️ Bedding area"),
                 "feeder": ("#f4a261", "🌽 Broadcast corn feeder"), "corn_shelled": ("#e9c46a", "🌽 Shelled corn pile"),
                 "corn_ear": ("#e9c46a", "🌽 Ear corn pile"), "food_other": ("#90be6d", "🍎 Other food / plot")}
BAIT_TYPES = ("feeder", "corn_shelled", "corn_ear", "food_other")
feat_fg = folium.FeatureGroup(name="Water / cover / bedding")
bait_fg = folium.FeatureGroup(name="Bait & food")
for f in features:
    col, lbl = FEATURE_STYLE.get(f["type"], ("#999", f["type"]))
    if f["type"] in BAIT_TYPES:
        icon = {"feeder": "🛢️", "corn_shelled": "🌽", "corn_ear": "🌽", "food_other": "🍎"}[f["type"]]
        filled = f" · filled {f['last_filled']}" if f.get("last_filled") else ""
        folium.Marker([f["lat"], f["lon"]], tooltip=f"{lbl}: {f.get('name') or ''}{filled}",
                      icon=folium.DivIcon(html=f'<div style="font-size:22px;line-height:22px;'
                                               f'text-shadow:0 0 3px #000">{icon}</div>',
                                          icon_size=(24, 24), icon_anchor=(12, 12))).add_to(bait_fg)
    else:
        folium.Circle([f["lat"], f["lon"]], radius=f.get("radius_yd", 40) * 0.9144, color=col, weight=2, fill=True,
                      fill_color=col, fill_opacity=0.25, tooltip=f"{lbl}: {f.get('name') or ''}").add_to(feat_fg)
feat_fg.add_to(m)
bait_fg.add_to(m)

# deer sightings from the hunt log (only those with a direction + distance from the stand)
KIND_COLOR = {"Buck": "#ff6b1a", "Doe": "#ffd60a", "Fawn": "#f5deb3", "Unknown": "#c0c0c0"}
seen_fg = folium.FeatureGroup(name="Deer sightings")
n_seen = 0
for hunt in ui.ground_hunts():
    for e in huntlog.group_sightings(hunt.get("sightings", [])):
        if e.get("lat") is None:
            continue
        n_seen += 1
        kinds = [k for k, _ in e["deer"]]
        col = KIND_COLOR["Buck" if "Buck" in kinds else kinds[0]]
        tip = (f"{pd.Timestamp(e['time']):%b %-d %-I:%M %p} — {huntlog.deer_text(e['deer'])}"
               + (f" · {e['activity']}" if e.get("activity") else "")
               + (f" · {huntlog.where_text(e)}" if huntlog.where_text(e) else ""))
        pt = [e["lat"], e["lon"]]
        for key, dash in (("came_from", "4 4"), ("went_to", None)):
            if e.get(key) in CARDINALS_8:
                end = scent.destination(e["lat"], e["lon"], CARDINALS_8.index(e[key]) * 45, 30 * 0.9144)
                folium.PolyLine([end, pt] if key == "came_from" else [pt, end], color=col, weight=3, opacity=0.9,
                                dash_array=dash, tooltip=tip).add_to(seen_fg)
                if key == "went_to":
                    folium.RegularPolygonMarker(end, number_of_sides=3, radius=6, rotation=CARDINALS_8.index(
                        e[key]) * 45 - 90, color=col, fill=True, fill_color=col, fill_opacity=1,
                        weight=1).add_to(seen_fg)
        folium.CircleMarker(pt, radius=6, color="#111", weight=1, fill=True, fill_color=col, fill_opacity=0.95,
                            tooltip=tip).add_to(seen_fg)
seen_fg.add_to(m)

if clicked:
    folium.CircleMarker(clicked, radius=7, color="#fff", fill=True, fill_color="#ff3b30", fill_opacity=1).add_to(m)
    draw_cone(*clicked, color="#ffd60a", drift=click_drift)

# ---------------------------------------------------------------- drift field over the property
st.session_state.setdefault("show_field", False)
if st.session_state.show_field and wind:
    N, SP = 8, 120.0  # 8×8 samples, 120 m apart (~840 m square); arrows on the inner 6×6
    clat, clon = st.session_state.map_center
    half = (N - 1) / 2
    grid = [[scent.destination(*scent.destination(clat, clon, 0, (half - r) * SP), 90, (c - half) * SP)
             for c in range(N)] for r in range(N)]
    flat = [p for row in grid for p in row]
    elev = ui.cached_elevations(tuple((round(a, 5), round(b, 5)) for a, b in flat))
    field_fg = folium.FeatureGroup(name="Scent drift field")
    if elev and len(elev) == len(flat):
        E = np.array(elev, float).reshape(N, N)
        slopes, ups = terrain.grid_slopes(E, SP)
        phase, strength = terrain.thermal_phase(clat, clon, wind["when"])
        for r in range(1, N - 1):
            for c in range(1, N - 1):
                lat_, lon_ = grid[r][c]
                d = terrain.combine(wind["dir"], wind["mph"], float(slopes[r, c]), float(ups[r, c]), phase,
                                    strength)
                L = 25 + 8 * min(d["mph"], 10)  # meters
                tail = scent.destination(lat_, lon_, (d["to_bearing"] + 180) % 360, L / 2)
                head = scent.destination(lat_, lon_, d["to_bearing"], L / 2)
                col = "#b388ff" if d["influence"] > 0.35 else ("#ff8c1a" if not d["switching"] else "#ffd60a")
                tip = f"Scent drifts to {deg_to_cardinal(d['to_bearing'])} · {terrain.describe(d)}"
                folium.PolyLine([tail, head], color=col, weight=3, opacity=0.9, tooltip=tip).add_to(field_fg)
                folium.RegularPolygonMarker(head, number_of_sides=3, radius=5, rotation=d["to_bearing"] - 90,
                                            color=col, fill=True, fill_color=col, fill_opacity=1, weight=1,
                                            tooltip=tip).add_to(field_fg)
    field_fg.add_to(m)
scent_fg.add_to(m)
folium.LayerControl(collapsed=True).add_to(m)

out = st_folium(m, height=520, use_container_width=True, returned_objects=["last_clicked", "center", "zoom"], key="huntmap")

if out:
    lc = out.get("last_clicked")
    if lc and [lc["lat"], lc["lng"]] != st.session_state.get("last_click"):
        st.session_state.last_click = [lc["lat"], lc["lng"]]
        if out.get("center"):
            st.session_state.map_center = [out["center"]["lat"], out["center"]["lng"]]
        if out.get("zoom"):
            st.session_state.map_zoom = out["zoom"]
        st.rerun()

# stand wind check, in words
if wind and stands:
    parts = []
    for s_ in stands:
        ok = scent.wind_ok_for_stand(wind["dir"], s_.get("good_winds", []))
        mark = "⚪" if ok is None else ("✅" if ok else "❌")
        good = ", ".join(s_.get("good_winds", [])) or "none set"
        dr = stand_drift.get(s_["id"])
        therm = f" · {terrain.describe(dr)}" if dr and dr["slope"] >= 1.5 else ""
        parts.append(f"{mark} **{s_['name']}** <small>(good: {good}{therm})</small>")
    st.markdown(f"**Wind from {deg_to_cardinal(wind['dir'])} {wind['mph']:.0f} mph** — " + " · ".join(parts),
                unsafe_allow_html=True)

t1, t2, t3 = st.columns(3)
t1.toggle("Scent cones", key="show_cones")
t2.toggle("Thermals", key="use_thermals", help="Bend scent cones with terrain thermals: uphill as the sun warms "
          "slopes in the morning, downhill as they cool in the evening.")
t3.toggle("Drift field", key="show_field", help="Arrows across ~half a mile around the map center showing where "
          "scent drifts (wind + thermals).")
with st.expander("🗝️ Map key"):
    st.markdown(
        "**Stands**\n"
        "- ✅ **Green stand** — the wind is blowing *from* one of that stand's good wind directions (±22°). Hunt it.\n"
        "- ❌ **Red stand** — current wind isn't one of its good directions; your scent may reach where deer come from.\n"
        "- 🔵 **Blue stand** — no good wind directions saved yet (edit the stand below).\n"
        "- Colors follow the wind shown — switch to **Forecast hour** to check tomorrow.\n\n"
        "**Wind & scent**\n"
        "- 🧭 Compass (top right): map is always north-up. The **orange arrow** points the way the wind — and your "
        "scent — is moving.\n"
        "- 🟧 **Orange cones**: where scent drifts from each stand. Short & wide = light, swirly wind; long & narrow = "
        "steady wind. 🟨 Yellow cone = the spot you tapped.\n"
        "- 🌄 **Thermals** (toggle): on slopes, cones bend **uphill** once the sun warms the ground in the morning and "
        "**downhill** as it cools toward evening and overnight. Around sunrise and the hour before sunset thermals "
        "switch, so cones widen — expect swirling scent. In light wind thermals rule; in steady wind the wind does.\n"
        "- ➤ **Drift field** (toggle): arrows over ~half a mile showing where scent moves. Orange = wind-driven, "
        "purple = thermal-driven, yellow = thermals switching.\n\n"
        "**Your marks**\n"
        "- 🛢️ feeder · 🌽 shelled / ear corn · 🍎 other food\n"
        "- 🔵 water · 🟢 thick cover · 🟡 bedding (circles)\n\n"
        "**Deer sightings** (from the Hunt Log)\n"
        "- Dots: 🟠 buck · 🟡 doe · tan = fawn · grey = unknown\n"
        "- Dashed line = where it came from; solid line + arrowhead = where it went.\n\n"
        "Use the layers button (top right) to hide/show cones, marks and sightings. Scent cones are a planning aid — "
        "terrain and thermals bend real air flow."
    )
if n_seen:
    st.caption(f"🦌 {n_seen} logged sighting(s) on the map.")

# ---------------------------------------------------------------- actions on clicked point
if clicked:
    st.subheader(f"📍 Pin {clicked[0]:.5f}, {clicked[1]:.5f}")
    a1, a2 = st.columns(2)
    if a1.button("📈 Forecast this pin", width="stretch"):
        ui.set_location(geo.pin_location(*clicked))
        st.switch_page("app_pages/forecast.py")
    if a2.button("✖ Clear pin", width="stretch"):
        st.session_state.last_click = None
        st.rerun()

    with st.form("add_stand", clear_on_submit=True):
        st.markdown("**Add a stand here**")
        name = st.text_input("Stand name")
        f1, f2 = st.columns(2)
        stype = f1.selectbox("Type", ["Ladder", "Hang-on", "Climber", "Ground blind", "Box blind", "Saddle", "Other"])
        good = f2.multiselect("Good wind directions", CARDINALS_8)
        notes = st.text_area("Notes", height=70)
        if st.form_submit_button("Save stand", type="primary"):
            if not name.strip():
                st.error("Give the stand a name.")
            else:
                new = stands + [{
                    "id": ui.new_id(), "name": name.strip(), "lat": round(clicked[0], 6), "lon": round(clicked[1], 6),
                    "type": stype, "good_winds": good, "notes": notes, "created": ui.now_str(),
                }]
                if ui.save("stands", new, f"Add stand {name.strip()}"):
                    st.session_state.last_click = None
                    st.success(f"Saved {name}")
                    st.rerun()

    with st.form("add_feature", clear_on_submit=True):
        st.markdown("**…or mark bait, food, water, cover or bedding here**")
        st.caption("Bait/food sites can be tagged in the Hunt Log. Water, cover and bedding feed the Shot & Recovery "
                   "map — wounded deer head for water and heavy cover to bed.")
        g1, g2 = st.columns(2)
        ftype = g1.selectbox("Type", list(FEATURE_STYLE), format_func=lambda t: FEATURE_STYLE[t][1])
        frad = g2.number_input("Radius (yd) — water/cover/bedding", 10, 300, 40, step=10)
        fname = st.text_input("Name (optional)", placeholder="e.g. back feeder, creek bottom, cedar thicket")
        ffill = st.date_input("Last filled / refreshed (bait & food)", value=None)
        if st.form_submit_button("Save feature"):
            rec = {"id": ui.new_id(), "type": ftype, "name": fname.strip(), "lat": round(clicked[0], 6),
                   "lon": round(clicked[1], 6), "radius_yd": int(frad), "created": ui.now_str()}
            if ftype in BAIT_TYPES:
                rec["radius_yd"] = 10
                rec["last_filled"] = (ffill or pd.Timestamp.now(tz="America/Chicago").date()).isoformat()
            new = features + [rec]
            if ui.save("features", new, f"Add {ftype} feature"):
                st.session_state.last_click = None
                st.rerun()

# ---------------------------------------------------------------- features list
bait_list = [f for f in features if f["type"] in BAIT_TYPES]
other_list = [f for f in features if f["type"] not in BAIT_TYPES]
if bait_list:
    with st.expander(f"🌽 Bait & food sites ({len(bait_list)})", expanded=True):
        today = pd.Timestamp.now(tz="America/Chicago").date()
        for f in bait_list:
            days = (today - pd.Timestamp(f["last_filled"]).date()).days if f.get("last_filled") else None
            c1, c2, c3 = st.columns([4, 2, 1])
            c1.markdown(f"{FEATURE_STYLE[f['type']][1]} · **{f.get('name') or 'unnamed'}**"
                        + (f" · filled {days} day{'s' if days != 1 else ''} ago" if days is not None else ""))
            if c2.button("Filled today", key=f"fill_{f['id']}", width="stretch"):
                f["last_filled"] = today.isoformat()
                ui.save("features", features, f"Refill {f.get('name') or f['type']}")
                st.rerun()
            if c3.button("🗑", key=f"delb_{f['id']}"):
                ui.save("features", [x for x in features if x["id"] != f["id"]], "Delete bait site")
                st.rerun()
        st.caption("Baiting rules: legal on private land in Kentucky for 2026-27, but **not** on WMAs/public land, and "
                   "contact-style feeders (troughs, gravity feeders) are banned in CWD Surveillance Zone counties. "
                   "Check the 📜 Regulations page for your county.")
if other_list:
    with st.expander(f"Water / cover / bedding marks ({len(other_list)})"):
        for f in other_list:
            c1, c2 = st.columns([4, 1])
            c1.markdown(f"{FEATURE_STYLE.get(f['type'], ('', f['type']))[1]} · {f.get('name') or 'unnamed'} · "
                        f"{f.get('radius_yd', 40)} yd")
            if c2.button("Delete", key=f"delf_{f['id']}"):
                ui.save("features", [x for x in features if x["id"] != f["id"]], "Delete feature")
                st.rerun()

# ---------------------------------------------------------------- stand list
st.subheader(f"Stands ({len(stands)})")
if not stands:
    st.info("No stands yet — tap the map where a stand is and use **Add a stand here**.")
for s in stands:
    ok = scent.wind_ok_for_stand(wind["dir"], s.get("good_winds", [])) if wind else None
    badge = "" if ok is None else (" ✅" if ok else " ❌")
    with st.expander(f"{s['name']}{badge} · {s.get('type','')}"):
        st.caption(f"{s['lat']:.5f}, {s['lon']:.5f} · added {s.get('created','')}")
        with st.form(f"edit_{s['id']}"):
            nm = st.text_input("Name", s["name"])
            gw = st.multiselect("Good wind directions", CARDINALS_8, default=s.get("good_winds", []))
            nt = st.text_area("Notes", s.get("notes", ""), height=70)
            b1, b2, b3 = st.columns(3)
            save_b = b1.form_submit_button("Save")
            go_b = b2.form_submit_button("Center map")
            del_b = b3.form_submit_button("Delete")
        if save_b:
            s.update(name=nm, good_winds=gw, notes=nt)
            ui.save("stands", stands, f"Edit stand {nm}")
            st.rerun()
        if go_b:
            st.session_state.map_center = [s["lat"], s["lon"]]
            st.session_state.map_zoom = 17
            st.rerun()
        if del_b:
            ui.save("stands", [x for x in stands if x["id"] != s["id"]], f"Delete stand {s['name']}")
            st.rerun()
