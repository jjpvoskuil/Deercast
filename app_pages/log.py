"""Hunt log: record sits and deer sightings, and check the forecast against what you actually saw."""

from datetime import datetime, time

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from deercast import __version__, clock, huntlog, scoring, ui, weather
from deercast.weather import CARDINALS_8, deg_to_cardinal

st.title("🗒️ Hunt Log")

stands = ui.load("stands", [])
BAIT_TYPES = ("feeder", "corn_shelled", "corn_ear", "food_other")
baits = [f for f in ui.load("features", []) if f["type"] in BAIT_TYPES]
BAIT_NAMES = ["—"] + [b.get("name") or b["type"].replace("_", " ") for b in baits]
hunts = ui.load("hunts", [])
loc = ui.get_location()
TZ_DEFAULT = "America/Chicago"
KIND_ICON = {"Buck": "🦌", "Doe": "🫎", "Fawn": "🐾", "Unknown": "❔"}


def where_options():
    return ["Current location"] + [f"Stand: {s['name']}" for s in stands]


def where_coords(label):
    if label.startswith("Stand: "):
        s = next((s for s in stands if f"Stand: {s['name']}" == label), None)
        if s:
            return s["lat"], s["lon"]
    return loc.lat, loc.lon


def tz_for(lat, lon):
    try:
        return ui.cached_hourly(lat, lon)[1]
    except Exception:
        return TZ_DEFAULT


@st.cache_data(ttl=6 * 3600, show_spinner="Scoring the hunt…")
def scored_day(lat, lon, day_iso, rut_iso, schema=weather.SCHEMA):
    """Model scores for one hunt day (fetches the prior day too, for 24 h trends)."""
    day = pd.Timestamp(day_iso)
    tz = tz_for(lat, lon)
    today = pd.Timestamp.now(tz=tz).normalize().tz_localize(None)
    if day >= today - pd.Timedelta(days=1):
        wx, tz = ui.cached_hourly(lat, lon)
    else:
        wx, tz = weather.fetch_hourly_range(lat, lon, day - pd.Timedelta(days=1), day)
    return scoring.score_forecast(wx, lat, lon, tz, scoring.Settings(rut_peak=pd.Timestamp(rut_iso).date()),
                                  start=day.tz_localize(tz)), tz


def rut_for(day, lat, lon):
    return ui.rut_for(day, lat, lon)


def build_hunt(where, start, end, sightings, notes, harvest):
    lat, lon = where_coords(where)
    rec = {"id": ui.new_id(), "date": start.date().isoformat(), "stand": where, "lat": lat, "lon": lon,
           "start": start.isoformat(), "end": end.isoformat(), "sightings": sightings, "notes": notes,
           "harvest": harvest, "hours": [], "model": __version__}
    try:
        sc, _ = scored_day(lat, lon, start.date().isoformat(), pd.Timestamp(rut_for(start, lat, lon)).isoformat())
        rec["hours"] = huntlog.session_hours(start, end, sc, sightings)
        h0 = start.floor("h")
        if h0 in sc.index:
            r = sc.loc[h0]
            rec["weather"] = {"temp_f": round(float(r.temp_f)), "wind_mph": round(float(r.wind_mph)),
                              "wind_from": deg_to_cardinal(float(r.wind_dir)),
                              "pressure_inhg": round(float(r.pressure_inhg), 2), "moon": r.moon_name}
    except Exception as e:
        st.warning(f"Saved without forecast scores (weather unavailable: {e}). Use 'Re-score' later.")
    return rec


DIR_OPTS = ["—"] + CARDINALS_8


def location_fields(prefix: str):
    """Where the deer were relative to the stand, and travel direction. All optional."""
    with st.container(border=True):
        st.caption("📍 Where (optional)")
        c1, c2 = st.columns(2)
        d = c1.selectbox("Direction from stand", DIR_OPTS, key=f"{prefix}_dir")
        dist = c2.number_input("Distance (yd)", 0, 500, 0, step=5, key=f"{prefix}_dist")
        c3, c4 = st.columns(2)
        came = c3.selectbox("Came from", DIR_OPTS, key=f"{prefix}_from")
        went = c4.selectbox("Went toward", DIR_OPTS, key=f"{prefix}_to")
    return {"dir": None if d == "—" else d, "dist_yd": int(dist) or None,
            "came_from": None if came == "—" else came, "went_to": None if went == "—" else went}


def with_position(rec: dict, anchor) -> dict:
    if anchor:
        pos = huntlog.locate(anchor[0], anchor[1], rec.get("dir"), rec.get("dist_yd"))
        if pos:
            rec["lat"], rec["lon"] = pos
    return rec


def _loc_keys(prefix):
    return [f"{prefix}_{k}" for k in ("dir", "dist", "from", "to")]


def sighting_picker(prefix: str, when_fn, anchor=None):
    """How many → (optional) activity / bait / where → tap the deer type. Returns a new sighting dict or None."""
    if st.session_state.pop(f"_{prefix}_qreset", False):
        for k in _loc_keys(f"{prefix}_q"):
            st.session_state.pop(k, None)
    count = st.segmented_control("How many", [1, 2, 3, 4, 5, 6, 8, 10], default=1, key=f"{prefix}_n") or 1
    c1, c2 = st.columns(2)
    act = c1.selectbox("Doing (optional)", ["—"] + huntlog.ACTIVITIES, key=f"{prefix}_act")
    bait = c2.selectbox("At bait (optional)", BAIT_NAMES, key=f"{prefix}_bait")
    where = location_fields(f"{prefix}_q")
    cols = st.columns(4)
    for col, kind in zip(cols, huntlog.KINDS):
        if col.button(f"+ {kind}", width="stretch", key=f"{prefix}_{kind}", type="primary" if kind == "Buck" else
                      "secondary"):
            st.session_state[f"_{prefix}_qreset"] = True
            return with_position({"time": when_fn().isoformat(), "kind": kind, "count": int(count),
                                  "activity": "" if act == "—" else act, "bait": "" if bait == "—" else bait,
                                  "notes": "", **where}, anchor)
    return None


def group_picker(prefix: str, when_fn, anchor=None):
    """Deer seen together: counts per type + one Add. Returns a list of records sharing a group id, or None."""
    keys = [f"{prefix}_c_{k}" for k in huntlog.KINDS] + [f"{prefix}_gact", f"{prefix}_gbait"] + \
        _loc_keys(f"{prefix}_g")
    if st.session_state.pop(f"_{prefix}_greset", False):  # clear after the previous Add
        for k in keys:
            st.session_state.pop(k, None)
    cols = st.columns(4)
    counts = {kind: col.number_input(kind + ("s" if kind != "Unknown" else ""), 0, 30, 0, step=1,
                                     key=f"{prefix}_c_{kind}")
              for col, kind in zip(cols, huntlog.KINDS)}
    c1, c2 = st.columns(2)
    act = c1.selectbox("Doing (optional)", ["—"] + huntlog.ACTIVITIES, key=f"{prefix}_gact")
    bait = c2.selectbox("At bait (optional)", BAIT_NAMES, key=f"{prefix}_gbait")
    where = location_fields(f"{prefix}_g")
    if st.button("➕ Add these deer", width="stretch", key=f"{prefix}_gadd"):
        if not any(counts.values()):
            st.error("Set at least one count above.")
            return None
        t, g = when_fn().isoformat(), ui.new_id()
        st.session_state[f"_{prefix}_greset"] = True
        return [with_position({"time": t, "kind": k, "count": int(n), "activity": "" if act == "—" else act,
                               "bait": "" if bait == "—" else bait, "notes": "", "group": g, **where}, anchor)
                for k, n in counts.items() if n]
    return None


def sighting_list(sightings: list, prefix: str) -> bool:
    """Show sightings (deer seen together on one line) with delete buttons. Returns True if one was removed."""
    for e in huntlog.group_sightings(sightings):
        c1, c2 = st.columns([6, 1])
        icon = KIND_ICON.get(e["deer"][0][0], "") if len(e["deer"]) == 1 else "🦌"
        loc_txt = huntlog.where_text(e)
        c1.markdown(f"{icon} **{pd.Timestamp(e['time']):%-I:%M %p}** — {huntlog.deer_text(e['deer'])}"
                    + (f" · {e['activity']}" if e.get("activity") else "")
                    + (f" · at {e['bait']}" if e.get("bait") else "")
                    + (f"  \n<small>📍 {loc_txt}</small>" if loc_txt else ""), unsafe_allow_html=True)
        if c2.button("✖", key=f"{prefix}_del_{e['group']}"):
            for i in sorted(e["idx"], reverse=True):
                sightings.pop(i)
            return True
    return False


# ---------------------------------------------------------------- active hunt
LIVE_KEYS = ["live_notes", "live_harvest", "live_n", "live_act", "live_bait"]
if st.session_state.pop("_live_reset", False):  # fresh form after a hunt is saved or discarded
    for k in LIVE_KEYS + [k for k in list(st.session_state.keys()) if str(k).startswith(("live_q_", "live_c_",
                                                                                         "live_g"))]:
        st.session_state.pop(k, None)
if msg := st.session_state.pop("_live_saved_msg", None):
    st.success(msg)

active = ui.load("active_hunt", None)
st.subheader("In the stand")
if not active:
    where = st.selectbox("Where", where_options(), key="log_where")
    lat, lon = where_coords(where)
    tz = tz_for(lat, lon)
    now = pd.Timestamp.now(tz=tz)
    try:
        tg = clock.sun_targets(lat, lon, now, tz)
        ui.html_frame(clock.clock_html(None, tg, clock.hunt_period(now, tg)), height=78)
    except Exception:
        pass
    if st.button("▶ Start hunt now", type="primary", width="stretch"):
        ui.save("active_hunt", {"where": where, "start": now.floor("min").isoformat(), "sightings": []}, "Start hunt")
        st.rerun()
else:
    start = pd.Timestamp(active["start"])
    lat, lon = where_coords(active["where"])
    tz = str(start.tz)
    now = pd.Timestamp.now(tz=start.tz)
    st.markdown(f"**{active['where'].replace('Stand: ', '')}** · since {start:%-I:%M %p}")
    try:
        tg = clock.sun_targets(lat, lon, start, tz)
        ui.html_frame(clock.clock_html(start, tg, clock.hunt_period(start, tg)), height=110)
    except Exception:
        pass
    try:
        sc, _ = scored_day(lat, lon, now.date().isoformat(), pd.Timestamp(rut_for(now, lat, lon)).isoformat())
        h = now.floor("h")
        if h in sc.index:
            nxt = sc.loc[(sc.index > h) & (sc.index <= h + pd.Timedelta(hours=2)), "score"]
            st.caption(f"Forecast this hour **{sc.loc[h, 'score']:.1f}**"
                       + (f" · next hours {' → '.join(f'{v:.1f}' for v in nxt)}" if len(nxt) else ""))
    except Exception:
        pass

    st.markdown("**Deer seen**")
    new = sighting_picker("live", lambda: pd.Timestamp.now(tz=start.tz).floor("min"), anchor=(lat, lon))
    if new:
        active["sightings"].append(new)
        ui.save("active_hunt", active, f"Sighting: {new['count']} {new['kind']}")
        st.rerun()
    with st.expander("Several deer together (e.g. doe + fawns)"):
        grp = group_picker("live", lambda: pd.Timestamp.now(tz=start.tz).floor("min"), anchor=(lat, lon))
    if grp:
        active["sightings"].extend(grp)
        ui.save("active_hunt", active, "Sighting group")
        st.rerun()
    if sighting_list(active["sightings"], "live"):
        ui.save("active_hunt", active, "Remove sighting")
        st.rerun()

    notes = st.text_area("Notes for this sit", key="live_notes", height=70)
    harvest = st.checkbox("Harvested a deer", key="live_harvest")
    e1, e2 = st.columns(2)
    if e1.button("■ End & save hunt", type="primary", width="stretch"):
        end = max(pd.Timestamp.now(tz=start.tz).floor("min"), start + pd.Timedelta(minutes=1))
        rec = build_hunt(active["where"], start, end, active["sightings"], notes, harvest)
        if ui.save("hunts", hunts + [rec], f"Log hunt {rec['date']}"):
            ui.save("active_hunt", None, "End hunt")
            st.session_state._live_reset = True
            st.session_state._live_saved_msg = "Hunt saved — ready for the next one."
            st.rerun()
    if e2.button("Discard", width="stretch"):
        ui.save("active_hunt", None, "Discard hunt")
        st.session_state._live_reset = True
        st.rerun()

# ---------------------------------------------------------------- past hunt entry
PAST_KEYS = ["past_date", "past_start", "past_end", "past_stime", "past_notes", "past_harv"]
if st.session_state.pop("_past_reset", False):  # clear the form after a save (keeps 'Where')
    for k in PAST_KEYS:
        st.session_state.pop(k, None)
    st.session_state["_past_greset"] = True
    st.session_state.past_sightings = []
if msg := st.session_state.pop("_past_saved_msg", None):
    st.success(msg)

with st.expander("➕ Add a past hunt"):
    st.session_state.setdefault("past_sightings", [])
    today_local = pd.Timestamp.now(tz=TZ_DEFAULT).date()
    p1, p2 = st.columns(2)
    pwhere = p1.selectbox("Where", where_options(), key="past_where")
    pdate = p2.date_input("Date", value=today_local, key="past_date", max_value=today_local)
    t1, t2 = st.columns(2)
    pstart = t1.time_input("Start", value=time(6, 15), step=300, key="past_start")
    pend = t2.time_input("End", value=time(9, 30), step=300, key="past_end")

    st.markdown("**Deer seen** — set the time and how many of each, then **Add**. Deer seen together go in one "
                "entry (e.g. 1 doe + 2 fawns).")
    stime = st.time_input("Time seen", value=time(7, 0), step=300, key="past_stime")
    plat, plon = where_coords(pwhere)
    ptz = tz_for(plat, plon)
    grp = group_picker("past", lambda: pd.Timestamp(datetime.combine(pdate, stime)).tz_localize(ptz),
                       anchor=(plat, plon))
    if grp:
        st.session_state.past_sightings.extend(grp)
        st.rerun()
    if sighting_list(st.session_state.past_sightings, "past"):
        st.rerun()
    if not st.session_state.past_sightings:
        st.caption("No deer added yet — that's fine for a sit where you saw nothing.")

    pnotes = st.text_area("Notes", height=60, key="past_notes")
    pharv = st.checkbox("Harvested a deer", key="past_harv")
    if st.button("💾 Save past hunt", type="primary", width="stretch"):
        s_ts = pd.Timestamp(datetime.combine(pdate, pstart)).tz_localize(ptz)
        e_ts = pd.Timestamp(datetime.combine(pdate, pend)).tz_localize(ptz)
        if e_ts <= s_ts:
            st.error("End time must be after start time.")
        else:
            rec = build_hunt(pwhere, s_ts, e_ts, list(st.session_state.past_sightings), pnotes, pharv)
            if ui.save("hunts", hunts + [rec], f"Log hunt {rec['date']}"):
                n = sum(x["count"] for x in rec["sightings"])
                st.session_state._past_reset = True
                st.session_state._past_saved_msg = (f"Saved {pdate:%b %-d, %Y} hunt ({n} deer). The form is clear "
                                                    "for the next one.")
                st.rerun()

# ---------------------------------------------------------------- forecast check
st.subheader("Does the forecast work?")
v = huntlog.validation(hunts)
if not v.get("n_hours"):
    st.info("Log a few sits and this section will compare the forecast score for each hour you hunted with how many "
            "deer you actually saw.")
else:
    k1, k2, k3 = st.columns(3)
    k1.metric("Sits", v["n_hunts"])
    k2.metric("Hours scored", v["n_hours"])
    k3.metric("Score ↔ sightings", "—" if pd.isna(v["rho"]) else f"{v['rho']:+.2f}",
              help="Rank correlation between the hourly forecast score and deer seen per hour. "
                   "+1 = perfect, 0 = none, negative = backwards.")
    st.markdown(f"**{v['verdict']}**")
    b = v["bands"]
    fig = go.Figure(go.Bar(x=b["band"].astype(str), y=b["deer_per_hour"].fillna(0),
                           marker_color=["#d7261e", "#e07b24", "#e9c46a", "#8cc152", "#2e9e4f"],
                           text=[f"{h:.1f} h" for h in b["hours"]], textposition="outside",
                           hovertemplate="Score %{x}<br>%{y:.2f} deer/hour<extra></extra>"))
    ui.lock_figure(fig, height=260)
    fig.update_layout(xaxis_title="Forecast score", yaxis_title="Deer seen per hour")
    st.plotly_chart(fig, width="stretch", config=ui.PLOTLY_CONFIG)
    st.caption("Bars = deer seen per hour hunted in each forecast-score band; labels = hours hunted in that band. "
               "If the forecast works, bars should rise left to right.")
    missing = [h for h in hunts if not h.get("hours")]
    if missing and st.button(f"Re-score {len(missing)} hunt(s) missing forecast scores"):
        for h in missing:
            rec = build_hunt(h["stand"], pd.Timestamp(h["start"]), pd.Timestamp(h["end"]), h["sightings"],
                             h.get("notes", ""), h.get("harvest", False))
            h.update({k: rec.get(k) for k in ("hours", "weather", "model")})
        ui.save("hunts", hunts, "Re-score hunts")
        st.rerun()

# ---------------------------------------------------------------- log list
ED_KEYS = ["ed_where", "ed_date", "ed_start", "ed_end", "ed_notes", "ed_harv", "ed_stime"]


def _close_editor():
    st.session_state._ed_close = True


# open / close the editor BEFORE any edit widgets are drawn (Streamlit won't let us change them afterwards)
if st.session_state.pop("_ed_close", False):
    for k in ED_KEYS + ["ed_id", "ed_sightings"]:
        st.session_state.pop(k, None)
    st.session_state["_ed_greset"] = True
if (open_id := st.session_state.pop("_ed_open", None)):
    h0 = next((x for x in hunts if x["id"] == open_id), None)
    if h0:
        s0, e0 = pd.Timestamp(h0["start"]), pd.Timestamp(h0["end"])
        st.session_state.update({
            "ed_id": open_id, "ed_where": h0["stand"], "ed_date": s0.date(), "ed_start": s0.time(),
            "ed_end": e0.time(), "ed_notes": h0.get("notes", ""), "ed_harv": bool(h0.get("harvest")),
            "ed_stime": s0.floor("h").time(), "ed_sightings": [dict(x) for x in h0.get("sightings", [])]})
        st.session_state["_ed_greset"] = True
if msg := st.session_state.pop("_ed_saved_msg", None):
    st.success(msg)


def edit_form(h):
    """Inline editor for a logged hunt."""
    tz = str(pd.Timestamp(h["start"]).tz)
    opts = where_options()
    if st.session_state.get("ed_where") not in opts:  # stand renamed/deleted since logging
        opts = opts + [st.session_state["ed_where"]]
    with st.container(border=True):
        st.markdown("**✏️ Editing this hunt**")
        c1, c2 = st.columns(2)
        where = c1.selectbox("Where", opts, key="ed_where")
        day = c2.date_input("Date", key="ed_date", max_value=pd.Timestamp.now(tz=tz).date())
        t1, t2 = st.columns(2)
        t_start = t1.time_input("Start", key="ed_start", step=300)
        t_end = t2.time_input("End", key="ed_end", step=300)

        st.markdown("**Deer seen**")
        sights = st.session_state.ed_sightings
        if sighting_list(sights, "ed"):
            st.rerun()
        if not sights:
            st.caption("No deer logged for this hunt.")
        with st.expander("➕ Add deer"):
            stime = st.time_input("Time seen", key="ed_stime", step=300)
            elat, elon = where_coords(where)
            grp = group_picker("ed", lambda: pd.Timestamp(datetime.combine(day, stime)).tz_localize(tz),
                               anchor=(elat, elon))
            if grp:
                sights.extend(grp)
                st.rerun()
        notes = st.text_area("Notes", key="ed_notes", height=60)
        harv = st.checkbox("Harvested a deer", key="ed_harv")
        b1, b2 = st.columns(2)
        if b1.button("💾 Save changes", type="primary", width="stretch", key="ed_save"):
            s_ts = pd.Timestamp(datetime.combine(day, t_start)).tz_localize(tz)
            e_ts = pd.Timestamp(datetime.combine(day, t_end)).tz_localize(tz)
            if e_ts <= s_ts:
                st.error("End time must be after start time.")
                return
            # keep each sighting's clock time but move it to the (possibly new) date; re-place on the map
            alat, alon = where_coords(where)
            fixed = []
            for x in sights:
                x = dict(x)
                t = pd.Timestamp(x["time"]).tz_convert(tz)
                x["time"] = pd.Timestamp(datetime.combine(day, t.time())).tz_localize(tz).isoformat()
                x.pop("lat", None), x.pop("lon", None)
                fixed.append(with_position(x, (alat, alon)))
            rec = build_hunt(where, s_ts, e_ts, fixed, notes, harv)
            rec["id"] = h["id"]
            rec["edited"] = ui.now_str()
            if ui.save("hunts", [rec if x["id"] == h["id"] else x for x in hunts], f"Edit hunt {rec['date']}"):
                st.session_state._ed_saved_msg = f"Updated the {day:%b %-d} hunt."
                _close_editor()
                st.rerun()
        if b2.button("Cancel", width="stretch", key="ed_cancel"):
            _close_editor()
            st.rerun()


st.subheader(f"Log ({len(hunts)})")
editing = st.session_state.get("ed_id")
for h in sorted(hunts, key=lambda x: x["start"], reverse=True):
    s, e = pd.Timestamp(h["start"]), pd.Timestamp(h["end"])
    seen = sum(int(x.get("count", 1)) for x in h.get("sightings", []))
    bucks = sum(int(x.get("count", 1)) for x in h.get("sightings", []) if x.get("kind") == "Buck")
    scores = [x["score"] for x in h.get("hours", []) if x.get("score") is not None]
    title = (f"{s:%a %b %-d, %Y} · {s:%-I:%M}–{e:%-I:%M %p} · {h['stand'].replace('Stand: ', '')} · "
             f"{seen} deer ({bucks} buck{'s' if bucks != 1 else ''})" + (" · 🦌 harvest" if h.get("harvest") else ""))
    with st.expander(title, expanded=editing == h["id"]):
        if editing == h["id"]:
            edit_form(h)
            continue
        if scores:
            st.caption(f"Forecast during sit: avg {sum(scores) / len(scores):.1f}, best {max(scores):.1f}")
        if h.get("weather"):
            wx = h["weather"]
            st.caption(f"{wx['temp_f']}°F · wind {wx['wind_from']} {wx['wind_mph']} mph · {wx['pressure_inhg']} inHg · "
                       f"{wx['moon']}")
        if h.get("hours"):
            st.dataframe(pd.DataFrame([{"Hour": pd.Timestamp(x["hour"]).strftime("%-I %p"), "Score": x["score"],
                                        "Minutes": x["minutes"], "Deer seen": x["seen"]} for x in h["hours"]]),
                         hide_index=True, width="stretch")
        for g in huntlog.group_sightings(h.get("sightings", [])):
            st.markdown(f"- {pd.Timestamp(g['time']):%-I:%M %p} — {huntlog.deer_text(g['deer'])}"
                        + (f", {g['activity']}" if g.get("activity") else "")
                        + (f", at {g['bait']}" if g.get("bait") else "")
                        + (f" ({huntlog.where_text(g)})" if huntlog.where_text(g) else "")
                        + (f" — {g['notes']}" if g.get("notes") else ""))
        if h.get("notes"):
            st.markdown(f"_{h['notes']}_")
        if h.get("edited"):
            st.caption(f"Edited {h['edited']}")
        b1, b2 = st.columns(2)
        if b1.button("✏️ Edit", key=f"edit_{h['id']}", width="stretch", disabled=bool(editing)):
            st.session_state._ed_open = h["id"]
            st.rerun()
        if b2.button("🗑 Delete", key=f"del_{h['id']}", width="stretch"):
            st.session_state[f"_confirm_del_{h['id']}"] = True
            st.rerun()
        if st.session_state.get(f"_confirm_del_{h['id']}"):
            st.warning("Delete this hunt permanently?")
            c1, c2 = st.columns(2)
            if c1.button("Yes, delete", key=f"delyes_{h['id']}", type="primary", width="stretch"):
                ui.save("hunts", [x for x in hunts if x["id"] != h["id"]], "Delete hunt")
                st.session_state.pop(f"_confirm_del_{h['id']}", None)
                st.rerun()
            if c2.button("Keep it", key=f"delno_{h['id']}", width="stretch"):
                st.session_state.pop(f"_confirm_del_{h['id']}", None)
                st.rerun()
