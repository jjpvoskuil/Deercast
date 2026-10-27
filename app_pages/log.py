"""Hunt log: record sits and deer sightings, and check the forecast against what you actually saw."""

from datetime import datetime, time

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from deercast import huntlog, scoring, ui, weather
from deercast.weather import deg_to_cardinal

st.title("🗒️ Hunt Log")

stands = ui.load("stands", [])
baits = [f for f in ui.load("features", []) if f["type"] in ("feeder", "corn_shelled", "corn_ear", "food_other")]
hunts = ui.load("hunts", [])
loc = ui.get_location()
TZ_DEFAULT = "America/Chicago"


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
def scored_range(lat, lon, day_iso, rut_iso):
    """Model scores for the hunt day (needs the prior day for trends)."""
    day = pd.Timestamp(day_iso)
    tz = tz_for(lat, lon)
    today = pd.Timestamp.now(tz=tz).normalize().tz_localize(None)
    if day >= today - pd.Timedelta(days=1):
        wx, tz = ui.cached_hourly(lat, lon)
    else:
        wx, tz = weather.fetch_hourly_range(lat, lon, day - pd.Timedelta(days=1), day)
    start = pd.Timestamp(day).tz_localize(tz)
    return scoring.score_forecast(wx, lat, lon, tz, scoring.Settings(rut_peak=pd.Timestamp(rut_iso).date()),
                                  start=start), tz


def build_hunt(where, start, end, sightings, notes, harvest):
    lat, lon = where_coords(where)
    rut = st.session_state.get("rut_peak", scoring.default_rut_peak(lat, start.year))
    rec = {"id": ui.new_id(), "date": start.date().isoformat(), "stand": where, "lat": lat, "lon": lon,
           "start": start.isoformat(), "end": end.isoformat(), "sightings": sightings, "notes": notes,
           "harvest": harvest, "hours": [], "model": scoring.__name__}
    try:
        sc, tz = scored_range(lat, lon, start.date().isoformat(), pd.Timestamp(rut).isoformat())
        rec["hours"] = huntlog.session_hours(start, end, sc, sightings)
        h0 = start.floor("h")
        if h0 in sc.index:
            r = sc.loc[h0]
            rec["weather"] = {"temp_f": round(float(r.temp_f)), "wind_mph": round(float(r.wind_mph)),
                              "wind_from": deg_to_cardinal(float(r.wind_dir)), "pressure_inhg": round(float(r.pressure_inhg), 2),
                              "moon": r.moon_name}
    except Exception as e:
        st.warning(f"Saved without forecast scores (weather unavailable: {e}). Use 'Re-score' later.")
    from deercast import __version__
    rec["model"] = __version__
    return rec


# ---------------------------------------------------------------- active hunt
active = ui.load("active_hunt", None)
st.subheader("In the stand")
if not active:
    c1, c2 = st.columns([3, 2])
    where = c1.selectbox("Where", where_options(), key="log_where")
    c2.write("")
    if c2.button("▶ Start hunt now", type="primary", width="stretch"):
        lat, lon = where_coords(where)
        now = pd.Timestamp.now(tz=tz_for(lat, lon)).floor("min")
        ui.save("active_hunt", {"where": where, "start": now.isoformat(), "sightings": []}, "Start hunt")
        st.rerun()
else:
    start = pd.Timestamp(active["start"])
    now = pd.Timestamp.now(tz=start.tz).floor("min")
    mins = int((now - start).total_seconds() // 60)
    lat, lon = where_coords(active["where"])
    cur = None
    try:
        sc, _ = scored_range(lat, lon, now.date().isoformat(),
                             pd.Timestamp(st.session_state.get("rut_peak",
                                                               scoring.default_rut_peak(lat, now.year))).isoformat())
        cur = sc.loc[now.floor("h"), "score"] if now.floor("h") in sc.index else None
    except Exception:
        pass
    m1, m2, m3 = st.columns(3)
    m1.metric("Hunting", active["where"].replace("Stand: ", ""))
    m2.metric("Time on stand", f"{mins // 60}h {mins % 60:02d}m", f"since {start:%-I:%M %p}", delta_color="off")
    m3.metric("Forecast this hour", f"{cur:.1f}" if cur is not None else "—")

    st.markdown("**Deer seen — tap as they show up**")
    q = st.columns(4)
    for col, kind in zip(q, huntlog.KINDS):
        if col.button(f"+ {kind}", width="stretch", key=f"q_{kind}"):
            active["sightings"].append({"time": now.isoformat(), "kind": kind, "count": 1, "activity": "",
                                        "bait": "", "notes": ""})
            ui.save("active_hunt", active, f"Sighting: {kind}")
            st.rerun()

    if active["sightings"]:
        df = pd.DataFrame(active["sightings"])
        df["when"] = [pd.Timestamp(t).strftime("%-I:%M %p") for t in df["time"]]
        bait_names = [""] + [b.get("name") or b["type"] for b in baits]
        ed = st.data_editor(
            df[["when", "kind", "count", "activity", "bait", "notes"]], hide_index=True, width="stretch",
            num_rows="dynamic", key="active_editor",
            column_config={
                "when": st.column_config.TextColumn("Time", disabled=True),
                "kind": st.column_config.SelectboxColumn("Deer", options=huntlog.KINDS, required=True),
                "count": st.column_config.NumberColumn("#", min_value=1, max_value=50, step=1),
                "activity": st.column_config.SelectboxColumn("Doing", options=[""] + huntlog.ACTIVITIES),
                "bait": st.column_config.SelectboxColumn("At bait", options=bait_names),
                "notes": st.column_config.TextColumn("Notes"),
            },
        )
        if st.button("Save sighting details"):
            keep = []
            for i, row in ed.reset_index(drop=True).iterrows():
                if i < len(active["sightings"]):
                    s = active["sightings"][i]
                    s.update({k: (row[k] if pd.notna(row[k]) else "") for k in ["kind", "activity", "bait", "notes"]})
                    s["count"] = int(row["count"]) if pd.notna(row["count"]) else 1
                    keep.append(s)
            active["sightings"] = keep
            ui.save("active_hunt", active, "Edit sightings")
            st.rerun()

    with st.form("end_hunt"):
        notes = st.text_area("Notes for this sit", height=70)
        harvest = st.checkbox("Harvested a deer")
        e1, e2 = st.columns(2)
        end_btn = e1.form_submit_button("■ End & save hunt", type="primary")
        cancel = e2.form_submit_button("Discard")
    if end_btn:
        rec = build_hunt(active["where"], start, max(now, start + pd.Timedelta(minutes=1)), active["sightings"],
                         notes, harvest)
        if ui.save("hunts", hunts + [rec], f"Log hunt {rec['date']}"):
            ui.save("active_hunt", None, "End hunt")
            st.success("Hunt saved.")
            st.rerun()
    if cancel:
        ui.save("active_hunt", None, "Discard hunt")
        st.rerun()

# ---------------------------------------------------------------- past hunt entry
with st.expander("➕ Add a past hunt"):
    with st.form("past_hunt", clear_on_submit=True):
        p1, p2 = st.columns(2)
        pwhere = p1.selectbox("Where", where_options())
        pdate = p2.date_input("Date", value=pd.Timestamp.now(tz=TZ_DEFAULT).date())
        t1, t2 = st.columns(2)
        pstart = t1.time_input("Start", value=time(6, 15), step=300)
        pend = t2.time_input("End", value=time(9, 30), step=300)
        st.caption("Deer seen (one row per sighting):")
        blank = pd.DataFrame([{"time": time(7, 0), "kind": "Doe", "count": 1, "activity": "", "notes": ""}])
        sight_df = st.data_editor(
            blank.iloc[0:0], num_rows="dynamic", hide_index=True, width="stretch",
            column_config={
                "time": st.column_config.TimeColumn("Time", step=300, required=True),
                "kind": st.column_config.SelectboxColumn("Deer", options=huntlog.KINDS, required=True),
                "count": st.column_config.NumberColumn("#", min_value=1, step=1, default=1),
                "activity": st.column_config.SelectboxColumn("Doing", options=[""] + huntlog.ACTIVITIES),
                "notes": st.column_config.TextColumn("Notes"),
            },
        )
        pnotes = st.text_area("Notes", height=60)
        pharv = st.checkbox("Harvested a deer")
        if st.form_submit_button("Save past hunt", type="primary"):
            lat, lon = where_coords(pwhere)
            tz = tz_for(lat, lon)
            s_ts = pd.Timestamp(datetime.combine(pdate, pstart)).tz_localize(tz)
            e_ts = pd.Timestamp(datetime.combine(pdate, pend)).tz_localize(tz)
            if e_ts <= s_ts:
                st.error("End time must be after start time.")
            else:
                sights = [{"time": pd.Timestamp(datetime.combine(pdate, r["time"])).tz_localize(tz).isoformat(),
                           "kind": r["kind"], "count": int(r["count"] or 1), "activity": r.get("activity") or "",
                           "bait": "", "notes": r.get("notes") or ""}
                          for _, r in sight_df.iterrows() if pd.notna(r.get("time")) and r.get("kind")]
                rec = build_hunt(pwhere, s_ts, e_ts, sights, pnotes, pharv)
                if ui.save("hunts", hunts + [rec], f"Log hunt {rec['date']}"):
                    st.success("Saved.")
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
    fig = go.Figure(go.Bar(x=b["band"].astype(str), y=b["deer_per_hour"].fillna(0), marker_color="#e07b24",
                           text=[f"{h:.1f} h" for h in b["hours"]], textposition="outside",
                           hovertemplate="Score %{x}<br>%{y:.2f} deer/hour<extra></extra>"))
    fig.update_layout(height=260, margin=dict(l=0, r=0, t=20, b=0), xaxis_title="Forecast score",
                      yaxis_title="Deer seen per hour")
    st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})
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
    title = (f"{s:%a %b %-d} · {s:%-I:%M}–{e:%-I:%M %p} · {h['stand'].replace('Stand: ', '')} · "
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
