"""Bow / crossbow setups: estimated speed, energy, momentum — used by the Shot & Recovery page."""

import pandas as pd
import streamlit as st

from deercast import archery, ui

st.title("🏹 Bow Setup")
st.caption("Enter your setup once. The Shot & Recovery page uses it to judge penetration — e.g. whether an arrow "
           "that hit the shoulder likely broke through to the vitals.")

gear = ui.load("gear", {"setups": [], "active": None})
setups = gear["setups"]
names = [s["name"] for s in setups]

if "_gear_next" in st.session_state:  # selection requested by the previous run (save/delete)
    st.session_state.gear_pick = st.session_state.pop("_gear_next")
if st.session_state.get("gear_pick") not in names + ["➕ New setup"]:
    st.session_state.gear_pick = next((s["name"] for s in setups if s["id"] == gear.get("active")),
                                      names[0] if names else "➕ New setup")
choice = st.selectbox("Setup", names + ["➕ New setup"], key="gear_pick")
cur = next((s for s in setups if s["name"] == choice), None)
d = cur or {}

with st.form("gear_form"):
    name = st.text_input("Name", d.get("name", "My bow" if not setups else ""))
    c1, c2 = st.columns(2)
    bow_type = c1.selectbox("Type", archery.BOW_TYPES, index=archery.BOW_TYPES.index(d.get("bow_type", "Compound")))
    bow_model = c2.text_input("Bow make / model", d.get("bow_model", ""))
    c1, c2 = st.columns(2)
    rated = c1.number_input("Rated speed — IBO/ATA (compound) or rated fps (crossbow)", 0, 600,
                            int(d.get("rated_fps") or (340 if bow_type == "Compound" else 0)), step=5)
    rated_bolt = c2.number_input("Crossbow: bolt weight for rated speed (gr)", 0, 800,
                                 int(d.get("rated_bolt_gr") or 400), step=5)
    c1, c2 = st.columns(2)
    dw = c1.number_input("Draw weight (lb)", 0, 200, int(d.get("draw_weight") or 65), step=1)
    dl = c2.number_input("Draw length (in)", 20.0, 34.0, float(d.get("draw_length") or 29.0), step=0.5)
    c1, c2 = st.columns(2)
    arrow = c1.text_input("Arrow / bolt", d.get("arrow_model", ""))
    aw = c2.number_input("Total arrow weight incl. tip (gr)", 150, 1200, int(d.get("arrow_gr") or 425), step=5)
    c1, c2 = st.columns(2)
    tip_type = c1.selectbox("Tip", list(archery.TIP_FACTOR),
                            index=list(archery.TIP_FACTOR).index(d.get("tip_type", "Fixed-blade broadhead")))
    tip = c2.text_input("Broadhead make / weight / cut", d.get("tip_model", ""), placeholder="e.g. 100 gr, 1-3/16\" cut")
    c1, c2 = st.columns(2)
    string_gr = c1.number_input("String accessories (peep, loop, silencers) gr", 0, 100,
                                int(d.get("string_gr") or 15), step=1)
    chrono = c2.number_input("Chronograph speed (fps, optional — overrides estimate)", 0, 600,
                             int(d.get("chrono_fps") or 0), step=1)
    b1, b2 = st.columns(2)
    save = b1.form_submit_button("Save setup", type="primary")
    delete = b2.form_submit_button("Delete setup") if cur else False

if save:
    if not name.strip():
        st.error("Name the setup.")
    else:
        rec = {"id": (cur or {}).get("id") or ui.new_id(), "name": name.strip(), "bow_type": bow_type,
               "bow_model": bow_model, "rated_fps": rated, "rated_bolt_gr": rated_bolt, "draw_weight": dw,
               "draw_length": dl, "arrow_model": arrow, "arrow_gr": aw, "tip_type": tip_type, "tip_model": tip,
               "string_gr": string_gr, "chrono_fps": chrono or None}
        setups = [s for s in setups if s["id"] != rec["id"] and s["name"] != rec["name"]] + [rec]
        if ui.save("gear", {"setups": setups, "active": rec["id"]}, f"Save setup {rec['name']}"):
            st.session_state._gear_next = rec["name"]
            st.rerun()
if delete and cur:
    rest = [s for s in setups if s["id"] != cur["id"]]
    ui.save("gear", {"setups": rest, "active": rest[0]["id"] if rest else None}, "Delete setup")
    st.session_state._gear_next = rest[0]["name"] if rest else "➕ New setup"
    st.rerun()

if cur:
    if gear.get("active") != cur["id"] and st.button(f"Use “{cur['name']}” on the Shot page", width="stretch"):
        gear["active"] = cur["id"]
        ui.save("gear", gear, "Set active setup")
        st.rerun()
    if gear.get("active") == cur["id"]:
        st.success("✓ Active setup — used on the Shot & Recovery page.")
    s = archery.summary(cur)
    if not s:
        st.info("Enter the rated speed (or a chronograph speed), draw weight and arrow weight to see the numbers.")
    else:
        m1, m2, m3 = st.columns(3)
        m1.metric("Arrow speed", f"{s['fps']:.0f} fps", "measured" if s["measured"] else "estimated",
                  delta_color="off")
        m2.metric("Kinetic energy", f"{s['ke']:.0f} ft·lb", s["ke_class"], delta_color="off")
        m3.metric("Momentum", f"{s['momentum']:.2f}", f"bone: {s['bone']}", delta_color="off")
        if s.get("gpp"):
            st.caption(f"{s['gpp']:.1f} grains per pound of draw weight"
                       + (" — light; heavier arrows penetrate better." if s["gpp"] < 6 else "."))
        st.markdown(
            {"High": "**Bone penetration: High.** Good odds of breaking through a deer's shoulder blade with this "
                     "setup.",
             "Moderate": "**Bone penetration: Moderate.** May break through the shoulder blade, but heavy bone can "
                         "stop or deflect it.",
             "Low": "**Bone penetration: Low.** Expect heavy shoulder bone to stop or deflect the arrow — avoid "
                    "quartering-toward and on-the-shoulder shots."}.get(s["bone"], ""))
        rows = [{"Distance": f"{y} yd", "Flight time": f"{archery.flight_time(s['fps'], y):.2f} s",
                 "Sound reaches deer": f"{y * 3 / 1125:.2f} s"} for y in (10, 20, 30, 40)]
        st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")
        st.caption("A relaxed deer hearing the shot can start to drop/turn within ~0.1–0.3 s — the longer the flight "
                   "time, the more a deer can 'jump the string'. Aim low-center on alert deer at longer range.")
        st.caption("Estimates use standard rules of thumb from the IBO/ATA rating. A chronograph reading is more "
                   "accurate. Kinetic energy and momentum guidelines are general industry rules, not guarantees.")
