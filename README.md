# 🦌 Deercast

Whitetail deer activity forecasting for hunters — an iPhone-friendly Streamlit web app.

- **Forecast** — hourly activity score (0–10) for the next 14 days for any ZIP code, map pin, or saved stand. Built from weather (temperature & 24 h change, pressure & trend, wind, rain, cloud), daily moon phase + solunar times, and season/rut timing. Factor breakdown shown for every hour.
- **Map & Wind** — satellite/topo map, saved stand pins (with "good wind" directions), live or forecast wind, and scent-drift cones from every stand or any point you tap.
- **Shot & Recovery** — rotate a deer to how it stood, tap where you hit it, set the shot angle: estimates organs hit, survival time, how long to wait, likely distance, a search-probability map from the hit site (run direction + terrain), weather alerts and tracking tips. Details: [`docs/SHOT_MODEL.md`](docs/SHOT_MODEL.md).
- **Regulations** — deer regs for the chosen location: county & zone detection, season dates with open/closed status, today's legal shooting hours, bag limits, CWD rules (Kentucky built in; other states link to the official agency).
- **Development** — punch list for tracking features, bugs and model changes.

Model details: [`docs/MODEL.md`](docs/MODEL.md). Session history: [`docs/SESSION_LOG.md`](docs/SESSION_LOG.md).

## Use on iPhone
Open the Streamlit app URL in Safari → Share → **Add to Home Screen**.

## Deploy (Streamlit Community Cloud)
1. share.streamlit.io → **Create app** → repo `jjpvoskuil/Deercast`, branch `main`, main file `streamlit_app.py`.
2. App settings → **Secrets** → paste from `.streamlit/secrets.toml.example` with real values.

## Persistent storage (stands + punch list) — private GitHub repo
Streamlit Cloud's disk is wiped on restart, so the app saves JSON files (`data/stands.json`,
`data/punchlist.json`) to the **private** repo `jjpvoskuil/deercast-data` using a fine-grained PAT
(Contents: read/write on that repo only) stored in the app's Secrets under `[storage]`.
This public app repo never holds stand coordinates. Data commits go to a different repo, so they
don't trigger app redeploys.

Without secrets, the app uses temporary local files (fine for testing). A Supabase backend is also
supported (`[supabase]` secrets + `docs/supabase_setup.sql`) if ever needed.

## Local development (optional)
```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
pytest -q tests
```

## Layout
```
streamlit_app.py      entry point, navigation, password gate
app_pages/            forecast.py, map.py, dev.py
deercast/             scoring.py (model), weather.py, astro.py, geo.py, scent.py, storage.py, ui.py
tests/                synthetic weather + unit/render tests (no network)
docs/                 MODEL.md, SESSION_LOG.md
CLAUDE.md             context for Claude sessions
```
