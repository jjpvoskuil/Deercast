# Deercast session log

Newest first. Each session: what changed, decisions made, and what's open.

---

## 2026-10-27 — Session 1: v0.1 scaffold

**Built**
- Full app scaffold: Forecast, Map & Wind, Development pages; password gate (`APP_PASSWORD` secret).
- Activity model v0.1 (`deercast/scoring.py`, documented in `docs/MODEL.md`): diel curve, rut/season curve vs. peak breeding date, temperature (heat + 24 h change), pressure (level + 3 h trend), wind, precip (incl. post-rain clearing), cloud, daily moon phase, solunar. Hourly factor breakdown shown in-app.
- Weather: Open-Meteo, 15 days (today + 14) plus previous 24 h for trends. ZIP lookup via zippopotam.us.
- Map: Esri satellite / OpenTopoMap / OSM, stand pins with good-wind directions (green/red by current wind), live or 48 h forecast wind, scent cones from all stands and a tap-to-test pin, "Forecast this pin", GPS locate button.
- Punch list with seed backlog; storage via GitHub Contents API to a private data repo, local fallback.
- Tests: scoring sanity + headless render of all pages + storage (12 passing).
- v0.1.2: storage = private GitHub repo `deercast-data` (Supabase backend retained as option); punch-list export on the Development page for session handoff.
- v0.1.3: compass rose on the map (top-right, north-up) with an orange wind arrow pointing downwind (scent travel) + wind caption (`deercast/compass.py`).
- v0.2.0: Map always opens on Satellite (folium was showing the last-added base layer, Streets); satellite overzooms past z19 instead of blanking. New **Regulations** page: FCC county lookup → KY 2026-27 zone, seasons (open/closed, days to open), today's legal hours, zone + statewide bag limits, CWD rules for the 23 surveillance counties, official links. Replaced deprecated `use_container_width`; pinned streamlit <2.

**Decisions**
- Weather provider: Open-Meteo (free, no key, 16-day hourly).
- Map: Folium + Esri satellite instead of Google Maps (Google needs a paid API key + custom component). Google basemap is a punch-list item.
- App repo is **public**, so stands/punch list must not live in it. Briefly switched to Supabase, then John chose the **private GitHub repo `jjpvoskuil/deercast-data`** (already created, PAT set). GitHub is the primary backend; Supabase code kept as an option.
- Primary device is iPhone (Safari, Add to Home Screen); Mac is for development review only.
- Claude pushes directly to `main` using the Claude GitHub connection (no PAT needed for Claude).

**Open / next**
- John: deploy on Streamlit Cloud, set `[storage]` + `APP_PASSWORD` secrets, test on iPhone.
- Done: Claude's GitHub app has read access to `deercast-data` (verified — private, `main` exists); new sessions can read `data/punchlist.json` directly.
- KY regs data (`deercast/regs/kentucky.py`) is for 2026-27 — must be refreshed each summer when KDFWR publishes the new guide. Zone list = 301 KAR 2:172 (2024) + 2026-27 reassignments from the KDFWR 2025-26 Deer Report; verify against the official zone map.
- Add other states' regulation data as needed (currently link-out only).
- Default rut peak is latitude-based (KY ≈ Nov 14) — replace with state-agency table.
- Model weights are literature/hunter-knowledge priors, not yet calibrated — hunt log feature planned.
- Live weather wasn't reachable from Claude's sandbox; first real-data check happens on Streamlit.
