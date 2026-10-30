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
- Hunt Log page: live sit (start/stop, quick +Buck/+Doe/+Fawn/+Unknown, activity, bait site) + past-hunt entry (deer seen together = one entry with per-type counts, `group` id; optional direction/distance from stand, came from, went toward → `lat`/`lon`; form clears after save; sightings drawn on the Map; logged hunts editable inline incl. start/end, re-scored on save); each hour saved with forecast score → validation (deer/hour by score band, Spearman ρ).
- Map: bait/food marks — broadcast corn feeder, shelled corn pile, ear corn pile, other food — with last-filled date + 'Filled today'.
- Bow Setup page (`app_pages/gear.py`, `deercast/archery.py`, `gear.json`): setups with IBO/rated speed, draw weight/length, arrow weight, tip → est. fps, KE, momentum, bone-penetration rating; active setup feeds the Shot page.
- **Multi-user (v0.7):** Google sign-in (`st.login`, `[auth]` secrets; Authlib). Allow-list = `users.json` (admin adds on Grounds page); `ADMIN_EMAIL(S)` secret always admin. Falls back to APP_PASSWORD (single owner; URL token `k`) until `[auth]` exists.
- **Hunting grounds:** a property with its own home location (forecast/map/regs open there), shared with members. Ground picker popover at top of every page; 🏞️ Grounds page (switch, create, rename, home from ZIP/current location, members, delete; admin: App users). Development page admin-only. First ground "Lewis/Klein Property" migrated from single-user data (owner John; Matt Klein to be added).
- Peak rut date by state/region (`deercast/rut.py`, agency sources); sidebar override + reset (`ui.rut_for`).
- Thermals bend scent cones (terrain slope + sun phase, `deercast/terrain.py`); optional drift-field grid of arrows on the Map.
- Best stand: Forecast page ranks stands for morning/evening of a chosen day (`deercast/beststand.py`): top forecast hours × scent fit (wind+thermals vs good winds) × logged-sightings history.
- Home-screen: Deercast icon/name, full-screen (`static/`, `ui.add_home_screen_tags`; `server.enableStaticServing`). Icon generator `tools/make_icon.py`.
- Shot & Recovery page: rotate deer (angle + side), tap crosshair on entry spot, shot angle from stand height/distance → organs hit, survival time, wait time, travel distance, probability search map, weather alerts, tracking tips, save to log.

## Architecture
- `deercast/scoring.py` — the model; tunable constants in `MODEL`, `SEASON_KNOTS`, `HOT_THRESHOLD_F`. Documented in `docs/MODEL.md` — keep that doc in sync.
- `deercast/weather.py` — Open-Meteo (no key). `astro.py` — PyEphem. `geo.py` — zippopotam.us ZIP lookup.
- `deercast/scent.py` — downwind cone geometry. `storage.py` — JSON files in private repo `jjpvoskuil/deercast-data` via GitHub Contents API (Supabase/local fallbacks). **Layout (v0.7, `deercast/accounts.py`):** `data/users.json`, `data/grounds.json`, `data/punchlist.json` (app-wide); `data/grounds/<gid>/stands.json|features.json` (shared per ground); `data/users/<sha256(email)[:12]>/hunts.json|active_hunt.json|gear.json|shots.json` (personal; hunts/shots carry `ground_id`). Old top-level `data/stands.json` etc. = pre-v0.7 backup. `ui.load/save(name)` resolve the path automatically; `ui.ground_hunts()` gathers all members' hunts on the current ground (shared sightings map, Best stand history); shared data re-read every 90 s.
- `app_pages/` — forecast, map (folium + streamlit-folium, Esri satellite, compass), regs, dev punch list.
- `deercast/shot.py` (anatomy ellipsoids, ray-cast, outcomes), `shot_render.py` (matplotlib views; fixed frame so taps map linearly), `recovery.py` (polar search grid, log-normal distance × run direction × downhill bias × water/cover proximity; Open-Meteo elevation, OSM Overpass water/woods, hunter marks). Documented in `docs/SHOT_MODEL.md` — keep in sync. `app_pages/track.py` uses `streamlit-image-coordinates` for taps.
- `deercast/clock.py` — client-side JS hunt clock (time on stand + legal light/sunrise or sunset/legal-end countdowns), embedded via `ui.html_frame` (st.iframe). `ui.SCORE_COLORSCALE` (red=poor → green=best), `ui.lock_figure` + `ui.PLOTLY_CONFIG` for all charts (no zoom). `scoring.rut_peak_for(date, lat)` picks the rut for that date's season.
- `deercast/daychart.py` — Day-detail figure: score bars + hourly weather rows (temp, wind arrows, rain/cloud, pressure). To eyeball charts in the sandbox: `npm i @sparticuz/chromium` then `BROWSER_PATH=/tmp/chromium` + `fig.write_image` (kaleido ≥1).
- `deercast/huntlog.py` — session_hours (per-hour score/minutes/seen) + validation stats; `app_pages/log.py`. `scoring.score_forecast(start=...)` scores past days; `weather.fetch_hourly_range` (forecast API → archive fallback).
- `deercast/regs/` — county lookup via FCC Census Block API; curated state data (`kentucky.py`: 2026-27 seasons, zones for all 120 counties, CWD counties, sources). **Update every season** and bump `SEASON`/`VERIFIED`. Other states show agency + search link.
- Tests: `pytest -q tests` (synthetic weather; AppTest renders all pages without network; `conftest.py` gives each test an empty temp data dir). Run before every push.

## Web test (v0.8, started 2026-10-30)
- `web/` = React (Vite) rebuild of the **Map** screen on Supabase Auth (Google) + RLS + Netlify — a pilot for moving
  Deercast (and later John's FP1.0 app) off Streamlit. See `web/README.md`. Supabase project `deercast`
  (`https://gzxobsvhzscouehlrxeg.supabase.co`, East US Ohio). Schema/RLS: `web/supabase/schema.sql`.
- JS geometry (`web/src/lib/geo.js`, `terrain.js`) must match the Python: change both, regenerate fixtures
  (`python web/supabase/make_fixtures.py`), run `cd web && npm test`.
- `make_import.py` output contains stand coordinates — send it to John as a file, **never commit it**.
- John has no coding background: setup instructions go one screen at a time.

## Conventions
- Cached weather is keyed on `weather.SCHEMA` — **bump it whenever fetched columns/meaning change**, or Streamlit keeps serving old cached data (cache keys only see the cached function's own source).
- Every new data file must be classified in `accounts.GROUND_SCOPED` / `USER_SCOPED` (or stays app-wide).
- Never let `st.cache_data` cache a failed network lookup: raise inside the cached function and catch outside (see `ui.cached_elevations`, `ui.state_for`).
- Don't assign `st.session_state[widget_key]` after that widget is drawn — set a pending key and apply it before the widget on the next run (see gear.py `_gear_next`).
- Use `width="stretch"` not `use_container_width` (removed in newer Streamlit; st_folium still takes its own `use_container_width`).
- Units: °F, mph, inches, inHg. Times in the location's local timezone.
- Never commit secrets or stand coordinates to this (public) repo. Stand + punch list data live in the private `deercast-data` repo (PAT in Streamlit secrets only).
- Bump `deercast/__init__.py` `__version__` on meaningful releases.
- **End of every session:** append a dated entry to `docs/SESSION_LOG.md` (what changed, decisions, open items) and push.
- The sandbox may block outbound calls to Open-Meteo; test with `tests/synthetic.py`.
- Live punch list: `data/punchlist.json` in `jjpvoskuil/deercast-data` — attach read-only if Claude's GitHub app has access; otherwise John pastes the Development page export. Never write to the data repo from a session unless John asks.
- Session startup is automated via the claude.ai Project doc `claude/deercast-session-start.md` (+ a one-line Project instruction). `NEW_SESSION_PROMPT.txt` is the manual fallback; keep both in sync.
