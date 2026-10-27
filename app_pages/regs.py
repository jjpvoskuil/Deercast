"""Deer hunting regulations for the selected location (ZIP / pin / stand)."""

from datetime import date
from urllib.parse import quote_plus

import pandas as pd
import streamlit as st

from deercast import regs, ui

st.title("📜 Deer Regulations")

loc = ui.location_picker()


@st.cache_data(ttl=86400, show_spinner=False)
def lookup_county(lat: float, lon: float):
    return regs.county_for_point(round(lat, 4), round(lon, 4))


try:
    place = lookup_county(loc.lat, loc.lon)
except Exception:
    place = {"county": None, "state": loc.state, "fips": None}
state = place.get("state") or loc.state

st.caption(f"📍 **{loc.label}** · change location in the sidebar (›) or on the Map page")

mod = regs.CURATED.get(state)
if mod is None:
    name, agency = regs.STATE_AGENCIES.get(state, (state or "this state", "your state wildlife agency"))
    st.info(
        f"Detailed regulations are built in for Kentucky so far. For **{name}**, use the official source: "
        f"**{agency}**."
    )
    q = quote_plus(f"{name} deer hunting regulations {date.today().year} {agency}")
    st.link_button(f"Find official {name} deer regulations", f"https://www.google.com/search?q={q}")
    st.caption("Want this state built in? Add it to the punch list on the Development page.")
    st.stop()

# ---------------------------------------------------------------- county / zone
counties = sorted(mod.ZONES)
detected = mod.normalize_county(place.get("county"))
if detected not in counties:  # lookup failed or point outside the state's list → home county
    detected = ui.DEFAULT_COUNTY if ui.DEFAULT_COUNTY in counties else counties[0]
idx = counties.index(detected)
county = st.selectbox(
    "County",
    counties,
    index=idx,
    help="Detected from your location. ZIP codes can cross county lines — change it if needed.",
)
zone = mod.zone_for(county)
in_cwd = county in mod.CWD_COUNTIES

c1, c2, c3 = st.columns(3)
c1.metric("County", county)
c2.metric("Deer zone", f"Zone {zone}")
c3.metric("CWD zone", "Yes" if in_cwd else "No")
st.caption(f"{mod.STATE} {mod.SEASON} season · data verified {mod.VERIFIED:%b %d, %Y} · always confirm in the official guide.")

# ---------------------------------------------------------------- seasons
st.subheader("Season dates")
today = pd.Timestamp.now(tz="America/Chicago").date()
rows = []
for name, start, end, note in mod.SEASONS:
    if name.startswith("CWD") and not in_cwd:
        continue
    if today < start:
        status = f"Opens in {(start - today).days} days"
    elif today <= end:
        status = "🟢 OPEN"
    else:
        status = "Closed"
    rows.append({"Season": name, "Dates": f"{start:%b %-d} – {end:%b %-d, %Y}", "Status": status, "Notes": note})
st.dataframe(pd.DataFrame(rows), hide_index=True, width="stretch")

open_now = [r["Season"] for r in rows if r["Status"] == "🟢 OPEN"]
if open_now:
    st.success("Open today: " + ", ".join(open_now))

# ---------------------------------------------------------------- legal hours today
try:
    from deercast import astro

    tz = ui.cached_hourly(loc.lat, loc.lon)[1]
    a = astro.daily_astro(loc.lat, loc.lon, [pd.Timestamp.now(tz=tz).date()], tz)
    sr, ss = a["sunrise"].iloc[0], a["sunset"].iloc[0]
    st.info(
        f"**Legal shooting hours today:** {(sr - pd.Timedelta(minutes=30)):%-I:%M %p} – "
        f"{(ss + pd.Timedelta(minutes=30)):%-I:%M %p} (sunrise {sr:%-I:%M}, sunset {ss:%-I:%M})"
    )
except Exception:
    pass

# ---------------------------------------------------------------- bag limits
st.subheader(f"Bag limits — Zone {zone}")
st.markdown(f"**Zone {zone}:** {mod.ZONE_BAG[zone]}")
for label, text in mod.STATEWIDE:
    st.markdown(f"**{label}:** {text}")

if in_cwd:
    st.subheader("⚠️ CWD Surveillance Zone rules")
    for r in mod.CWD_RULES:
        st.markdown(f"- {r}")

st.subheader("Official sources")
for label, url in mod.LINKS.items():
    st.markdown(f"- [{label}]({url})")
st.caption(
    "Summary for convenience only — not legal advice. Regulations change and WMAs/public lands often have "
    "different rules. The official KDFWR guide is the final word."
)
