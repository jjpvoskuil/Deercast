# Deercast activity model (v0.1)

Hourly score, 0–10. Factors multiply; each is ~1.0 under ordinary conditions.

```
raw   = diel × season × temp × pressure × wind × precip × cloud × solunar
score = 10 × clip(raw / 1.25, 0, 1)
```

Calibration targets: ordinary peak-rut sunrise ≈ 8; cold, calm, rising-pressure rut morning = 10;
October-lull sunrise ≈ 5; midday outside the rut ≈ 1–2. All constants are in `deercast/scoring.py`
(`MODEL`, `SEASON_KNOTS`, `HOT_THRESHOLD_F`) so they can be tuned.

| Factor | What it does | Range | Evidence strength |
|---|---|---|---|
| **Diel** | Gaussian peaks ~10 min before sunrise and ~15 min after sunset (σ 70 min); night baseline 0.40, midday 0.18 | 0.18–1.0 | Strong — whitetails are crepuscular (GPS-collar studies consistently) |
| **Rut midday boost** | Adds up to +0.20 to midday baseline during seeking/chasing | — | Strong — bucks cover more ground midday in the rut |
| **Season** | Interpolated curve vs. days from peak breeding date: early season 0.72, Oct lull 0.60, pre-rut 0.80, seeking/chasing 1.00, lockdown 0.85, post-rut 0.72, 2nd rut 0.80, late 0.70–0.76 | 0.60–1.0 | Strong for rut timing; peak date varies by region |
| **Temperature** | Heat penalty above a monthly threshold (Nov 60°F) at −3%/°F; 24 h change −1.5%/°F (a 15°F drop ≈ +22%) | 0.55–1.25 | Moderate–strong; cold fronts are the most consistent hunter-observed driver |
| **Pressure** | Level ≥30.0 inHg +4%, <29.8 −8%; rising ≥0.03 inHg/3h +8%; sharp fall (pre-front) +4% | ~0.89–1.12 | Moderate; partly a proxy for frontal passage |
| **Wind** | Best 3–10 mph; 15 mph −12%, 20 mph −26%; gusts >25 −10% | 0.54–1.0 | Moderate |
| **Precipitation** | Heavy rain −35%, moderate −15%; first dry hours after ≥0.05" rain +12% | 0.65–1.12 | Moderate |
| **Cloud** | Overcast daylight +4% | 1.0–1.04 | Weak–moderate |
| **Moon (daily phase)** | Near full: dawn peak −8%, midday +10%. Near new: twilight +5% | ±10% | **Weak / mixed** — controlled studies find little effect; kept small on purpose |
| **Solunar** | Moon overhead/underfoot ±60 min up to +6%; moonrise/set ±30 min up to +3% | 1.0–1.09 | Weak |

**Peak rut date (v0.6):** the date is looked up by state and region in `deercast/rut.py`. The state comes from the
ZIP code, or from the FCC census lookup for a map pin or stand.
- **Agency-sourced:**
  - KY: Nov 15, mid-November per UK Forestry Extension.
  - TX: TPWD ecological regions, which run from Oct 31 on the Gulf Prairies to Dec 20 in South Texas.
  - AL: north ~Dec 30; most of the state ~Jan 28 (WFF).
  - MS: Delta ~Dec 10, central ~Jan 5, southeast ~Feb 1 (MDWFP conception map).
  - GA: DNR rut map. Most of the state ~Nov 8, mountains ~Nov 20, southwest ~Dec 12.
- **Approximate:** FL, LA and SC follow the general pattern of their agency maps. Other states use a regional
  average for the state.
- **Season handling:** Jan–Jun dates belong to the following calendar year (`season_year`).
- **Override:** changing the sidebar date sets an override. Reset returns to the agency date. The Forecast page
  and Hunt Log scoring both use `ui.rut_for()`.

**Legal hours:** 30 min before sunrise to 30 min after sunset (Kentucky; configurable in `Settings`).

**Forecast confidence:** days 0–2 High, 3–6 Medium, 7–14 Low.

## Data sources
- Weather: Open-Meteo forecast API (no key), hourly, 15 days incl. today + previous 24 h for trends.
- Sun/moon: PyEphem, computed locally.
- ZIP → lat/lon: zippopotam.us, fallback Open-Meteo geocoding.

## Validation (Hunt Log, v0.4)
- Each saved sit stores, for every clock hour hunted: the model score, the minutes hunted, and the deer seen.
  It also records the app version. Scores for past dates use Open-Meteo forecast data from the last ~3 months,
  with the historical archive as a fallback.
- The **Hunt Log** page compares the forecast with sightings in two ways:
  - Deer seen per hour within each score band (0–2, 2–4, 4–6, 6–8, 8–10).
  - The Spearman rank correlation between the hourly score and deer seen per hour. Hours with less than
    10 minutes hunted are excluded.
- **How to read it:** about 30 hunted hours (10+ sits) are needed before the trend means much.
  If ρ ≥ 0.3, the forecast is working. If ρ is around 0, or negative, the model needs tuning for the property.
- **Next step:** use the logged hours to fit the factor weights (`MODEL`, `SEASON_KNOTS`) once there's enough data.

## Next model steps
Hunt-log feedback loop for calibration, thermals from elevation.
