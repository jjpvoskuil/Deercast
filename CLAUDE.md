# Deercast — context for Claude

Owner: John (jjpvoskuil). Retiree, deer hunter in central Kentucky (Cub Run / Nolin Lake area). His stand is in **Hart County** (Zone 1) — Hart is the default county/location everywhere (`ui.DEFAULT_LOCATION`, `ui.DEFAULT_COUNTY`).
Wants direct, accurate answers; Claude writes all code and commits/pushes directly to `main`.

## What it is
Whitetail deer activity forecast app. Python + Streamlit, hosted on Streamlit Community Cloud,
**used on John's iPhone** (Safari, added to home screen). John develops/reviews from a Mac but
doesn't need to run anything locally. Design for phone screens first.

## Requirements (from John)
- Hourly activity score 0–10 (10 best), 14 days out, from known correlations with forecastable variables:
  at minimum weather, daily lunar phase, time of year (by day).
- Forecast any location by ZIP and/or map pin.
- Map with pins for actual stands; real-time wind direction/speed overlay showing scent drift from any stand or point.
- Development page with a punch list to track iterations.
- Regulations page: current deer regs for the chosen ZIP/pin (county → zone, seasons, bag limits, CWD rules).
- Map defaults to satellite view.
- Shot & Recovery page: rotate deer (angle + side), tap crosshair on entry spot, shot angle from stand height/distance → organs hit, survival time, wait time, travel distance, probability search map, weather alerts, tracking tips, save to log.

## Architecture
- `deercast/scoring.py` — the model; tunable constants in `MODEL`, `SEASON_KNOTS`, `HOT_THRESHOLD_F`. Documented in `docs/MODEL.md` — keep that doc in sync.
- `deercast/weather.py` — Open-Meteo (no key). `astro.py` — PyEphem. `geo.py` — zippopotam.us ZIP lookup.
- `deercast/scent.py` — downwind cone geometry. `storage.py` — JSON files in private repo `jjpvoskuil/deercast-data` (`data/stands.json`, `data/punchlist.json`, `data/shots.json`, `data/features.json` = hunter-marked water/cover/bedding) via GitHub Contents API; Supabase and local fallbacks.
- `app_pages/` — forecast, map (folium + streamlit-folium, Esri satellite, compass), regs, dev punch list.
- `deercast/shot.py` (anatomy ellipsoids, ray-cast, outcomes), `shot_render.py` (matplotlib views; fixed frame so taps map linearly), `recovery.py` (polar search grid, log-normal distance × run direction × downhill bias × water/cover proximity; Open-Meteo elevation, OSM Overpass water/woods, hunter marks). Documented in `docs/SHOT_MODEL.md` — keep in sync. `app_pages/track.py` uses `streamlit-image-coordinates` for taps.
- `deercast/regs/` — county lookup via FCC Census Block API; curated state data (`kentucky.py`: 2026-27 seasons, zones for all 120 counties, CWD counties, sources). **Update every season** and bump `SEASON`/`VERIFIED`. Other states show agency + search link.
- Tests: `pytest -q tests` (synthetic weather; AppTest renders all pages without network). Run before every push.

## Conventions
- Use `width="stretch"` not `use_container_width` (removed in newer Streamlit; st_folium still takes its own `use_container_width`).
- Units: °F, mph, inches, inHg. Times in the location's local timezone.
- Never commit secrets or stand coordinates to this (public) repo. Stand + punch list data live in the private `deercast-data` repo (PAT in Streamlit secrets only).
- Bump `deercast/__init__.py` `__version__` on meaningful releases.
- **End of every session:** append a dated entry to `docs/SESSION_LOG.md` (what changed, decisions, open items) and push.
- The sandbox may block outbound calls to Open-Meteo; test with `tests/synthetic.py`.
- Live punch list: `data/punchlist.json` in `jjpvoskuil/deercast-data` — attach read-only if Claude's GitHub app has access; otherwise John pastes the Development page export. Never write to the data repo from a session unless John asks.
- Session startup is automated via the claude.ai Project doc `claude/deercast-session-start.md` (+ a one-line Project instruction). `NEW_SESSION_PROMPT.txt` is the manual fallback; keep both in sync.
