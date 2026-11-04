// Deer activity model — JavaScript copy of deercast/scoring.py. Same factors, same constants; docs/MODEL.md explains them.
// Keep the two in step: change both, regenerate fixtures (python web/supabase/make_fixtures.py), run npm test.
import { dailyAstro, sunAltitudeDeg } from "./astro.js";
import { dateKey, daysBetween, parts } from "./tz.js";

export const MODEL = {
  scale: 1.25,
  dawn_offset_min: -10, dusk_offset_min: 15, peak_sigma_min: 70, peak_height: 0.82,
  midday_base: 0.18, night_base: 0.40, rut_midday_boost: 0.20,
  full_moon_dawn_penalty: 0.08, full_moon_midday_boost: 0.10, new_moon_twilight_boost: 0.05,
  solunar_major_boost: 0.06, solunar_major_window_min: 60, solunar_minor_boost: 0.03, solunar_minor_window_min: 30,
};
export const SEASON_KNOTS = [[-75, 0.72], [-50, 0.66], [-35, 0.60], [-24, 0.62], [-16, 0.80], [-8, 1.00], [-2, 0.97],
  [4, 0.85], [12, 0.72], [22, 0.74], [28, 0.80], [36, 0.74], [60, 0.76], [100, 0.70]];
export const HOT_THRESHOLD_F = { 1: 55, 2: 58, 3: 62, 4: 70, 5: 75, 6: 80, 7: 82, 8: 82, 9: 78, 10: 70, 11: 60, 12: 55 };

const clip = (x, a, b) => Math.min(b, Math.max(a, x));
const nz = (x) => (x == null || Number.isNaN(x) ? 0 : x);
/** np.interp: linear, clamped at the ends. */
export function interp(x, xs, ys) {
  if (x <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]) return ys[i - 1] + ((x - xs[i - 1]) * (ys[i] - ys[i - 1])) / (xs[i] - xs[i - 1]);
  return ys[ys.length - 1];
}
const KX = SEASON_KNOTS.map((k) => k[0]), KY = SEASON_KNOTS.map((k) => k[1]);
export const seasonFactor = (d) => interp(d, KX, KY);
export const rutIntensity = (d) => clip(1 - Math.abs(d + 6) / 12, 0, 1);
export function temperatureFactor(t, dt24, month) {
  const heat = clip(1 - 0.03 * Math.max(t - HOT_THRESHOLD_F[month], 0), 0.55, 1.0);
  return heat * clip(1 - 0.015 * nz(dt24), 0.85, 1.25);
}
export function pressureFactor(p, tend) {
  const t = nz(tend);
  let level = p >= 30.0 ? 1.04 : p >= 29.8 ? 1.0 : 0.92;
  if (p > 30.45) level = 1.0;
  const tf = t >= 0.03 ? 1.08 : t <= -0.06 ? 1.04 : t <= -0.02 ? 0.97 : 1.0;
  return level * tf;
}
export const windFactor = (w, g) => interp(w, [0, 3, 10, 15, 20, 30], [0.97, 1.0, 1.0, 0.88, 0.74, 0.6]) * (nz(g) > 25 ? 0.9 : 1.0);
export function precipFactor(p0, prev0) {
  const p = nz(p0), prev = nz(prev0);
  if (p < 0.01 && prev >= 0.05) return 1.12; // clearing after rain
  return p < 0.02 ? 1.0 : p < 0.10 ? 0.85 : 0.65;
}
export const cloudFactor = (c, daylight) => (daylight && nz(c) >= 70 ? 1.04 : 1.0);
const gauss = (x, s) => Math.exp(-0.5 * (x / s) ** 2);
const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Score hourly weather. `rows`: [{time (UTC ms), temp_f, pressure_inhg, wind_mph, wind_dir, gust_mph, precip_in,
 * cloud_pct, sky_pct?, ...}] in time order, including the 24 h BEFORE `start` (for trends).
 * Returns the rows from `start` on, each with features, factors (f_*), score 0–10, legal, date, sunrise/sunset.
 */
export function scoreForecast(rows, lat, lon, tz, { rutPeak, start, today, legalBefore = 30, legalAfter = 30, model = MODEL }) {
  const M = model;
  const keys = [...new Set(rows.map((r) => dateKey(r.time, tz)))];
  const ast = dailyAstro(lat, lon, keys, tz);
  const out = [];
  rows.forEach((r0, i) => {
    if (r0.time < start) return;
    const r = { ...r0 };
    r.dtemp_24h = i >= 24 ? r.temp_f - rows[i - 24].temp_f : NaN;
    r.p_tend_3h = i >= 3 ? r.pressure_inhg - rows[i - 3].pressure_inhg : NaN;
    let prev = 0, n = 0;
    for (let j = Math.max(0, i - 6); j < i; j++) { if (rows[j].precip_in != null && !Number.isNaN(rows[j].precip_in)) { prev += rows[j].precip_in; n++; } }
    r.rain_prev_6h = n ? prev : NaN;
    const key = dateKey(r.time, tz), a = ast[key];
    r.date = key;
    r.hour = parts(r.time, tz).h;
    r.month = parts(r.time, tz).m;
    r.sunrise = a.sunrise; r.sunset = a.sunset; r.moonName = a.moonName; r.moon_illum = a.moonIllum;
    r.min_from_sunrise = (r.time - a.sunrise) / 60000;
    r.min_from_sunset = (r.time - a.sunset) / 60000;
    r.sun_alt = sunAltitudeDeg(lat, lon, new Date(r.time + 30 * 60000));
    r.daylight = r.sun_alt > 0;
    r.legal = r.min_from_sunrise + 60 >= -legalBefore && r.min_from_sunset <= legalAfter;

    const dfp = daysBetween(rutPeak, key);
    r.days_from_rut_peak = dfp;
    r.f_season = seasonFactor(dfp);
    const rut = rutIntensity(dfp);

    const dawn = gauss(r.min_from_sunrise + 30 - M.dawn_offset_min, M.peak_sigma_min);
    const dusk = gauss(r.min_from_sunset + 30 - M.dusk_offset_min, M.peak_sigma_min);
    const dark = clip((6 - r.sun_alt) / 12, 0, 1);
    let base = M.midday_base + rut * M.rut_midday_boost * (1 - dark);
    base = base + (M.night_base - base) * dark;
    const illum = a.moonIllum;
    const full = clip((illum - 0.6) / 0.4, 0, 1), neu = clip((0.25 - illum) / 0.25, 0, 1);
    const dawnW = 1 - M.full_moon_dawn_penalty * full + M.new_moon_twilight_boost * neu;
    const duskW = 1 + M.new_moon_twilight_boost * neu;
    const middayW = 1 + M.full_moon_midday_boost * full * (1 - dark);
    r.f_diel = Math.min(1.0, base * middayW + M.peak_height * Math.max(dawn * dawnW, dusk * duskW));

    const sol = (events, win) => events.length ? Math.max(0, 1 - Math.min(...events.map((e) => Math.abs(r.time + 30 * 60000 - e) / 60000)) / win) : 0;
    r.f_solunar = 1 + M.solunar_major_boost * sol(a.majors, M.solunar_major_window_min) + M.solunar_minor_boost * sol(a.minors, M.solunar_minor_window_min);

    r.f_temp = temperatureFactor(r.temp_f, r.dtemp_24h, r.month);
    r.f_pressure = pressureFactor(r.pressure_inhg, r.p_tend_3h);
    r.f_wind = windFactor(r.wind_mph, r.gust_mph);
    r.f_precip = precipFactor(r.precip_in, r.rain_prev_6h);
    r.f_cloud = cloudFactor(r.sky_pct ?? r.cloud_pct, r.daylight);
    r.f_weather = r.f_temp * r.f_pressure * r.f_wind * r.f_precip * r.f_cloud;
    r.score = round1(clip((10 * r.f_diel * r.f_season * r.f_weather * r.f_solunar) / M.scale, 0, 10));
    const lead = today ? daysBetween(today, key) : 0;
    r.confidence = lead <= 2 ? "High" : lead <= 6 ? "Medium" : "Low";
    out.push(r);
  });
  return out;
}

/** Per day: best legal hour, AM/PM bests, average, high/low, moon, confidence. */
export function bestWindows(scored) {
  const days = new Map();
  for (const r of scored) { if (!days.has(r.date)) days.set(r.date, []); days.get(r.date).push(r); }
  const out = [];
  for (const [date, all] of days) {
    const g = all.filter((r) => r.legal);
    if (!g.length) continue;
    const top = g.reduce((b, r) => (r.score > b.score ? r : b), g[0]);
    const am = g.filter((r) => r.hour < 12), pm = g.filter((r) => r.hour >= 12);
    const temps = all.map((r) => r.temp_f);
    out.push({ date, bestHour: top.time, bestScore: top.score,
      amScore: am.length ? Math.max(...am.map((r) => r.score)) : NaN, pmScore: pm.length ? Math.max(...pm.map((r) => r.score)) : NaN,
      avgDaylight: g.reduce((s, r) => s + r.score, 0) / g.length, hi: Math.max(...temps), lo: Math.min(...temps),
      moon: g[0].moonName, confidence: g[0].confidence, sunrise: g[0].sunrise, sunset: g[0].sunset });
  }
  return out;
}
