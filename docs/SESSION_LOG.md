# Deercast session log

Newest first. Each session: what changed, decisions made, and what's open.

---

## 2026-11-11 — Session 5: recovery map kept out of the lake (v0.8.2)
John: Hit analysis → recovery sometimes put the probable spots out on Nolin Lake.
- **Cause (confirmed):** water was only ever an *attraction* (meters to the nearest water line, boosted within ~100 yd). Nothing asked whether a cell was *in* the water, so a cell out on the lake still counted as "close to water" and got boosted. Nolin's OSM multipolygon members were also used as separate lines, never joined into rings, and if Overpass failed there was no water data at all.
- **New water rule** (`deercast/recovery.py` + `web/src/lib/recovery.js`, documented in `docs/SHOT_MODEL.md`):
  - `parse_osm`/`parseOsm` + `assemble_rings` join member ways into closed rings, read even-odd (outer minus inner), so islands are land.
  - Open water = `natural=water` / `waterway=riverbank` / `landuse=reservoir`, excluding intermittent ponds. A cell whose center is in open water gets 0.
  - No swimming: if the straight line from the hit site crosses more than 50 m of open water (`SWIM_MAX_M`, computed exactly from ring crossings), the cell gets 0.
  - The zeroed share moves to the last dry, reachable cell on the same bearing (`apply_water`), so a deer running at the lake piles up along the shore. Streams stay attractor lines, wetlands stay passable, and the hunter's water marks (circles) stay attractors. The water pull for shore cells is distance to the shoreline (lake and island rings are in the water lines).
- **Bundled Nolin shoreline** `web/public/data/nolin_water.json` (169 KB, fetched only within 5 km of the lake; built by `tools/make_nolin_water.py`). It is the 514-ft lidar contour from the Fishin Magician depth build: a 5,070-acre ring with 6 islands. It is merged as a union with Overpass, and used alone when Overpass fails.
  - Not used: `data/nolin_shoreline.geojson` (1966 topo digitization). It is 1,366 fragments covering only ~37% of the lake.
  - Limit: the lidar box ends at lat 37.388 / lon −86.098. Upstream of that, the Nolin River and east arms come only from OSM.
- **Map:** no shading over open water. Shore cells are drawn as their dry 5×5 sub-strips (`dryPieces`). If at least 15% of the probability was over water, one line shows: "Spots over the lake were removed — the deer most likely went down along the shore." ("pond / bank" for small water). If the hit site plots in the water, the map says to check distance and direction. The Streamlit page got the same rule.
- Tests: `tests/water_cases.py` (made-up lake split into 3 ways with an island; facing the lake, far bank, lake behind, on the island, stream + small pond + water mark, Overpass failed → bundled Nolin, Overpass + bundled), `tests/test_recovery_water.py` (15) and the JS parity test (fixtures `water` in `shot.fixtures.json`). 56 py + 30 JS passing.
- Screenshot checked with Playwright: a made-up stand ~300 yd inland of Nolin's shore, synthetic Overpass (and Overpass returning 504), mocked tiles and elevation. Shading stops at the shoreline and the top 3 spots are on the shore.

- Hunt Log "Deer seen": the "At bait" drop-down (which feeder or pile) is now an **At a feeder?** on/off toggle (John: which one doesn't matter). It stores `bait: "feeder"` or `""`, and older sightings with a bait name still show it.

- Hit analysis → Arrow: new choice **"Pulled out of deer — no pass-through"** (arrow found, partial penetration). It is handled like "stayed in the deer": less-blood note, bone stop by default, and long waits on lethal hits increased by half. The note says to read the penetration depth and blood color off the shaft. The "Exit is low/high" line is now hidden for both of these choices, since there's no exit hole.

**Open / next**
- Decided (John): keep the lake outline at summer pool. A deer rarely dies out on a drawn-down flat, and one that does is easy to spot from the summer shoreline. No level-aware shoreline.
- John tested all three changes on his phone: looks good.

## 2026-11-10 — Session 4b: fixes from John's first live tracking test
- **"Current location" now means the phone's GPS position.** Before, it silently used the ground's home spot. The Hit analysis also switched it to the first stand and saved that back to the shot. Now starting a sit from Current location saves `lat/lon` on the live sit. Shots get `from_lat/from_lon` (the sit spot → else trip 1's first GPS point → else home). TrackMode takes a separate `stand` point, so the orange S is where you shot from, not the hit site. ShotScreen keeps a shot's own "shot from" (the first-stand default applies to the calculator only). Edit shot has a "Shot from" picker.
- **A recovered deer is logged as a deer seen.** If the sit has no stand sighting within 2 h of the shot (and the shot doesn't name one), a sighting from the recovery's sex is added (Buck / Doe / Button buck → Fawn+buck / else Unknown, note "Added from the recovered deer"). Saved hunts are re-scored. This runs once per shot (`seen_logged`), so it also back-fills John's test hunt the next time he opens the Hunt Log.
- Bow setup: **arrow length** (nock throat to end of shaft) and **balance point** (from the nock throat, tip on) give a live **FOC %**, using `(balance − L/2) / L × 100` (AMO/ATA; balance measured from the nock end or the tip end — `balance_from`, auto-detected for older setups). Classes: <7 low, 7–10 target, 10–15 good for hunting, 15–19 high, 19%+ extreme. `foc()` is in archery.js and archery.py, with a JS test.
- Grounds: the home location takes a **street address or a ZIP** (both on create and on change). `places.geocodeAddress`: US Census geocoder (JSONP; it doesn't allow CORS), with OpenStreetMap Nominatim as the fallback. A Nominatim match that isn't a house-level hit is flagged "approximate" in the toast.
- **Gun setup page** (More → Gun setup): type (rifle / slug / muzzleloader / handgun), make, cartridge or gauge, bullet weight and type, load, muzzle velocity, G1 BC (optional, with a per-type default), zero, sight height, optic, notes. `lib/ballistics.js`: G1 point-mass trajectory (standard air, no wind, RK2), giving velocity, energy and drop at 25–300 yd plus the max range with 1000+ ft·lb. Tested against published .308 168 gr numbers. Guns are stored in the same `gear` doc (`guns`, `active_gun`); Bow setup saves now keep them.
- **Bow or gun everywhere:** `lib/gear.js` lists your bows + guns + generic types. Used for "Hunting with" on the live sit start and past/edit hunt forms (saved as `weapon_id`, `weapon`, `weapon_kind`, `setup` on the hunt), the shot's Weapon (defaults to the hunt's), and Hit analysis (bow: that setup's penetration; gun: energy, velocity and drop at the shot distance, with a warning under 1000 ft·lb). Regulations has a season filter: All / Bow & crossbow / Gun & muzzleloader.
- Netlify retired. With John's OK I deleted the deercast-john project in his Chrome, removed `https://deercast-john.netlify.app/**` from Supabase's Redirect URLs (only the GitHub Pages one is left; Site URL is GitHub Pages), and deleted `netlify.toml`. Note: John's Netlify team now shows no projects at all, so Gigi's Vixen Vault's Netlify site must be under another account or team.
- Wrote handoff prompts for John's other apps: Gigi's Vixen Vault (Netlify → GitHub Pages) and Fishin Magician (Streamlit → web app on GitHub Pages; Supabase's free plan allows 2 projects, so it may share an existing one).
- **GPS path stopping after the app went to the background** (John swiped to the app switcher; iOS Safari doesn't always resume `watchPosition`). The watch now restarts on `visibilitychange`/`pageshow`, a 5 s watchdog restarts it if no fix arrives for 20 s, and `maximumAge: 0`. A gap of over a minute between points is drawn as a thin white dotted line instead of a solid straight segment.

## 2026-11-09 — Session 4: sightings, trail cams, staged shots (web)
**Changed**
- Number boxes (`web/src/NumInput.jsx`): tap selects the value so typing replaces the 0 (iPhone can't select text in type=number inputs). Used for Shot distance/height/last-seen, sighting distance, mark radius, and Bow setup.
- Hunt Log: one "Deer seen" card (From my stand / On a trail cam, time, steppers for Buck, Doe, Doe fawn, Button buck, Fawn not sure, Unknown, doing, bait, where). Each Save is stored in `active_hunt` immediately; the list allows retime/delete. Fawn records: `kind:"Fawn"` + `fawn: doe|buck|unknown` (`huntlog.kindLabel`).
- Trail cameras: new map mark `camera` with an optional `stand_id` (set when added or from the Map's "Trail cameras" list). Cam sightings carry `source:"camera"`, `camera`, `near` ("Stand: X" or null), and the camera's lat/lon. They **count toward `seen`** (forecast check; John: the cams are in the same area). With any cam sighting, `hours[].at` = deer per stand label, and the hunt gets `cam_stands`. `beststand.historyRates` credits a stand with its own sits plus sits where its camera was checked, using `at` so far-off cams don't count (JS + Python updated together, plus a test).
- Shots: "Shot taken" on the live sit, the past-hunt form and hunt edit opens the Shot tab linked by `hunt_id` (live sits now get an `id` at start). The Shot page has **Shot & hit / Shot & missed**; a miss hides the analysis. Result: Still tracking / Recovered / Not found. **Tracking trips** `[{date,from,to,notes}]` record tracking that runs overnight. Save progress any time; the full input snapshot is in `input`, so a shot reopens from My shots or the Hunt Log (delete is there too). `time` is now local (it was UTC by mistake) and `time_iso` is added. Hunt entries show their linked shots; "harvest" comes from a recovered shot (the old field is kept).
- End & save on a sit older than 5 h asks when you climbed down (tracking belongs on the shot, not the sit).
- Tracking trips record what you found and where you left off: blood amount and look, other sign, trail heading, a GPS "left off here" spot (shown on the search map with a dotted trail, plus a "Walk to the last blood" link), distance from the hit, why you stopped, helpers or dog, and notes. When you reopen a shot that's still tracking, the top shows **Where you left off**. When it's done: `found_yd` (recovered distance, or farthest blood). My shots shows trips, hours and blood for learning.
- No schema change: all new fields live in the jsonb `data`.

- **Hosting moved to GitHub Pages** (https://jjpvoskuil.github.io/Deercast/). Netlify's free plan is 300 credits/month at 15 per production deploy, so about 20 deploys. Those ran out on Nov 4, and every push since was "Skipped" (Netlify's period runs Nov 4–Dec 3). Changes: workflow `.github/workflows/pages.yml`, Vite `base` from `BASE`, relative manifest/icons, sign-in `redirectTo` = origin + BASE_URL. In John's Chrome, with his OK, I set Pages source = GitHub Actions and added Supabase redirect URL `https://jjpvoskuil.github.io/Deercast/**` + Site URL. The build time is shown in the menu and More.
- Hunt Log: "I shot at this deer" on each sighting; "Shot taken on this hunt" on every saved hunt; edit/past forms save before opening the Shot page; edit errors are shown instead of hanging.

- Tracking rework (`web/src/TrackParts.jsx`): a saved hit opens with **Tracking & recovery** at the top. That card has a satellite track map (stand, hit site, each trip's spots joined in order, recovery spot), the trip history, and "+ Add a tracking trip (picking it back up)". The shot details and analysis (sections 1–7) sit behind a toggle. Every location field offers **📍 Where I am now** or **🗺️ Pick on map** (tap a satellite map; works later from memory). Trip spots: `marks [{kind: blood|last|bed|lost|arrow, lat, lon}]`; old single `lat/lon` = last blood. Optional exact hit site `hit_fix` overrides the estimate. Recovered: `found_lat/lon`, `found_date/time`, distance auto-computed from the hit, `organs_actual` (what it really hit), `found_notes`. Hunt Log shows an **Open track** card per unrecovered hit with "Pick up the track". The Shot page scrolls its own container to the top when opening a shot.

- **Session flow rebuilt (John: the separate Shot page was clunky).** The Shot tab is gone. In the Hunt Log sit: deer seen → **🎯 I took a shot** (Hit / Missed, time, distance, weapon, which deer). A hit shows a **let-it-lie timer**: time since the shot, plus the recommended wait (`wait_min` from Hit analysis, else general guidance). **▶ Start tracking** opens `TrackMode.jsx`: a full-screen satellite map that records the GPS breadcrumb path (`watchPosition`, ≥4 m steps, accuracy ≤35 m, saves batched every 15 s; Wake Lock keeps the screen on; "Pause path" for a break). It has one-tap pins at your position or by tapping the map (🎯 hit site, 🩸 blood, 🟢 trail start, 🔴 trail end, 🏹 arrow, 🛏️ bed, ❓ lost, 📌 other), each with quick detail chips + notes, saved the moment they drop. Bottom buttons: ⏸ Stop for now (trip ends, track stays open), 🦌 Found it (spot, time, deer, points, weight, what it actually hit, entry/exit), ✖ Call it off (not found, farthest blood). For recreating later: "+ Add a past trip", ✏️ Draw path (dashed), tap-to-place pins with an editable time. The Log sheet lists trips and pins. The Hunt Log shows each shot at its stage plus **Open track** cards; past hunts use the same panel. Hit analysis (the old Shot page) now opens over the session and merges its fields into the shot (`patchShot`); More → Shot analyzer is the stand-alone calculator. Shot record: `trips [{id,start,end,path[[lat,lon,t]],drawn,stopped,notes}]`, `pins [{id,kind,lat,lon,time,trip,details,notes}]`, `recovery {...}`. Older `tracking` records are converted by `normalizeTrack`. `TrackParts.jsx` was removed.

- Follow-ups: Draw path works before any trip exists. Trip date/times can be edited in the Log. "Stop for now", "Call it off" and "Pick up the track" (new start sheet) each take **Now or an entered date & time**. Stop reasons are multi-select (`stops[]`, plus a joined `stopped` string). Saving a new hit opens Hit analysis straight away. The path is saved when the phone locks or the app is switched.

**Open**
- iPhone Safari pauses GPS when the screen locks or the app goes to the background, so the breadcrumb only records while Deercast is open on screen. Wake Lock keeps the screen on. A native app would be needed for background tracking.
- John: re-add the app to his home screen from the new address (delete the old Netlify icon).
- John to correct his last hunt in the app: Edit the hunt's end time → Shot taken → hit, Not found, two tracking trips (that evening until 8 PM; next day 6:30 AM–1 PM).
- Grounds-read RLS fix / Matt creating a ground: still unconfirmed.

## 2026-11-04 — Session 3: full migration to the web app (v0.8)

John decided to move everything to the new app. He stopped using the Streamlit app, so a single cutover import is safe.
- **Data layer** `web/src/lib/db.js`: one API with two backends, Supabase and a browser-only demo (`?demo`). App-level `save()` reloads the data and shows a toast.
- **Schema v2** (`web/supabase/schema.sql`, re-runnable, upgrades v1):
  - write policies: own hunts/gear/shots/active hunt; members edit stands and marks; owners manage grounds; admins manage app users and the punch list
  - `leave_ground()`; hunts and shots survive a ground delete (`on delete set null`)
  - verified on local PostgreSQL 16 for an outsider, signed-out, John (admin/owner) and Matt (member)
- **Screens ported:**
  - **Hunt Log:** live sit with clock and countdowns, 0-default quick entry, groups, where; past hunts; edit/delete; per-hour scoring with archive weather for old dates; validation chart.
    - John's request: **"Time seen"** on the live sit (Now by default; type the time in after watching deer), and **every sighting's time is editable** in the live sit, past-hunt entry and hunt edit.
  - **Shot & Recovery:** vector deer view with tap and nudge, outcomes, sign/bone choices, arrow-path diagram, search map (terrain + OSM water/woods + marks), timing and weather alerts, tips, saved shots.
  - **More:** Grounds (switch/create/rename/home by ZIP or GPS/members/leave/delete; admin app users), Bow setup, Regulations (KY data generated from Python), Development punch list with export.
  - **Map editing:** add a stand or mark where you tap, edit/center/delete stands, bait "Filled today", delete marks, and "Forecast this pin".
  - **Best stand** shows the score breakdown (activity × wind fit × history).
- **Parity tests:** 24 JS tests against Python fixtures cover the model, hunt log, archery, shot (1,815 traces) and recovery.
- Streamlit shows a "Deercast has moved" banner and is a backup only.
- **Cutover:** schema v2 plus a fresh import (2 users, 1 ground, 6 hunts, gear, 17 punch-list items) in one file, sent to John, not committed.
- John to turn off Netlify's **Powered by Netlify** badge (Project configuration → General). It covered the tab bar text.

- **Done the same day:**
  - John ran the cutover SQL (via "Run and enable RLS"; Supabase's checker doesn't see RLS enabled inside a DO loop) and checked the app.
  - He turned off the Netlify badge.
  - He **deleted the Streamlit Cloud app**, revoked its GitHub PAT, and removed the Streamlit redirect URI from the Google client.
- **Backups:** a GitHub Actions workflow in `deercast-data` (Mon & Thu + manual) writes every table to `backups/supabase/`. Each run is a commit, and it also keeps Supabase from pausing.
  - `web/supabase/make_restore.py` turns a backup back into SQL; the round trip was tested identical on local Postgres.

- **Bug (found by Matt):**
  - **Problem:** non-admin, actually anyone, couldn't create a ground. The app saves with an upsert (INSERT … ON CONFLICT DO UPDATE), and Postgres also checks the SELECT policy on the new row. `grounds read` used `is_member(id)`, which looks the ground up in the table, so a brand-new ground failed.
  - **Fix:** the policy now checks the row itself (owner or member, and approved).
  - Reproduced and verified on local Postgres. The policy file was sent to John to run.

**Open / next**
- Matt: confirm his Google sign-in works on the new app.
- Later: calibrate the model weights (≈30+ logged hours); retire the Streamlit app once John is comfortable; then FP1.0 planning.

---

## 2026-10-30 → 11-04 — Session 2b: web app pilot (Map screen on React + Supabase + Netlify)

John wants a more polished, real-app feel than Streamlit. If the pilot works he'll move Deercast, and then his FP1.0 finance app, the same way.
- **Decisions:**
  - Stack: React (Vite) + Leaflet. Supabase Auth with the Google provider (reuses the existing Google OAuth client, plus the Supabase callback URI). Data visibility is enforced by RLS. Hosted on Netlify from GitHub.
  - Plain HTML/JS was rejected as too messy past one screen.
  - The Map was the first screen: it gains most from no reruns, and it is read-only, so it's low risk.
  - Python stays the source of truth: the web copy is a snapshot until we re-import.
  - For FP1.0: Python data pulls and scoring stay in GitHub Actions and write to Supabase. On-demand Python needs a small service, since Edge Functions are TypeScript only. Also noted for FP1.0: IBKR gateway needs a server, Polygon commercial licensing, and Netlify over Vercel Hobby for commercial use.
- **Built (`web/`):**
  - Full-screen map updated in place. Bottom sheet with wind, Live/Forecast hour, stand wind check, toggles (Scent cones / Thermals / Drift field) and map key. Also compass, locate, tap-to-test, ground picker, sign-out, and a home-screen manifest and icons.
  - JS ports of scent.py and terrain.py with a parity test against Python fixtures. Gotcha: suncalc 2.x returns altitude in **degrees**.
  - `supabase/schema.sql`: app_users allow-list, `is_member()`, select-only policies, anon revoked.
  - `make_import.py`: private import, sent to John as a file and never committed.
  - `netlify.toml`: base `web`, skips the build when `web/` is unchanged, noindex/security headers.
- **Setup John did:**
  - Supabase project `deercast` (East US Ohio, Free plan, GitHub repo link skipped). Google provider on. Import result: 2 users, 1 ground, 4 hunts.
  - URL config: Site URL + `https://deercast-john.netlify.app/**`.
  - Netlify project `deercast-john`. New projects default to **Private**, so it had to be set to Public under Visitor access. Base directory `web` was entered in the UI.
- **Look & feel (11-04):**
  - Design canvas "Deercast look & feel" (claude.ai artifact) explored Blaze / Timber / Topo. John chose **Blaze**, made warmer and lighter, in two variants: **Light** (warm stone) and **Soft** (warm charcoal).
  - **Auto switch:** Soft from 30 min before sunset until 30 min after sunrise at the ground's home (`web/src/lib/theme.js`, tested).
  - **Manual override:** the sun/moon button flips the theme until the next automatic switch. The menu → Appearance offers Automatic / Light / Dark ("always").
  - All colors and fonts are tokens in `web/src/styles.css` (`[data-theme]`), so every future screen uses them.
  - Fonts: Barlow + Barlow Condensed. Stroke icon set in `web/src/Icon.jsx`.
  - Bottom tab bar added (Forecast / Map / Hunt Log / Shot). The non-Map tabs say "coming next".
  - `?demo` URL shows the made-up demo data only.
- **Forecast screen (11-04):**
  - The model is ported to JS once (`web/src/lib/model/`), checked against Python on 15 days of synthetic weather: 359/360 hours identical, one 0.1 rounding difference. Sun, moon and solunar times agree within about 1 s.
  - The screen has: day chips (best score per day), a hero card (best score + rating, AM/PM best windows, 24 h bars with legal hours colored, temp/wind strip, tap an hour for details), Best stand (Morning/Evening), Conditions (rut phase + editable peak date with the agency source, moon, pressure, temperature, wind), "Why this score?" factors, the 14-day list with confidence dots, and Refresh.
  - The forecast is cached on the phone, so the app opens instantly.
  - The tab bar now switches between Forecast and Map (the map stays loaded). Hunt Log and Shot say "coming next".
  - John asked that **every** page come over: Hunt Log, Shot, Bow Setup, Regulations, Grounds, Development.
- **Live:** https://deercast-john.netlify.app. John confirmed sign-in and that the map looks good on his iPhone.
- **Data correction:** `data/users/25bf8e1a2393` is the pre-Google `local` placeholder backup (claim_local copies it), not Matt. Real log = 4 hunts, about 12 h. Matt has logged nothing yet.
- The Supabase free plan pauses after 7 idle days (restore from the dashboard). There are 2 free projects per account.

**Open / next**
- John: side-by-side comparison with the Streamlit Map (feel, speed, anything missing).
- If the web version wins: add editing (stands and marks, needing insert/update RLS policies), then decide the data source of truth (move Streamlit's storage to the same Supabase tables, or finish the migration screen by screen). The Forecast model needs one deliberate port (JS or a Python API), not two copies.
- Re-run `make_import.py` whenever the web copy needs refreshing.

---

## 2026-10-30 — Session 2: punch list (v0.7.1 → v0.7.2)

John confirmed: Google sign-in is set up, works from the iPhone home-screen app, and Matt Klein is added (App users + Lewis/Klein member).
- v0.7.1 (between sessions): added `httpx`, which Authlib's Starlette client needs for `st.login` on Streamlit Cloud.
- **Map flicker with Thermals / Drift field** (bug): in Live mode the thermal phase used `datetime.now()` to the second. Sun altitude moves continuously, so cone and arrow geometry changed on every rerun. st_folium keys the component on a hash of the map JS, so it remounted, reported center/zoom, and that reran the script, in a loop. Fix: live `when` is snapped to the 10-minute step the live wind already refreshes on. Regression test `tests/test_map_stable.py` (moving sun, drift field + tap cone on, asserts an identical map hash across reruns). **Rule:** anything drawn on the map must be deterministic between reruns.
- **Hunt Log "How many" defaults to 0** (live sit): 0 is now an option and the default. The +Buck/+Doe/+Fawn/+Unknown buttons are disabled until a number is picked, and the count resets to 0 after each sighting so nothing is logged by accident. The "Several deer together" counts already started at 0.
- Tests: 41 passing.

**Open / next**
- Calibrate factor weights: waiting for ~30+ logged hours.
- John to confirm on the phone that the map stays still with Thermals + Drift field on.

---

## 2026-10-27 — Session 1d: multi-user + hunting grounds (v0.7.0)

John asked for multiple users with Google sign-in, plus the ability for each user to use their own grounds or shared grounds, each with its own ZIP/location.
- **Sign-in:** Streamlit `st.login` (Google OIDC; `[auth]` secrets; `Authlib` added). Access is an allow-list in `users.json`. `ADMIN_EMAIL(S)` from secrets are always admins. Non-listed Google accounts see a "not set up" screen. Password mode remains as a fallback until `[auth]` is configured.
- **Grounds (`deercast/accounts.py`, `app_pages/grounds.py`):**
  - A ground = name, owner, members, and a home location (lat/lon/label/state/zip).
  - Stands and features are per ground. Hunts, active hunt, gear and shots are per user, with hunts and shots tagged `ground_id`.
  - The picker popover sits at the top of every page. Switching grounds jumps the forecast, map and regs to that ground's home.
  - The Grounds page covers switch, create (ZIP or current location), rename, set home (ZIP or current location), add/remove members, leave, and delete. Admins also manage App users.
- **Sharing semantics:** the map's sightings and Best stand history use all members' hunts on the ground (`ui.ground_hunts`). Each person's Hunt Log and validation show only their own hunts on the current ground.
- **Migration:**
  - On the first admin sign-in, the single-user files become ground **"Lewis/Klein Property"**, owned by the admin, with home at the stand centroid.
  - Personal files go to the admin's user folder. The legacy files are kept as a backup.
  - If this first happened in password mode under the placeholder `local`, the first Google admin sign-in **claims** it (`accounts.claim_local`).
- `ui.load/save` resolve paths by scope. Shared files re-read every 90 s so members see each other's edits. A rare lost update is possible if two people edit the same ground file within seconds (GitHub sha retry = last write wins).
- **Fixed:** recursion (grounds → current ground → grounds). The ground picker radio is keyed per ground.
- `docs/GOOGLE_SIGNIN.md` = John's setup steps (Google Auth Platform: Branding, Audience/test users, Clients → Web app, redirect `https://<app>.streamlit.app/oauth2callback`; secrets).
- Tests: 39 passing (incl. migration, claim, and member-visibility tests). The Google flow itself can't be exercised in the sandbox.

**Open / next**
- John: set up Google sign-in per docs/GOOGLE_SIGNIN.md, sign in, and add Matt Klein (App users + Lewis/Klein member). Confirm on the iPhone, especially Google sign-in from the home-screen (standalone) app.
- Watch for: the Google redirect inside Streamlit Cloud, and the iOS standalone-mode cookie.
- Calibrate factor weights (needs ~30+ logged hours).

---

## 2026-10-27 — Session 1c: backlog round (v0.6.0)

Cleared John's open punch-list items plus two he reopened:
- **State-agency peak rut dates** (`deercast/rut.py`):
  - KY = Nov 15, mid-November per UK Forestry Extension. Previously the latitude rule gave Nov 14.
  - TX uses TPWD regions, AL uses WFF (north ~Dec 30, rest ~Jan 28), MS uses MDWFP (Delta Dec 10 → SE Feb 1), GA uses the DNR rut map.
  - FL, LA and SC are approximate; other states use regional averages.
  - The state comes from the ZIP or an FCC lookup. The sidebar shows the source with ✅ (agency) or ≈ (approximate). Changing the date is an override, with a Reset button.
  - I didn't use an aggregator table (bigbuckregistry): it has no primary citations and contradicts UK Extension and TPWD.
- **Thermals on scent cones** (`deercast/terrain.py`):
  - Slope comes from Open-Meteo elevations at 5 points per stand. The phase comes from sun altitude: morning uphill once the sun is >15°, evening downhill below ~8°, switching in between.
  - Thermal pull is 0–3 mph depending on slope, combined with the wind. Cones bend and widen, and the stand wind line describes the thermals.
  - Map toggles: Scent cones / Thermals / Drift field.
- **Wind field grid → scent drift field:** 6×6 arrows over ~0.5 mi around the map center (8×8 elevation grid). Orange is wind-driven, purple is thermal-driven, yellow is switching. Wind is a single value per map because forecast models don't resolve wind variation inside a property; terrain is what varies.
- **Best stand for tomorrow** (`deercast/beststand.py`, on the Forecast page):
  - Picks a day, defaulting to today, or tomorrow after 5 PM.
  - Ranks stands for the Morning (legal light–11 AM) and Evening (2 PM–legal end) sits.
  - Score = mean of the top-3 forecast hours × (0.35 + 0.65 × scent fit) × history.
    - **Scent fit:** the share of legal hours where wind plus thermals send scent opposite the stand's good-wind direction.
    - **History:** logged deer/hour at that stand for that session, shrunk toward a baseline pooled across stands and toward 1 deer/hour (K = 4 h).
  - Each stand gets one-line reasons.
- **Home-screen polish:** Deercast icon (`tools/make_icon.py` → `static/`), favicon, and tags for the iOS title, full-screen standalone mode and theme color, injected via `ui.add_home_screen_tags()`. `server.enableStaticServing = true`. John needs to re-add the home-screen icon once.
- **Bug fixes:** `st.cache_data` was caching failed network lookups. A failed elevation, OSM or state lookup was stuck for 1–30 days. These now raise inside the cached function so failures retry (convention noted in CLAUDE.md).
- v0.6.1: The **Day detail** chart has an aligned hourly weather strip under the score bars (`deercast/daychart.py`): temp line (°F labels every 3 h), wind arrows pointing where the wind blows (size ∝ speed, mph labels), rain-chance bars over a cloud-cover band, and a pressure line (inHg) with the 3-hour trend. Tapping a score bar shows all values for that hour. There's a "Show hourly weather" toggle. Checked visually at phone width (rendered with Chromium from npm `@sparticuz/chromium`, since kaleido's Chrome download is blocked in the sandbox).
- v0.6.2: Home-screen icon fix. John re-added the app, but the icon and name were unchanged: Streamlit Community Cloud wraps the app in an outer page, and iOS reads the icon only from that **top** page. `ui.add_home_screen_tags()` now writes into `window.top.document` (same origin), removes Streamlit's default apple-touch-icon, and probes for where the static icon is actually served (`/~/+/app/static/…` on Cloud, `/app/static/…` locally), falling back to an embedded data URI. Verified in headless Chromium with a simulated Cloud nesting. The Development page has a **📱 Home-screen icon check** that prints what was set.
- v0.6.3: Cloud fix. John saw ~100% cloud at night that didn't match the sky. Open-Meteo **total** cloud cover counts thin high cirrus (stars show through). The app now also fetches low/mid/high cloud. `sky_pct` = low+mid combined (1−(1−L)(1−M)) is the overcast measure, used in the chart's solid band and in the model's cloud factor. High cloud is a faint band above it. The Rain/overcast row has a 0/50/100% scale, and hover shows 'overcast X% (+high Y%)'.
- v0.6.4: John still saw '100% overcast, no faint band' at 9:30 PM under partly cloudy, starry skies. Cause: `ui.cached_hourly` kept serving the pre-v0.6.3 forecast (total cloud only). `st.cache_data` keys on the cached function's own source, which hadn't changed. Fix: forecast caches are now keyed on `weather.SCHEMA` (=2), and this must be bumped whenever weather columns change (convention added to CLAUDE.md).
- Tests: 36 passing.

**Open / next**
- John to confirm the cloud row now splits overcast vs high cloud.
- John to confirm the icon on the phone (Development → Home-screen icon check should show 'top page: icon + name set ✓').
- Calibrate factor weights: stays open until there are ~30+ logged hours.
- The Google Maps basemap punch-list item was deleted at John's request.
- Verify on the live app:
  - static icon path `/app/static/apple-touch-icon.png`
  - Open-Meteo elevation calls (sandbox can't reach them)
  - drift-field appearance on the phone
- Possible next: approach-direction stats per stand from sightings (by time of day and wind) to refine Best stand.

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
- v0.5.1: Past hunts — **deer seen together in one entry** (Bucks/Does/Fawns/Unknown counts + one Add, e.g. 1 doe + 2 fawns). Records share a `group` id; shown as one line everywhere (`huntlog.group_sightings`). Also available on the live sit under 'Several deer together'. After **Save past hunt** the form clears (keeps 'Where') and a confirmation shows.
- v0.5.2: Sightings record **where**: direction from stand (8-pt), distance (yd), came from, went toward (all optional). Map position is computed from the stand (`huntlog.locate`) and stored as `lat`/`lon`. New **Deer sightings** layer on the Map (orange = buck, yellow = doe, tan = fawn; dashed = approach, solid + arrowhead = departure).
- v0.5.3: **Edit logged hunts**. ✏️ Edit opens an inline form in the hunt's entry for where, date, start/end, notes and harvest. Deer can be removed or added (with where/came-from). Save re-scores the hunt, keeps its id, moves sighting times to the new date, and re-places sightings from the (possibly new) stand. Delete now asks for confirmation. The editor's widget state is opened and closed via pending flags (`_ed_open` / `_ed_close`).
- v0.5.4: The live hunt form resets after **End & save** or **Discard**: notes, harvest and the sighting pickers clear (`_live_reset` pending flag), and the page shows "Hunt saved — ready for the next one." The past-hunt form already cleared its notes.
- v0.5.5: Map page explains itself. Under the map, a one-line wind check per stand (e.g. "Wind from N 7 mph — ✅ John's Stand (good: NE, N) · ❌ Hunting Shack (good: NE)") and a **🗝️ Map key** expander covering stand colors, compass and scent cones, bait/water/cover/bedding marks, and sighting symbols.
- Tests: 29 passing.

**Open / next**
- Later: sighting pattern stats per stand (common approach directions by time of day / wind), which would feed 'best stand for tomorrow'.
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

## 2026-11-11 — new home-screen icon
- New icon (John picked it in the Fishin Magician session): Voskuil Outdoors patch look shared by both apps — dark forest field, orange band with stars, cream "VO" medallion, the same deer without its old ring. Generator lives in Voskuil-Fishin-Magician `web/tools/make_icons.py`. Copied into `web/public/` (192/512/180/64) and `static/`.
