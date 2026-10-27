"""14-day hourly deer activity forecast."""

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

from deercast import scoring, ui
from deercast.weather import deg_to_cardinal

st.title("🦌 Deer Activity Forecast")

loc = ui.location_picker()
with st.sidebar:
    st.divider()
    rut_peak = ui.rut_peak_setting(loc.lat)
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
        colorscale=[[0, "#1d2b1f"], [0.3, "#3f5f3a"], [0.55, "#b9a43a"], [0.75, "#e07b24"], [1, "#d7261e"]],
        texttemplate="%{z:.0f}",
        hovertemplate="%{y} %{x}<br>Score %{z:.1f}<extra></extra>",
        colorbar=dict(title="Score", thickness=10),
        xgap=1,
        ygap=1,
    )
)
fig.update_layout(
    height=60 + 30 * len(pivot),
    margin=dict(l=0, r=0, t=10, b=0),
    yaxis=dict(autorange="reversed"),
    xaxis=dict(side="top"),
)
st.plotly_chart(fig, width="stretch", config={"displayModeBar": False})
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

bar = go.Figure(
    go.Bar(
        x=[t.strftime("%-I%p").lower() for t in dd.index],
        y=dd["score"],
        marker_color=["#e07b24" if l else "#5b6b5c" for l in dd["legal"]],
        hovertemplate="%{x}: %{y:.1f}<extra></extra>",
    )
)
bar.update_layout(height=260, margin=dict(l=0, r=0, t=10, b=0), yaxis=dict(range=[0, 10]))
st.plotly_chart(bar, width="stretch", config={"displayModeBar": False})
st.caption("Orange = legal shooting hours (30 min before sunrise to 30 min after sunset — check your state's rules).")

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
