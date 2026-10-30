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
