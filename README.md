# 🦌 Deercast

Whitetail deer activity forecasting for hunters — an iPhone-friendly Streamlit web app.

- **Forecast** — hourly activity score (0–10) for the next 14 days for any ZIP code, map pin, or saved stand. Built from weather (temperature & 24 h change, pressure & trend, wind, rain, cloud), daily moon phase + solunar times, and season/rut timing. Factor breakdown shown for every hour.
- **Map & Wind** — satellite/topo map, saved stand pins (with "good wind" directions), live or forecast wind, and scent-drift cones from every stand or any point you tap.
- **Development** — punch list for tracking features, bugs and model changes.

Model details: [`docs/MODEL.md`](docs/MODEL.md). Session history: [`docs/SESSION_LOG.md`](docs/SESSION_LOG.md).

## Use on iPhone
Open the Streamlit app URL in Safari → Share → **Add to Home Screen**.

## Deploy (Streamlit Community Cloud)
1. share.streamlit.io → **Create app** → repo `jjpvoskuil/Deercast`, branch `main`, main file `streamlit_app.py`.
2. App settings → **Secrets** → paste from `.streamlit/secrets.toml.example` with real values.

## Persistent storage (stands + punch list) — Supabase
Streamlit Cloud's disk is wiped on restart, so data lives in Supabase.
1. Supabase → your project → **SQL Editor** → run [`docs/supabase_setup.sql`](docs/supabase_setup.sql) (creates one locked-down table, `deercast_kv`).
2. Project Settings → **API Keys** → copy the **secret** key (or legacy `service_role`) and the project URL.
3. Paste both into the Streamlit app's Secrets under `[supabase]` (see `.streamlit/secrets.toml.example`).

Never put the secret key in the repo or the browser — it stays in Streamlit secrets only.
Free Supabase projects pause after ~7 days with no database activity; normal app use keeps it awake.
If it does pause (off-season), click **Resume project** in the Supabase dashboard — data is kept.
Without secrets, the app uses temporary local files (fine for testing).

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
