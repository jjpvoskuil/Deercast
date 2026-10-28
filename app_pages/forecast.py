"""14-day hourly deer activity forecast."""

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from deercast import beststand, daychart, scoring, terrain, ui
from deercast.weather import deg_to_cardinal

st.title("🦌 Deer Activity Forecast")

loc = ui.location_picker()
with st.sidebar:
    st.divider()
    rut_peak = ui.rut_peak_setting(loc.lat, loc.lon, loc.state)
    legal_only = st.toggle("Legal shooting hours only", value=True)

st.caption(f"📍 **{loc.label}** · peak rut set to **{rut_peak:%b %d}** · change location/rut date in the sidebar (›)")

try:
    wx, tz = ui.cached_hourly(loc.lat, loc.lon)
except Exception as e:
    st.error(f"Weather forecast unavailable right now: {e}")
    st.stop()

scored = scoring.score_forecast(wx, loc.lat, loc.lon, tz, scoring.Settings(rut_peak=rut_peak))
daily = scoring.best_windows(scored, legal_only=True)

# ---------------------------------------------------------------- top picks
top = daily.sort_values("best_score", ascending=False).head(3)
cols = st.columns(3)
for c, (d, r) in zip(cols, top.iterrows()):
    c.metric(
        f"{pd.Timestamp(d):%a %b %d}",
        f"{r.best_score:.1f}",
        f"best ~{r.best_hour:%-I %p}",
        delta_color="off",
    )

# ---------------------------------------------------------------- best stand
stands = ui.load("stands", [])
st.subheader("🏆 Best stand")
if not stands:
    st.info("Add your stands on the 🗺️ Map page and this will rank them for each morning and evening sit.")
else:
    slat = sum(s_["lat"] for s_ in stands) / len(stands)
    slon = sum(s_["lon"] for s_ in stands) / len(stands)
    try:
        if abs(slat - loc.lat) + abs(slon - loc.lon) < 0.02:
            s_scored = scored
        else:  # forecast location is elsewhere — score at the stands
            swx, stz = ui.cached_hourly(slat, slon)
            s_scored = scoring.score_forecast(swx, slat, slon, stz, scoring.Settings(
                rut_peak=ui.rut_for(pd.Timestamp.now(), slat, slon)))
        days_s = sorted(set(s_scored["date"]))
        now_local = pd.Timestamp.now(tz=s_scored.index.tz)
        default_day = days_s[0] if now_local.hour < 17 else days_s[min(1, len(days_s) - 1)]
        bday = st.selectbox("Day", days_s, index=days_s.index(default_day), key="best_day",
                            format_func=lambda d: ("Today" if d == now_local.date() else
                                                   "Tomorrow" if d == (now_local + pd.Timedelta(days=1)).date()
                                                   else pd.Timestamp(d).strftime("%a %b %-d")))
        pts5 = [p for s_ in stands for p in terrain.slope_points(s_["lat"], s_["lon"])]
        elev = ui.cached_elevations(tuple((round(a, 5), round(b, 5)) for a, b in pts5))
        slopes = ({s_["id"]: terrain.slope_from(elev[5 * i:5 * i + 5]) for i, s_ in enumerate(stands)}
                  if elev and len(elev) == len(pts5) else {})
        hunts_all = ui.load("hunts", [])
        day_df = s_scored[s_scored["date"] == bday]
        cols = st.columns(2)
        for col, sess in zip(cols, ["Morning", "Evening"]):
            ranked = beststand.rank(stands, day_df, sess, hunts_all, slopes)
            with col:
                st.markdown(f"**{'🌅' if sess == 'Morning' else '🌇'} {sess}**")
                if not ranked:
                    st.caption("No legal hours in this window.")
                for i, r in enumerate(ranked):
                    medal = ["🥇", "🥈", "🥉"][i] if i < 3 else "•"
                    st.markdown(f"{medal} **{r['stand']['name']}** — {r['score']:.1f}  \n"
                                f"<small>{' · '.join(r['reasons'])}</small>", unsafe_allow_html=True)
        st.caption("Score = best forecast hours × how often your scent goes the right way for that stand (wind + "
                   "thermals vs. its good wind directions) × your logged sightings there. Set good winds on each "
                   "stand on the Map page.")
    except Exception as e:
        st.warning(f"Best-stand ranking unavailable: {e}")

# ---------------------------------------------------------------- heatmap
st.subheader("Hourly activity (0–10)")
view = scored.copy()
if legal_only:
    view.loc[~view["legal"], "score"] = np.nan
pivot = view.pivot_table(index="date", columns=view.index.hour, values="score", dropna=False)
pivot = pivot.reindex(columns=range(24))
hours_lbl = [pd.Timestamp(2000, 1, 1, h).strftime("%-I%p").lower() for h in range(24)]
day_lbl = [f"{pd.Timestamp(d):%a %m/%d} {daily.loc[d, 'moon'].split()[0] if d in daily.index else ''}" for d in pivot.index]
if legal_only:  # trim to columns that have any legal hour
    keep = [h for h in range(24) if pivot[h].notna().any()]
    pivot = pivot[keep]
    hours_lbl = [hours_lbl[h] for h in keep]

fig = go.Figure(
    go.Heatmap(
        z=pivot.values,
        x=hours_lbl,
        y=day_lbl,
        zmin=0,
        zmax=10,
        colorscale=ui.SCORE_COLORSCALE,
        textfont=dict(color="#ffffff"),
        texttemplate="%{z:.0f}",
        hovertemplate="%{y} %{x}<br>Score %{z:.1f}<extra></extra>",
        colorbar=dict(title="Score", thickness=10),
        xgap=1,
        ygap=1,
    )
)
ui.lock_figure(fig, height=60 + 30 * len(pivot))
fig.update_layout(yaxis=dict(autorange="reversed", fixedrange=True), xaxis=dict(side="top", fixedrange=True))
st.plotly_chart(fig, width="stretch", config=ui.PLOTLY_CONFIG)
st.caption("Confidence: days 1–3 high · 4–7 medium · 8–14 low (long-range weather is less reliable).")

# ---------------------------------------------------------------- day detail
st.subheader("Day detail")
days = list(daily.index)
sel = st.selectbox("Day", days, format_func=lambda d: f"{pd.Timestamp(d):%A %b %d} — best {daily.loc[d, 'best_score']:.1f}")
dd = scored[scored["date"] == sel]
r = daily.loc[sel]
c1, c2, c3, c4 = st.columns(4)
c1.metric("Best hour", f"{r.best_hour:%-I %p}", f"{r.best_score:.1f}", delta_color="off")
c2.metric("High / Low", f"{r.hi:.0f}° / {r.lo:.0f}°")
c3.metric("Moon", r.moon)
c4.metric("Sunrise / Sunset", f"{dd['sunrise'].iloc[0]:%-I:%M} / {dd['sunset'].iloc[0]:%-I:%M}")

show_wx = st.toggle("Show hourly weather", value=True, key="show_day_wx")
st.plotly_chart(daychart.day_figure(dd, show_wx), width="stretch", config=ui.PLOTLY_CONFIG)
st.caption("Score bars: red = poor → green = best; grey = outside legal shooting hours. "
           + ("Wind arrows point the way the wind is blowing (speed in mph). Tap any hour for all its values."
              if show_wx else "Tap a bar for that hour's weather."))

with st.expander("Why this score? (factor breakdown)"):
    t = dd[
        ["score", "temp_f", "dtemp_24h", "pressure_inhg", "p_tend_3h", "wind_mph", "wind_dir", "precip_in",
         "cloud_pct", "f_diel", "f_season", "f_temp", "f_pressure", "f_wind", "f_precip", "f_cloud", "f_solunar"]
    ].copy()
    t["wind_dir"] = t["wind_dir"].map(lambda d: deg_to_cardinal(d))
    t.index = [i.strftime("%-I %p") for i in t.index]
    st.dataframe(
        t.style.format(precision=2).format({"score": "{:.1f}", "temp_f": "{:.0f}", "dtemp_24h": "{:+.0f}",
                                             "wind_mph": "{:.0f}", "cloud_pct": "{:.0f}"}),
        width="stretch",
    )
    st.markdown(
        "Factors multiply together; ~1.00 is neutral. **diel** = time of day (sunrise/sunset peaks, moon-adjusted), "
        "**season** = days from peak rut, **temp** = heat penalty and 24h temperature change, **pressure** = level and "
        "3-hour trend, **solunar** = moon overhead/underfoot and moonrise/set. See `docs/MODEL.md` in the repo."
    )
