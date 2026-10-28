"""Hunt log: record sits and deer sightings, and check the forecast against what you actually saw."""

from datetime import datetime, time

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from deercast import __version__, clock, huntlog, scoring, ui, weather
from deercast.weather import deg_to_cardinal

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
def scored_day(lat, lon, day_iso, rut_iso):
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


def rut_for(day, lat):
    return scoring.rut_peak_for(day, lat, st.session_state.get("rut_peak"))


def build_hunt(where, start, end, sightings, notes, harvest):
    lat, lon = where_coords(where)
    rec = {"id": ui.new_id(), "date": start.date().isoformat(), "stand": where, "lat": lat, "lon": lon,
           "start": start.isoformat(), "end": end.isoformat(), "sightings": sightings, "notes": notes,
           "harvest": harvest, "hours": [], "model": __version__}
    try:
        sc, _ = scored_day(lat, lon, start.date().isoformat(), pd.Timestamp(rut_for(start, lat)).isoformat())
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


def sighting_picker(prefix: str, when_fn):
    """How many → (optional) activity / bait → tap the deer type. Returns a new sighting dict or None."""
    count = st.segmented_control("How many", [1, 2, 3, 4, 5, 6, 8, 10], default=1, key=f"{prefix}_n") or 1
    c1, c2 = st.columns(2)
    act = c1.selectbox("Doing (optional)", ["—"] + huntlog.ACTIVITIES, key=f"{prefix}_act")
    bait = c2.selectbox("At bait (optional)", BAIT_NAMES, key=f"{prefix}_bait")
    cols = st.columns(4)
    for col, kind in zip(cols, huntlog.KINDS):
        if col.button(f"+ {kind}", width="stretch", key=f"{prefix}_{kind}", type="primary" if kind == "Buck" else
                      "secondary"):
            return {"time": when_fn().isoformat(), "kind": kind, "count": int(count),
                    "activity": "" if act == "—" else act, "bait": "" if bait == "—" else bait, "notes": ""}
    return None


def sighting_list(sightings: list, prefix: str) -> bool:
    """Show sightings with delete buttons. Returns True if one was removed."""
    for i, x in enumerate(sightings):
        c1, c2 = st.columns([6, 1])
        c1.markdown(f"{KIND_ICON.get(x['kind'], '')} **{pd.Timestamp(x['time']):%-I:%M %p}** — {x.get('count', 1)} "
                    f"{x['kind']}{'s' if x.get('count', 1) > 1 and x['kind'] != 'Unknown' else ''}"
                    + (f" · {x['activity']}" if x.get("activity") else "")
                    + (f" · at {x['bait']}" if x.get("bait") else ""))
        if c2.button("✖", key=f"{prefix}_del_{i}"):
            sightings.pop(i)
            return True
    return False


# ---------------------------------------------------------------- active hunt
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
        sc, _ = scored_day(lat, lon, now.date().isoformat(), pd.Timestamp(rut_for(now, lat)).isoformat())
        h = now.floor("h")
        if h in sc.index:
            nxt = sc.loc[(sc.index > h) & (sc.index <= h + pd.Timedelta(hours=2)), "score"]
            st.caption(f"Forecast this hour **{sc.loc[h, 'score']:.1f}**"
                       + (f" · next hours {' → '.join(f'{v:.1f}' for v in nxt)}" if len(nxt) else ""))
    except Exception:
        pass

    st.markdown("**Deer seen**")
    new = sighting_picker("live", lambda: pd.Timestamp.now(tz=start.tz).floor("min"))
    if new:
        active["sightings"].append(new)
        ui.save("active_hunt", active, f"Sighting: {new['count']} {new['kind']}")
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
            st.success("Hunt saved.")
            st.rerun()
    if e2.button("Discard", width="stretch"):
        ui.save("active_hunt", None, "Discard hunt")
        st.rerun()

# ---------------------------------------------------------------- past hunt entry
with st.expander("➕ Add a past hunt"):
    st.session_state.setdefault("past_sightings", [])
    p1, p2 = st.columns(2)
    pwhere = p1.selectbox("Where", where_options(), key="past_where")
    pdate = p2.date_input("Date", value=pd.Timestamp.now(tz=TZ_DEFAULT).date(), key="past_date",
                          max_value=pd.Timestamp.now(tz=TZ_DEFAULT).date())
    t1, t2 = st.columns(2)
    pstart = t1.time_input("Start", value=time(6, 15), step=300, key="past_start")
    pend = t2.time_input("End", value=time(9, 30), step=300, key="past_end")

    st.markdown("**Deer seen** — set the time and how many, then tap the deer type")
    stime = st.time_input("Time seen", value=time(7, 0), step=300, key="past_stime")
    plat, plon = where_coords(pwhere)
    ptz = tz_for(plat, plon)
    new = sighting_picker("past", lambda: pd.Timestamp(datetime.combine(pdate, stime)).tz_localize(ptz))
    if new:
        st.session_state.past_sightings.append(new)
        st.rerun()
    if sighting_list(st.session_state.past_sightings, "past"):
        st.rerun()
    if not st.session_state.past_sightings:
        st.caption("No deer added — that's fine for a sit where you saw nothing.")

    pnotes = st.text_area("Notes", height=60, key="past_notes")
    pharv = st.checkbox("Harvested a deer", key="past_harv")
    if st.button("Save past hunt", type="primary", width="stretch"):
        s_ts = pd.Timestamp(datetime.combine(pdate, pstart)).tz_localize(ptz)
        e_ts = pd.Timestamp(datetime.combine(pdate, pend)).tz_localize(ptz)
        if e_ts <= s_ts:
            st.error("End time must be after start time.")
        else:
            outside = [x for x in st.session_state.past_sightings
                       if not s_ts <= pd.Timestamp(x["time"]) <= e_ts + pd.Timedelta(minutes=1)]
            if outside:
                st.warning(f"{len(outside)} sighting(s) are outside the hunt's start–end time; saved anyway.")
            rec = build_hunt(pwhere, s_ts, e_ts, list(st.session_state.past_sightings), pnotes, pharv)
            if ui.save("hunts", hunts + [rec], f"Log hunt {rec['date']}"):
                st.session_state.past_sightings = []
                st.success(f"Saved hunt for {pdate:%b %-d, %Y}.")
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
st.subheader(f"Log ({len(hunts)})")
for h in sorted(hunts, key=lambda x: x["start"], reverse=True):
    s, e = pd.Timestamp(h["start"]), pd.Timestamp(h["end"])
    seen = sum(int(x.get("count", 1)) for x in h.get("sightings", []))
    bucks = sum(int(x.get("count", 1)) for x in h.get("sightings", []) if x.get("kind") == "Buck")
    scores = [x["score"] for x in h.get("hours", []) if x.get("score") is not None]
    title = (f"{s:%a %b %-d, %Y} · {s:%-I:%M}–{e:%-I:%M %p} · {h['stand'].replace('Stand: ', '')} · "
             f"{seen} deer ({bucks} buck{'s' if bucks != 1 else ''})" + (" · 🦌 harvest" if h.get("harvest") else ""))
    with st.expander(title):
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
        for x in h.get("sightings", []):
            st.markdown(f"- {pd.Timestamp(x['time']):%-I:%M %p} — {x.get('count', 1)} {x['kind']}"
                        + (f", {x['activity']}" if x.get("activity") else "")
                        + (f", at {x['bait']}" if x.get("bait") else "")
                        + (f" — {x['notes']}" if x.get("notes") else ""))
        if h.get("notes"):
            st.markdown(f"_{h['notes']}_")
        if st.button("Delete this hunt", key=f"del_{h['id']}"):
            ui.save("hunts", [x for x in hunts if x["id"] != h["id"]], "Delete hunt")
            st.rerun()
