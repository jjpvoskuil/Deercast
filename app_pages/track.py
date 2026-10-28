"""Shot placement → likely organs hit, survival time, wait time, recovery search map and tracking tips."""

from datetime import datetime, timedelta

import folium
import numpy as np
import pandas as pd
import streamlit as st
from streamlit_folium import st_folium
from streamlit_image_coordinates import streamlit_image_coordinates

from deercast import archery, recovery, shot, ui
from deercast import shot_render as R
from deercast.compass import Compass
from deercast.scent import destination
from deercast.weather import CARDINALS, deg_to_cardinal

st.title("🎯 Shot & Recovery")
st.caption("Show how the deer stood and where you hit it. Estimates are general guidance — every deer is different.")

ANGLES = {-90: "Facing you", -75: "Facing you (slight)", -60: "Hard quartering toward", -45: "Quartering toward",
          -30: "Slight quartering toward", -15: "Nearly broadside", 0: "Broadside", 15: "Nearly broadside",
          30: "Slight quartering away", 45: "Quartering away", 60: "Hard quartering away", 75: "Facing away (slight)",
          90: "Facing away"}
DIRS = {c: i * 22.5 for i, c in enumerate(CARDINALS)}

# ---------------------------------------------------------------- 1. deer position
st.subheader("1 · How was the deer standing?")
st.session_state.setdefault("shot_yaw", 0)
yaw = st.select_slider("Deer's angle to you", options=list(ANGLES), format_func=lambda a: ANGLES[a], key="shot_yaw")
c1, c2, c3 = st.columns(3)
side = c1.radio("Side toward you", ["Left", "Right"], horizontal=True, key="shot_side",
                help="Which side of the deer's body faced you. Left side = head pointing to your left at broadside.")
buck = c2.toggle("Buck", value=True, key="shot_buck")
vitals = c3.toggle("Show vitals", value=True, key="shot_vitals")
mirror = side == "Right"

# ---------------------------------------------------------------- 2. shot angle
st.subheader("2 · Your shot")
w1, w2 = st.columns(2)
weapon = w1.selectbox("Weapon", ["Bow", "Crossbow", "Rifle / shotgun slug", "Muzzleloader"], key="shot_weapon")
dist = w2.number_input("Distance to deer (yd)", 1, 400, value=20, step=1, key="shot_dist")
h1, h2 = st.columns(2)
height = h1.number_input("Stand height (ft, 0 = ground)", 0, 40, value=18, step=1, key="shot_height")
auto = shot.stand_angle(height, dist)
manual = h2.toggle("Set angle manually", key="shot_manual")
pitch = st.slider("Downward arrow angle (°)", 0, 70, value=int(round(auto)), key="shot_pitch_manual",
                  disabled=not manual) if manual else round(auto)
if not manual:
    h2.metric("Downward angle", f"{pitch}°")
is_bow = weapon in ("Bow", "Crossbow")
gear = ui.load("gear", {"setups": [], "active": None})
setup = next((g for g in gear.get("setups", []) if g["id"] == gear.get("active")), None) if is_bow else None
setup_sum = archery.summary(setup) if setup else {}
if is_bow:
    if setup_sum:
        st.caption(f"🏹 **{setup['name']}** — {setup_sum['fps']:.0f} fps, {setup_sum['ke']:.0f} ft·lb, momentum "
                   f"{setup_sum['momentum']:.2f}, {setup.get('tip_type', '').lower()} · bone penetration "
                   f"**{setup_sum['bone']}**")
    else:
        st.caption("🏹 Add your bow on the **Bow Setup** page to factor penetration into the estimate.")

# ---------------------------------------------------------------- 3. crosshair
st.subheader("3 · Tap where you hit")
st.caption("Set the angle above first, then tap the deer where the arrow/bullet went in.")
cross = st.session_state.get("shot_cross")  # (sx, sy) model screen coords, pre-mirror


@st.cache_data(show_spinner=False, max_entries=64)
def render_view(yaw, pitch, mirror, cross, vitals, hit_keys, buck):
    return R.deer_view(yaw, pitch, mirror, cross, vitals, set(hit_keys) if hit_keys else None, antlers=buck)


res = shot.trace(cross[0], cross[1], yaw, pitch) if cross else None
hit_keys = tuple(sorted(h.key for h in res.hits)) if res else ()
img = render_view(yaw, pitch, mirror, tuple(cross) if cross else None, vitals, hit_keys, buck)
click = streamlit_image_coordinates(img, width="stretch", key="shot_img")
if click and click.get("unix_time") != st.session_state.get("shot_click_t"):
    st.session_state.shot_click_t = click.get("unix_time")
    st.session_state.shot_cross = R.screen_to_model(click["x"], click["y"], click["width"], click["height"], mirror)
    st.rerun()

if cross:
    n = st.columns(5)
    step = 1.0
    moves = {"◀": (-step, 0), "▲": (0, step), "▼": (0, -step), "▶": (step, 0)}
    for col, (lbl, (dx, dy)) in zip(n[:4], moves.items()):
        if col.button(lbl, width="stretch", key=f"nudge_{lbl}"):
            mx = -dx if mirror else dx  # buttons move in screen space
            st.session_state.shot_cross = (cross[0] + mx, cross[1] + dy)
            st.rerun()
    if n[4].button("✖", width="stretch", help="Clear"):
        st.session_state.shot_cross = None
        st.rerun()

if not cross:
    st.info("👆 Tap the deer to place the crosshair.")
    st.stop()

# ---------------------------------------------------------------- 4. analysis
st.subheader("4 · What was likely hit")
primary, stopped, notes = shot.classify(res, weapon)

e1, e2 = st.columns(2)
evidence = e1.selectbox("What did you find? (arrow / impact site)", list(shot.EVIDENCE), key="shot_evidence")
reaction = e2.selectbox("Deer's reaction", list(shot.REACTION), key="shot_reaction")
sign = shot.EVIDENCE[evidence]
ARROW = ["(not checked yet)", "Pass-through — arrow recovered", "Pass-through — arrow not found",
         "Arrow stayed in deer / partial penetration", "Arrow not recovered — not sure if it passed through"]
arrow = st.selectbox("Arrow", ARROW, key="shot_arrow") if is_bow else ARROW[0]
partial = arrow.startswith("Arrow stayed")

plan_key = primary
if sign and sign != primary:
    st.warning(f"Your sign points to **{shot.OUTCOMES[sign]['title']}**, but the shot placement suggests "
               f"**{shot.OUTCOMES[primary]['title']}**. Physical sign is more reliable than an estimated hit spot.")
    use = st.radio("Plan recovery for", [f"Sign: {shot.OUTCOMES[sign]['title']}",
                                         f"Shot placement: {shot.OUTCOMES[primary]['title']}"], key="shot_use")
    plan_key = sign if use.startswith("Sign") else primary
if stopped:
    bone = setup_sum.get("bone") if setup_sum else None
    passed = arrow.startswith("Pass-through")
    default_idx = 0 if passed else (1 if (partial or bone == "Low") else 0)
    use2 = st.radio("Did the arrow penetrate past the shoulder bone?",
                    [f"Yes / not sure — {shot.OUTCOMES[primary]['title']}",
                     f"No, stopped at bone — {shot.OUTCOMES[stopped]['title']}"], index=default_idx,
                    key=f"shot_bone_{default_idx}",
                    help=(f"Your setup's bone-penetration rating: {bone}." if bone else None))
    if bone and not passed and not partial:
        st.caption({"High": "Your setup has good odds of breaking through the shoulder blade.",
                    "Moderate": "Your setup may or may not break through the shoulder blade — check arrow "
                                "penetration (blood on the shaft, how far it went in).",
                    "Low": "With your setup, heavy shoulder bone often stops the arrow — defaulted to 'stopped at "
                           "bone'."}.get(bone, ""))
    if use2.startswith("No"):
        plan_key = stopped
if reaction and shot.REACTION[reaction]:
    st.caption(f"Reaction: {shot.REACTION[reaction]}")

O = shot.OUTCOMES[plan_key]
wait = O["wait_min"]
if partial and O["lethal"] and wait >= 120:
    wait = int(wait * 1.5)  # one hole, poor blood — give a slow-death hit more time
wait_txt = "Track now (carefully)" if wait == 0 else (f"{wait} min" if wait < 60 else f"{wait / 60:.0f}+ hours")
lo, med, hi = O["yards"]

st.markdown(f"### {O['title']}")
m1, m2, m3 = st.columns(3)
m1.metric("Survival time", O["time"])
m2.metric("Wait before tracking", wait_txt)
m3.metric("Likely distance", f"{med} yd" if hi else "—", f"{lo}–{hi} yd" if hi else None, delta_color="off")
if not O["lethal"]:
    st.error("This hit is often **not fatal**. Track carefully, but be prepared that the deer may recover.")

if res.hits:
    rows = [{"Organ / tissue": h.label, "Path (in)": round(h.length, 1),
             "Note": "past bone — only if arrow penetrated" if (h.after_bone and stopped) else ""}
            for h in res.hits]
    st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
for nt in notes:
    st.caption("• " + nt)
if not res.missed:
    exit_z = res.exit[2]
    if weapon in ("Bow", "Crossbow"):
        st.caption(("• Exit is **low** on the body — usually a better blood trail."
                    if exit_z < -3 else "• Exit is high on the body — blood may be slow to hit the ground at first."))
    st.markdown(f"**Blood sign to expect:** {O['blood']}")
ARROW_NOTES = {
    "Pass-through — arrow not found": "Arrow passed through but wasn't found — search past where the deer stood, "
    "along the line of the shot (a light helps). Without the arrow, use hair and blood at the impact site to "
    "confirm the hit.",
    "Arrow stayed in deer / partial penetration": "No exit hole → expect **much less blood**, and often high on "
    "the body. The arrow may work out or break off in the first 50–150 yards — look for it on the trail. "
    + ("Wait time increased by half for this hit." if O["lethal"] and O["wait_min"] >= 120 else ""),
    "Arrow not recovered — not sure if it passed through": "Look for the arrow and sign at the impact site before "
    "anything else; a pass-through gives a better blood trail than an arrow still in the deer.",
}
if arrow in ARROW_NOTES:
    st.info(ARROW_NOTES[arrow])

with st.expander("Arrow path diagram", expanded=False):
    st.image(R.path_diagram(res, mirror), width="stretch")

if plan_key == "miss":
    st.stop()

# ---------------------------------------------------------------- 5. recovery map
st.subheader("5 · Where to look")
stands = ui.load("stands", [])
loc = ui.get_location()
src_opts = ["Current location"] + [f"Stand: {s['name']}" for s in stands]
src = st.selectbox("You shot from", src_opts, key="shot_src")
if src == "Current location":
    stand_lat, stand_lon = loc.lat, loc.lon
else:
    s = stands[src_opts.index(src) - 1]
    stand_lat, stand_lon = s["lat"], s["lon"]

d1, d2 = st.columns(2)
to_deer = d1.selectbox("Direction from you to the deer", CARDINALS, index=0, key="shot_todeer")
ran = d2.selectbox("Direction the deer ran", ["Unknown"] + CARDINALS, key="shot_ran")
seen = st.number_input("Last saw it this far from where it was hit (yd, 0 = not seen)", 0, 1000, 0, step=5,
                       key="shot_seen")
hit_lat, hit_lon = destination(stand_lat, stand_lon, DIRS[to_deer], dist * 0.9144)
run_dir = None if ran == "Unknown" else DIRS[ran]
yards = (max(lo, seen), max(med, int(seen * 1.4)), max(hi, int(seen * 2.2)))


@st.cache_data(ttl=86400, show_spinner="Reading terrain…")
def elevations(points):
    return recovery.fetch_elevations(list(points))


@st.cache_data(ttl=7 * 86400, show_spinner="Finding water and cover…")
def osm_features(lat, lon, radius_m):
    return recovery.fetch_osm_features(lat, lon, radius_m)


cells = recovery.search_grid(hit_lat, hit_lon, yards, run_dir)
bias = recovery.DOWNHILL_BIAS.get(plan_key, 0.0)
elev = elevations(tuple([(hit_lat, hit_lon)] + [c["center"] for c in cells])) if bias > 0 else None
w = recovery.weight_cells(cells, yards, run_dir, elev[1:] if elev else None, elev[0] if elev else None, bias)
marks = [f for f in ui.load("features", []) if f["type"] in ("water", "cover", "bedding")]
osm = osm_features(round(hit_lat, 4), round(hit_lon, 4), yards[2] * 0.9144 * 1.2)
wb, cb = recovery.WATER_BIAS.get(plan_key, 0.5), recovery.COVER_BIAS.get(plan_key, 0.7)
habitat_used = bool((osm and (osm["water"] or osm["cover"])) or marks)
if habitat_used:
    w = w * recovery.habitat_multiplier(recovery.feature_distances(cells, hit_lat, hit_lon, osm, marks), wb, cb)
    w = w / w.sum()

m = folium.Map(location=[hit_lat, hit_lon], zoom_start=17, tiles=None, control_scale=True)
folium.TileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
                 attr="Esri, Maxar, Earthstar Geographics", name="Satellite", max_zoom=21, max_native_zoom=19).add_to(m)
folium.TileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", attr="OpenTopoMap (CC-BY-SA)", name="Topo",
                 max_zoom=21, max_native_zoom=17, show=False).add_to(m)
wmax = w.max() if len(w) else 1
for c, wi in zip(cells, w):
    a = float(wi / wmax)
    if a < 0.08:
        continue
    folium.Polygon(c["poly"], color=None, weight=0, fill=True, fill_color="#ff3b30", fill_opacity=0.08 + 0.45 * a,
                   tooltip=f"{c['dist_yd']:.0f} yd {deg_to_cardinal(c['bearing'])} · relative chance {a:.0%}").add_to(m)
folium.Circle([hit_lat, hit_lon], radius=yards[1] * 0.9144, color="#ffd60a", weight=1.5, fill=False, dash_array="6",
              tooltip=f"Typical distance ~{yards[1]} yd").add_to(m)
folium.Marker([stand_lat, stand_lon], tooltip="You", icon=folium.Icon(color="blue", icon="user")).add_to(m)
folium.Marker([hit_lat, hit_lon], tooltip="Hit site — start here",
              icon=folium.Icon(color="red", icon="screenshot", prefix="glyphicon")).add_to(m)
if run_dir is not None:
    folium.PolyLine([[hit_lat, hit_lon], destination(hit_lat, hit_lon, run_dir, 40)], color="#ff8c1a", weight=4,
                    tooltip=f"Ran {ran}").add_to(m)
for rank, k in enumerate(np.argsort(w)[::-1][:3], 1):
    folium.Marker(cells[k]["center"], tooltip=f"#{rank} most likely area · {cells[k]['dist_yd']:.0f} yd "
                  f"{deg_to_cardinal(cells[k]['bearing'])}",
                  icon=folium.DivIcon(html=f'<div style="background:#ffd60a;color:#111;border-radius:50%;width:22px;'
                                           f'height:22px;text-align:center;font:700 13px/22px sans-serif">{rank}</div>')
                  ).add_to(m)
hab = folium.FeatureGroup(name="Water & cover")
for g in (osm or {}).get("water", []):
    folium.PolyLine(g, color="#3a86ff", weight=3, opacity=0.8, tooltip="Water").add_to(hab)
for g in (osm or {}).get("cover", []):
    folium.PolyLine(g, color="#52b788", weight=2, opacity=0.7, dash_array="4", tooltip="Woods / cover").add_to(hab)
for f in marks:
    col = {"water": "#3a86ff", "cover": "#2d6a4f", "bedding": "#ffb703"}.get(f["type"], "#999")
    folium.Circle([f["lat"], f["lon"]], radius=f.get("radius_yd", 40) * 0.9144, color=col, weight=2, fill=True,
                  fill_opacity=0.2, tooltip=f"Your mark: {f['type']} {f.get('name') or ''}").add_to(hab)
hab.add_to(m)
Compass().add_to(m)
folium.LayerControl(collapsed=True).add_to(m)
st_folium(m, height=460, use_container_width=True, returned_objects=[], key="recmap")
st.caption("Red shading = relative chance the deer is there, from typical travel distance for this hit"
           + (", the direction it ran" if run_dir is not None else "")
           + (", terrain (downhill)" if elev else "")
           + (", and nearby water & heavy cover (blue = water, green dashes = woods"
              + (", circles = your marks" if marks else "") + ")" if habitat_used else "")
           + ". Numbers 1–3 = best places to search first.")
if not habitat_used:
    st.caption("ℹ️ No water/cover data found here. Mark creeks, ponds, thickets and bedding areas on the 🗺️ Map page "
               "(tap → '…or mark water / cover / bedding here') and they'll be weighted in.")

# ---------------------------------------------------------------- 6. timing & weather
st.subheader("6 · When to go")
t1, t2 = st.columns(2)
local_now = pd.Timestamp.now(tz="America/Chicago").tz_localize(None).to_pydatetime()
st.session_state.setdefault("shot_time", local_now.time().replace(second=0, microsecond=0))
shot_time = t1.time_input("Time of shot", key="shot_time", step=300)
start = datetime.combine(local_now.date(), shot_time) + timedelta(minutes=wait)
t2.metric("Start tracking at", start.strftime("%-I:%M %p") + (" (next day)" if start.date() > local_now.date()
                                                              else ""))
try:
    wx, tz = ui.cached_hourly(hit_lat, hit_lon)
    now = pd.Timestamp.now(tz=tz)
    nxt = wx[(wx.index >= now.floor("h")) & (wx.index <= now + pd.Timedelta(minutes=wait + 240))]
    rain = nxt[nxt["precip_in"] >= 0.02]
    if len(rain):
        st.warning(f"🌧️ Rain expected around **{rain.index[0]:%-I %p}** — it can wash out the blood trail. "
                   "Mark every drop of blood now (flagging tape / phone pins). For quick-kill hits it can be worth "
                   "starting a little earlier; for gut or liver hits, waiting still matters more than the blood.")
    hot = nxt["temp_f"].max()
    if wait >= 240 and hot >= 50:
        st.warning(f"🌡️ Temperatures up to **{hot:.0f}°F** during the wait — meat can spoil on a long wait. "
                   "Recover and field-dress as soon as the wait allows.")
except Exception:
    pass

# ---------------------------------------------------------------- 7. tips
st.subheader("7 · Tracking tips")
for t in O["tips"]:
    st.markdown(f"- {t}")
with st.expander("General tracking checklist"):
    st.markdown(
        "- Before you climb down, note the exact spot the deer stood when hit and the last place you saw it "
        "(landmark + compass bearing). Drop a pin.\n"
        "- Find the arrow: blood color, bubbles, hair, gut matter and smell tell you more than the hit spot.\n"
        "- Look for hair at the impact site: long dark hair = back; white hair = belly/brisket; brown hair = side.\n"
        "- Mark the last good blood with flagging tape; if the trail stops, search in widening circles or a grid.\n"
        "- Track slowly and quietly, one person on the blood, others looking ahead.\n"
        "- Check thick cover, creek bottoms and downhill benches — wounded deer often head there.\n"
        "- If you jump a deer that isn't expiring, stop, mark the spot and back out — come back later.\n"
        "- Use a bright white or green light at night; blood shows up better.\n"
        "- Tracking dogs may be legal in your state — check regulations and know a handler before you need one."
    )

# ---------------------------------------------------------------- 8. log
with st.expander("💾 Save this shot to your log"):
    note = st.text_area("Notes (recovered? where found?)", key="shot_note")
    if st.button("Save shot", type="primary"):
        log = ui.load("shots", [])
        log.append({
            "id": ui.new_id(), "time": ui.now_str(), "stand": src, "weapon": weapon, "angle": ANGLES[yaw],
            "side": side, "pitch_deg": pitch, "distance_yd": dist, "outcome": O["title"],
            "organs": [h.label for h in res.hits], "evidence": evidence, "arrow": arrow,
            "setup": setup["name"] if setup else None, "reaction": reaction, "ran": ran,
            "hit_lat": round(hit_lat, 6), "hit_lon": round(hit_lon, 6), "notes": note,
        })
        if ui.save("shots", log, "Log shot"):
            st.success("Saved.")
