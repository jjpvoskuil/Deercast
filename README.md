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

## Persistent storage (stands + punch list)
Streamlit Cloud's disk is wiped on restart, so data is stored as JSON in a **separate private GitHub repo**
(this app repo is public — stand GPS should not be). Setup:
1. Create a **private** repo `jjpvoskuil/deercast-data` (with a README so `main` exists).
2. Create a fine-grained PAT: Repository access → only `deercast-data`; Permissions → Contents: Read and write.
3. Put it in the app's Secrets under `[storage]`.

Without these secrets the app uses temporary local files (fine for testing).

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
