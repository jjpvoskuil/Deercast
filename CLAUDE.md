# Deercast — context for Claude

Owner: John (jjpvoskuil). Retiree, deer hunter in central Kentucky (Cub Run / Nolin Lake area).
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

## Architecture
- `deercast/scoring.py` — the model; tunable constants in `MODEL`, `SEASON_KNOTS`, `HOT_THRESHOLD_F`. Documented in `docs/MODEL.md` — keep that doc in sync.
- `deercast/weather.py` — Open-Meteo (no key). `astro.py` — PyEphem. `geo.py` — zippopotam.us ZIP lookup.
- `deercast/scent.py` — downwind cone geometry. `storage.py` — JSON store: GitHub Contents API (private data repo) or local fallback.
- `app_pages/` — forecast, map (folium + streamlit-folium, Esri satellite), dev punch list.
- Tests: `pytest -q tests` (synthetic weather; AppTest renders all pages without network). Run before every push.

## Conventions
- Units: °F, mph, inches, inHg. Times in the location's local timezone.
- Never commit secrets or stand coordinates to this (public) repo. Stand + punch list data live in the private `deercast-data` repo.
- Bump `deercast/__init__.py` `__version__` on meaningful releases.
- **End of every session:** append a dated entry to `docs/SESSION_LOG.md` (what changed, decisions, open items) and push.
- The sandbox may block outbound calls to Open-Meteo; test with `tests/synthetic.py`.
- To read the live punch list, read `data/punchlist.json` in `jjpvoskuil/deercast-data` (if attached to the session).
