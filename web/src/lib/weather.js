// Free, keyless weather + elevation from Open-Meteo, called straight from the phone (no secrets involved).
const FORECAST = "https://api.open-meteo.com/v1/forecast";
const ELEV = "https://api.open-meteo.com/v1/elevation";

const qs = (o) => new URLSearchParams(o).toString();

/** Live wind now. Cached 10 minutes per ~1 km square. */
const windCache = new Map();
export async function currentWind(lat, lon, force = false) {
  const k = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = windCache.get(k);
  if (!force && hit && Date.now() - hit.at < 10 * 60e3) return hit.v;
  const r = await fetch(`${FORECAST}?${qs({ latitude: lat, longitude: lon, current: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    wind_speed_unit: "mph", timezone: "auto" })}`);
  if (!r.ok) throw new Error(`weather ${r.status}`);
  const c = (await r.json()).current;
  const v = { mph: c.wind_speed_10m, dir: c.wind_direction_10m, gust: c.wind_gusts_10m, at: Date.now() };
  windCache.set(k, { at: Date.now(), v });
  return v;
}

/** Next 48 hours of wind: [{time: Date, mph, dir, gust}]. */
export async function hourlyWind(lat, lon, hours = 48) {
  const r = await fetch(`${FORECAST}?${qs({ latitude: lat, longitude: lon, hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    wind_speed_unit: "mph", forecast_hours: hours, timeformat: "unixtime", timezone: "auto" })}`);
  if (!r.ok) throw new Error(`weather ${r.status}`);
  const h = (await r.json()).hourly;
  return h.time.map((t, i) => ({ time: new Date(t * 1000), mph: h.wind_speed_10m[i], dir: h.wind_direction_10m[i],
    gust: h.wind_gusts_10m[i] }));
}

/** Elevations (m) for [[lat, lon], ...]. Terrain doesn't change, so results are kept on the phone. */
const ELEV_KEY = "deercast.elev.v1";
let elevStore;
try { elevStore = JSON.parse(localStorage.getItem(ELEV_KEY) || "{}"); } catch { elevStore = {}; }
const ek = ([a, b]) => `${a.toFixed(5)},${b.toFixed(5)}`;

export async function elevations(points) {
  const missing = [...new Set(points.map(ek).filter((k) => !(k in elevStore)))];
  for (let i = 0; i < missing.length; i += 100) {
    const chunk = missing.slice(i, i + 100).map((k) => k.split(","));
    const r = await fetch(`${ELEV}?${qs({ latitude: chunk.map((c) => c[0]).join(","), longitude: chunk.map((c) => c[1]).join(",") })}`);
    if (!r.ok) throw new Error(`elevation ${r.status}`);
    (await r.json()).elevation.forEach((e, j) => { elevStore[missing[i + j]] = e; });
  }
  if (missing.length) {
    const keys = Object.keys(elevStore);
    if (keys.length > 4000) keys.slice(0, keys.length - 4000).forEach((k) => delete elevStore[k]);
    try { localStorage.setItem(ELEV_KEY, JSON.stringify(elevStore)); } catch { /* storage full or private mode */ }
  }
  return points.map((p) => elevStore[ek(p)]);
}

/** 15-day hourly forecast + the previous day (for 24 h trends), same fields as deercast/weather.py fetch_hourly.
 *  Returns {tz, rows: [{time, temp_f, precip_in, precip_prob, cloud_pct, sky_pct, cloud_high_pct, pressure_inhg,
 *  wind_mph, wind_dir, gust_mph}]}. Cached 1 h in memory; the last result is kept on the phone for instant opening. */
const HOURLY = ["temperature_2m", "precipitation", "precipitation_probability", "cloud_cover", "cloud_cover_low",
  "cloud_cover_mid", "cloud_cover_high", "pressure_msl", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"];
const FC_KEY = "deercast.forecast.v1";
const fcMem = new Map();
const fcKey = (lat, lon) => `${lat.toFixed(3)},${lon.toFixed(3)}`;
export function cachedForecast(lat, lon) {
  const k = fcKey(lat, lon);
  if (fcMem.has(k)) return fcMem.get(k);
  try { const s = JSON.parse(localStorage.getItem(FC_KEY)); if (s && s.key === k) return s.v; } catch { /* none */ }
  return null;
}
export async function fetchForecast(lat, lon, force = false) {
  const k = fcKey(lat, lon);
  const hit = fcMem.get(k);
  if (!force && hit && Date.now() - hit.at < 3600e3) return hit;
  const r = await fetch(`${FORECAST}?${qs({ latitude: lat, longitude: lon, hourly: HOURLY.join(","), forecast_days: 15,
    past_days: 1, temperature_unit: "fahrenheit", wind_speed_unit: "mph", precipitation_unit: "inch",
    timezone: "auto", timeformat: "unixtime" })}`);
  if (!r.ok) throw new Error(`weather ${r.status}`);
  const v = { ...toRows(await r.json()), at: Date.now() };
  fcMem.set(k, v);
  try { localStorage.setItem(FC_KEY, JSON.stringify({ key: k, v })); } catch { /* full */ }
  return v;
}

function toRows(j) {
  const h = j.hourly;
  const rows = h.time.map((t, i) => {
    const lo = Math.min(100, Math.max(0, h.cloud_cover_low?.[i] ?? 0)) / 100, mid = Math.min(100, Math.max(0, h.cloud_cover_mid?.[i] ?? 0)) / 100;
    return { time: t * 1000, temp_f: h.temperature_2m[i] ?? NaN, precip_in: h.precipitation[i], precip_prob: h.precipitation_probability?.[i],
      cloud_pct: h.cloud_cover[i], sky_pct: Math.round(100 * (1 - (1 - lo) * (1 - mid))), cloud_high_pct: h.cloud_cover_high?.[i],
      pressure_inhg: h.pressure_msl[i] == null ? NaN : h.pressure_msl[i] * 0.02953, wind_mph: h.wind_speed_10m[i], wind_dir: h.wind_direction_10m[i],
      gust_mph: h.wind_gusts_10m[i] };
  });
  return { tz: j.timezone || "UTC", rows };
}

/** Hourly weather for past dates ('YYYY-MM-DD'..'YYYY-MM-DD'), for scoring logged hunts: forecast API (~3 months
 *  back), else the historical archive. Like weather.fetch_hourly_range. */
export async function fetchRange(lat, lon, startKey, endKey) {
  const base = { latitude: lat, longitude: lon, start_date: startKey, end_date: endKey, temperature_unit: "fahrenheit",
    wind_speed_unit: "mph", precipitation_unit: "inch", timezone: "auto", timeformat: "unixtime" };
  let r = await fetch(`${FORECAST}?${qs({ ...base, hourly: HOURLY.join(",") })}`).catch(() => null);
  if (!r || !r.ok) {
    r = await fetch(`https://archive-api.open-meteo.com/v1/archive?${qs({ ...base, hourly: HOURLY.filter((x) => x !== "precipitation_probability").join(",") })}`);
    if (!r.ok) throw new Error(`weather archive ${r.status}`);
  }
  return toRows(await r.json());
}
