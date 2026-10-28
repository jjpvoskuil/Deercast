"""Day-detail chart: activity score bars with an aligned hourly weather strip underneath."""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
from plotly.subplots import make_subplots

from . import ui
from .weather import deg_to_cardinal

TEXT = "#e8e6df"
MUTED = "rgba(232,230,223,0.55)"
GRID = "rgba(232,230,223,0.08)"


def _sparse(values, every: int = 3, fmt="{:.0f}"):
    """Label every Nth hour so the phone view stays readable (hover/tap shows every value)."""
    return [fmt.format(v) if i % every == 0 and pd.notna(v) else "" for i, v in enumerate(values)]


def _trend_arrow(t):
    if pd.isna(t):
        return ""
    return "↑" if t >= 0.02 else ("↓" if t <= -0.02 else "→")


def day_figure(dd: pd.DataFrame, show_weather: bool = True) -> go.Figure:
    x = [t.strftime("%-I%p").lower() for t in dd.index]
    colors = [ui.score_color(v) if leg else "rgba(140,150,140,0.35)" for v, leg in zip(dd["score"], dd["legal"])]
    wind_txt = [f"{deg_to_cardinal(d)} {s:.0f} mph" for d, s in zip(dd["wind_dir"], dd["wind_mph"])]
    rain = dd["precip_prob"].fillna(0).clip(0, 100)
    sky = (dd["sky_pct"] if "sky_pct" in dd else dd["cloud_pct"]).fillna(0)
    high = dd["cloud_high_pct"] if "cloud_high_pct" in dd else pd.Series(float("nan"), index=dd.index)
    summary = [
        f"<b>{h}</b> · score <b>{sc:.1f}</b><br>{tf:.0f}°F · wind {w}<br>rain {rp:.0f}% · overcast {cc:.0f}%"
        + (f" (+high {hc:.0f}%)" if pd.notna(hc) and hc >= 10 else "") + "<br>"
        f"{p:.2f} inHg {_trend_arrow(tr)}"
        for h, sc, tf, w, rp, cc, hc, p, tr in zip(x, dd["score"], dd["temp_f"], wind_txt, rain, sky, high,
                                                 dd["pressure_inhg"], dd["p_tend_3h"])
    ]

    if not show_weather:
        fig = go.Figure(go.Bar(x=x, y=dd["score"], marker_color=colors, customdata=summary,
                               hovertemplate="%{customdata}<extra></extra>"))
        ui.lock_figure(fig, height=260)
        fig.update_layout(yaxis=dict(range=[0, 10], fixedrange=True))
        return fig

    rows = ["Score", "Temp °F", "Wind", "Rain % · overcast %", "Pressure"]
    fig = make_subplots(rows=5, cols=1, shared_xaxes=True, vertical_spacing=0.06,
                        row_heights=[0.34, 0.16, 0.11, 0.17, 0.22])

    # 1) activity score
    fig.add_trace(go.Bar(x=x, y=dd["score"], marker_color=colors, customdata=summary,
                         hovertemplate="%{customdata}<extra></extra>", showlegend=False), 1, 1)

    # 2) temperature
    fig.add_trace(go.Scatter(x=x, y=dd["temp_f"], mode="lines+text", line=dict(color="#ff9f43", width=2.5,
                             shape="spline"), text=_sparse(dd["temp_f"], fmt="{:.0f}°"), textposition="top center",
                             textfont=dict(size=10, color="#ffc48a"), cliponaxis=False,
                             hovertemplate="%{x}: %{y:.0f}°F<extra></extra>", showlegend=False), 2, 1)

    # 3) wind: arrows point where the wind blows TO; speed labels every 3 h
    fig.add_trace(go.Scatter(x=x, y=[0.55] * len(x), mode="markers+text",
                             marker=dict(symbol="arrow", size=[max(8, min(16, 7 + 0.8 * s)) for s in dd["wind_mph"]],
                                         angle=[(d + 180) % 360 for d in dd["wind_dir"]], color="#dfe6e9",
                                         line=dict(width=0)),
                             text=_sparse(dd["wind_mph"]), textposition="bottom center",
                             textfont=dict(size=10, color=MUTED), customdata=wind_txt,
                             hovertemplate="%{x}: %{customdata}<extra></extra>", showlegend=False), 3, 1)

    # 4) overcast (low+mid cloud) band, faint high-cloud band above it, rain-chance bars on top
    if high.notna().any():
        hi_top = (sky + high.fillna(0) * (1 - sky / 100)).clip(0, 100)  # combined, so high cloud only adds on top
        fig.add_trace(go.Scatter(x=x, y=hi_top, mode="lines", line=dict(color="rgba(180,190,200,0.0)", width=0),
                                 fill="tozeroy", fillcolor="rgba(180,190,200,0.07)",
                                 customdata=high.fillna(0),
                                 hovertemplate="%{x}: high/thin cloud %{customdata:.0f}%<extra></extra>",
                                 showlegend=False), 4, 1)
    fig.add_trace(go.Scatter(x=x, y=sky, mode="lines", line=dict(color="rgba(180,190,200,0.6)", width=1),
                             fill="tozeroy", fillcolor="rgba(180,190,200,0.26)",
                             hovertemplate="%{x}: overcast (low/mid cloud) %{y:.0f}%<extra></extra>",
                             showlegend=False), 4, 1)
    fig.add_trace(go.Bar(x=x, y=rain, marker_color="rgba(77,166,255,0.85)", width=0.5,
                         text=[f"{v:.0f}" if v >= 20 else "" for v in rain], textposition="outside",
                         textfont=dict(size=9, color="#9cc9ff"), cliponaxis=False,
                         hovertemplate="%{x}: rain %{y:.0f}%<extra></extra>", showlegend=False), 4, 1)

    # 5) pressure
    fig.add_trace(go.Scatter(x=x, y=dd["pressure_inhg"], mode="lines+text",
                             line=dict(color="#b388ff", width=2.5, shape="spline"),
                             text=_sparse(dd["pressure_inhg"], fmt="{:.2f}"), textposition="top center",
                             textfont=dict(size=9, color="#d4bfff"), cliponaxis=False,
                             customdata=[_trend_arrow(t) for t in dd["p_tend_3h"]],
                             hovertemplate="%{x}: %{y:.2f} inHg %{customdata}<extra></extra>", showlegend=False), 5, 1)

    ui.lock_figure(fig, height=600)
    fig.update_layout(bargap=0.15, hoverlabel=dict(bgcolor="#1f2725", font=dict(color=TEXT)),
                      margin=dict(l=36, r=4, t=18, b=28))
    fig.update_xaxes(showgrid=False, tickfont=dict(size=10, color=MUTED), fixedrange=True, tickangle=0,
                     nticks=8)
    fig.update_xaxes(showticklabels=True, row=5, col=1)
    fig.update_yaxes(gridcolor=GRID, zeroline=False, tickfont=dict(size=9, color=MUTED), fixedrange=True,
                     showticklabels=False)
    fig.update_yaxes(range=[0, 10], tickvals=[0, 5, 10], showticklabels=True, row=1, col=1)
    t_lo, t_hi = dd["temp_f"].min(), dd["temp_f"].max()
    fig.update_yaxes(range=[t_lo - 3, t_hi + 6], row=2, col=1)
    fig.update_yaxes(range=[0, 1], showticklabels=False, showgrid=False, row=3, col=1)
    fig.update_yaxes(range=[0, 118], tickvals=[0, 50, 100], ticktext=["0%", "50%", "100%"], showticklabels=True,
                     row=4, col=1)
    p_lo, p_hi = dd["pressure_inhg"].min(), dd["pressure_inhg"].max()
    pad = max(0.04, (p_hi - p_lo) * 0.3)
    fig.update_yaxes(range=[p_lo - pad, p_hi + pad * 1.6], tickformat=".2f", nticks=3, row=5, col=1)
    for i, name in enumerate(rows, 1):  # small row titles on the left, inside the plot
        fig.add_annotation(text=name, xref="paper", yref=f"y{'' if i == 1 else i} domain", x=0, y=1.0,
                           xanchor="left", yanchor="bottom", showarrow=False, font=dict(size=10, color=MUTED))
    return fig
