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
- Tests: scoring sanity + headless render of all pages + storage (7 passing).
- v0.1.1: Supabase storage backend (`docs/supabase_setup.sql`) and a punch-list export on the Development page for Claude session handoff.

**Decisions**
- Weather provider: Open-Meteo (free, no key, 16-day hourly).
- Map: Folium + Esri satellite instead of Google Maps (Google needs a paid API key + custom component). Google basemap is a punch-list item.
- App repo is **public**, so stands/punch list must not live in it. ~~Private data repo~~ → switched to **Supabase** (John already has an account): one table `deercast_kv`, RLS on, secret key in Streamlit secrets.
- Primary device is iPhone (Safari, Add to Home Screen); Mac is for development review only.
- Claude pushes directly to `main` using the Claude GitHub connection (no PAT needed for Claude).

**Open / next**
- John: run `docs/supabase_setup.sql`, deploy on Streamlit Cloud, set `[supabase]` + `APP_PASSWORD` secrets, test on iPhone.
- Supabase free tier pauses after ~7 days idle; consider a keep-alive or just resume after off-season.
- Default rut peak is latitude-based (KY ≈ Nov 14) — replace with state-agency table.
- Model weights are literature/hunter-knowledge priors, not yet calibrated — hunt log feature planned.
- Live weather wasn't reachable from Claude's sandbox; first real-data check happens on Streamlit.
