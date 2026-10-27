"""Hunting map: stand pins, map-pin forecasting, live wind and scent-drift cones."""

import folium
import pandas as pd
import streamlit as st
from folium.plugins import LocateControl
from streamlit_folium import st_folium

from deercast import geo, scent, ui
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
        wind = {"mph": w["wind_mph"], "dir": w["wind_dir"], "gust": w["gust_mph"], "label": "Live (updates every 10 min)"}
    else:
        hw = ui.cached_hourly_wind(center_lat, center_lon)
        when = st.select_slider("Hour", options=list(hw.index), format_func=lambda t: t.strftime("%a %-I %p"))
        row = hw.loc[when]
        wind = {"mph": row.wind_mph, "dir": row.wind_dir, "gust": row.gust_mph, "label": when.strftime("Forecast %a %-I %p")}
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


def draw_cone(lat, lon, color="#ff8c1a"):
    if not wind:
        return
    for frac, op in ((1.0, 0.12), (0.66, 0.18), (0.33, 0.28)):
        folium.Polygon(
            scent.scent_cone(lat, lon, wind["dir"], wind["mph"], frac=frac),
            color=color, weight=1, fill=True, fill_color=color, fill_opacity=op, opacity=0.5,
        ).add_to(scent_fg)


st.session_state.setdefault("show_cones", True)
show_cones = st.session_state.show_cones
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
        draw_cone(s["lat"], s["lon"])

clicked = st.session_state.get("last_click")
if clicked:
    folium.CircleMarker(clicked, radius=7, color="#fff", fill=True, fill_color="#ff3b30", fill_opacity=1).add_to(m)
    draw_cone(*clicked, color="#ffd60a")
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

st.toggle("Show scent cones on all stands", key="show_cones")
st.caption(
    "Compass: map is always north-up; the orange arrow shows which way the wind (and your scent) is moving. "
    "Cones show where your scent drifts (downwind). Short & wide = light, swirly wind; long & narrow = steady wind. "
    "Tap anywhere to drop a yellow test cone. Planning aid only — terrain and thermals bend real air flow."
)

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
