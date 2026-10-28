# Deercast session log

Newest first. Each session: what changed, decisions made, and what's open.

---

## 2026-10-27 — Session 1b: field-test fixes (v0.4.1 → v0.5.0)

John's first test sit (John's Stand, 3:17–7:49 PM, 74°F, wind SE 1 mph, scores 1.5–6.3, no deer) logged cleanly. Fixed his punch-list items:
- **Past hunt save crash** (High bug): `int(NaN)` from an empty count cell in the old data_editor. The past-hunt and live sighting entry was rebuilt with no spreadsheet editor: a "How many" button row (1–10), optional activity and bait, then tap +Buck/+Doe/+Fawn/+Unknown. Sightings are listed with ✖ to delete.
- **Rut date for past seasons:** `scoring.rut_peak_for()` uses the rut of the date's own season. A 2025 hunt is scored against the 2025 rut, and January uses the previous November. This was also a latent bug on the Forecast page.
- **Live hunt clock:** a client-side JS clock (`deercast/clock.py`) counts up time on stand every second. It also counts down to legal light and sunrise for a morning hunt, or sunset and the end of legal light for an evening hunt. Morning vs. evening comes from the start time relative to mid-day. The clock also shows before a hunt starts. The forecast for this hour and the next 2 hours is shown while hunting.
- **Stays logged in:** a signed token in the URL (`?k=`) survives Safari reconnects. There's a Log out button. John needs to log in and then re-add the home-screen icon once.
- **Score colors** are now red = poor → green = best, on both the heatmap and the day bars. All charts are locked: no zoom, pan or rescale.
- **Shot page:** a new "Arrow" input (pass-through recovered / not found / stayed in the deer / not sure) changes the bone default, blood expectations and wait time.
- **New Bow Setup page:** setups with IBO/rated speed, draw weight and length, arrow weight, and broadhead. Shows estimated fps, KE, momentum, a bone-penetration rating, and a flight-time vs. sound table. The active setup feeds the Shot page and sets the default answer to the bone question.
- Switched from the deprecated `components.html` to `st.iframe` (`ui.html_frame`). Fixed a crash when saving a bow setup (the selectbox state was set after the widget was drawn).
- Tests: 27 passing.

**Open / next**
- John to mark done on the punch list: past hunt save, past entry UI, arrow not recovered, score colors/fixed chart, time out, hunt timer, countdown, bow setup. (Also the old seed item "Hunt log: record sightings", which v0.4.0 delivered.)
- Remaining backlog: state-agency rut dates (High), thermals on scent cones (High), calibrate weights (after ~30 logged hours), best stand for tomorrow, Google basemap, wind grid, PWA icon.

---

## 2026-10-27 — Session 1: v0.1 scaffold

**Built**
- Full app scaffold: Forecast, Map & Wind, Development pages; password gate (`APP_PASSWORD` secret).
- Activity model v0.1 (`deercast/scoring.py`, documented in `docs/MODEL.md`): diel curve, rut/season curve vs. peak breeding date, temperature (heat + 24 h change), pressure (level + 3 h trend), wind, precip (incl. post-rain clearing), cloud, daily moon phase, solunar. Hourly factor breakdown shown in-app.
- Weather: Open-Meteo, 15 days (today + 14) plus previous 24 h for trends. ZIP lookup via zippopotam.us.
- Map: Esri satellite / OpenTopoMap / OSM, stand pins with good-wind directions (green/red by current wind), live or 48 h forecast wind, scent cones from all stands and a tap-to-test pin, "Forecast this pin", GPS locate button.
- Punch list with seed backlog; storage via GitHub Contents API to a private data repo, local fallback.
- Tests: scoring sanity + headless render of all pages + storage (21 passing).
- v0.1.2: storage = private GitHub repo `deercast-data` (Supabase backend retained as option); punch-list export on the Development page for session handoff.
- v0.1.3: compass rose on the map (top-right, north-up) with an orange wind arrow pointing downwind (scent travel) + wind caption (`deercast/compass.py`).
- v0.2.0: Map always opens on Satellite (folium was showing the last-added base layer, Streets); satellite overzooms past z19 instead of blanking. New **Regulations** page: FCC county lookup → KY 2026-27 zone, seasons (open/closed, days to open), today's legal hours, zone + statewide bag limits, CWD rules for the 23 surveillance counties, official links. Replaced deprecated `use_container_width`; pinned streamlit <2.
- v0.2.1: John's stand is in **Hart County**. Default location moved to Cub Run town center (37.3006, -86.0608, Hart Co.) — old default point sat near the Hart/Edmonson/Grayson line. `ui.DEFAULT_COUNTY = "Hart"` is the regs fallback; sidebar has a 🏠 Back to home button.
- v0.3.0: **Shot & Recovery** page (`app_pages/track.py`): 3D ellipsoid deer anatomy, rotatable shooter's-eye view (angle select-slider, left/right side, buck/doe, vitals overlay), tap-to-place crosshair + nudge buttons, downward angle from stand height/distance, ray-cast organs hit with bow bone-stop alternate outcome, evidence/reaction inputs (sign can override geometry), survival/wait/distance, arrow-path top+side diagram, search-probability map (stand → hit site by bearing+distance, run direction, Open-Meteo terrain), start-tracking time, rain/heat alerts, tips, save to `shots` log. Model doc: `docs/SHOT_MODEL.md`. New deps: matplotlib, streamlit-image-coordinates, pillow.
- v0.3.1: Recovery map now weights **water and heavy cover** (John: wounded deer head to water/thick cover to die). OSM Overpass water/woods (ways + multipolygon relations, cached 7 d) + hunter-marked water/cover/bedding circles on the Map page (`features.json`). Per-outcome water/cover bias; drawn on the recovery map. Overpass not reachable from sandbox — verify live on Streamlit.
- v0.4.0: **Hunt Log** page — live sit tracking (start/stop stored in `active_hunt` so it survives reloads; quick +Buck/+Doe/+Fawn/+Unknown buttons; editable activity/bait/notes), past-hunt entry, per-hour forecast score snapshot, weather snapshot, and **forecast validation** (deer/hour by score band chart, Spearman ρ, plain-English verdict, re-score button). **Bait & food marks** on the Map: broadcast feeder, shelled corn pile, ear corn pile, other food, with last-filled date and 'Filled today'; baiting-rule reminder. Bait marks excluded from recovery weighting.

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
- Shot page: validate outcome tables/wait times with John's experience; add deer-size scaling; record recovery result per saved shot for calibration; test tap accuracy on iPhone.
- Add other states' regulation data as needed (currently link-out only).
- Default rut peak is latitude-based (KY ≈ Nov 14) — replace with state-agency table.
- Model weights are literature/hunter-knowledge priors, not yet calibrated — Hunt Log now collects the data; fit weights once ~30+ hours are logged.
- Possible next: bait-site activity stats from the log (which feeder/pile draws deer at what hours); flag bait sites not filled in N days.
- Live weather wasn't reachable from Claude's sandbox; first real-data check happens on Streamlit.
