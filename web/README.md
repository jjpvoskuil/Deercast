# Deercast web (test)

A phone-first React rebuild of the **Map** screen, to compare with the Streamlit app. Read-only.

- **Sign-in:** Supabase Auth → Google. Only emails in `app_users` see anything; each hunting ground is visible
  only to its owner + members. Enforced by row-level security in `supabase/schema.sql`, not by the page.
- **Data:** a copy of the private `deercast-data` repo, loaded into Supabase with
  `python web/supabase/make_import.py <deercast-data>/data > deercast_import.sql` (output = private data, never commit;
  pasted into Supabase → SQL Editor). Streamlit stays the source of truth; re-import to refresh.
- **Keys:** `src/config.js` holds only the Supabase URL + *publishable* key (public by design). No secret keys in `web/`.
- **Weather/elevation:** Open-Meteo straight from the phone (keyless). `src/lib/geo.js` + `terrain.js` are ports of
  `deercast/scent.py` + `terrain.py`; `npm test` checks them against `src/lib/fixtures.json`
  (regenerate with `python web/supabase/make_fixtures.py` whenever the Python geometry changes).
- **Hosting:** Netlify from GitHub (`netlify.toml` at repo root, base `web/`), auto-deploys on push.
- **Without a key** (`SUPABASE_KEY` still `PASTE…`) the app runs on made-up demo data.

Dev: `cd web && npm i && npm run dev`.
