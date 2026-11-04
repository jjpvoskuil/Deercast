// Sun & moon — JavaScript counterpart of deercast/astro.py (PyEphem), via suncalc. Times are UTC ms.
import { getMoonIllumination, getMoonTimes, getPosition, getTimes } from "suncalc";
import { addDays, midnight, offsetMin } from "./tz.js";

const RAD = Math.PI / 180;
// suncalc returns apparent (refracted) altitude; astro.py uses PyEphem with pressure=0, i.e. geometric. Undo it.
const refr = (hRad) => { const h = Math.max(0, hRad); return 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179)); };
/** Geometric sun altitude in degrees (matches astro.sun_altitude_deg). */
export function sunAltitudeDeg(lat, lon, when) {
  const app = getPosition(when, lat, lon).altitude * RAD;
  let h = app;
  for (let i = 0; i < 4; i++) h = app - refr(h);
  return h / RAD;
}

export function moonPhase(when) {
  const m = getMoonIllumination(when);
  const illum = m.fraction, waxing = m.phase < 0.5;
  let name;
  if (illum < 0.02) name = "New Moon";
  else if (illum > 0.98) name = "Full Moon";
  else if (illum < 0.35) name = waxing ? "Waxing Crescent" : "Waning Crescent";
  else if (illum < 0.65) name = waxing ? "First Quarter" : "Last Quarter";
  else name = waxing ? "Waxing Gibbous" : "Waning Gibbous";
  return { illum, waxing, name };
}

/** Per local date: sunrise, sunset, moon phase, solunar majors (moon over/underfoot) and minors (moonrise/set). */
export function dailyAstro(lat, lon, keys, tz) {
  const out = {};
  for (const key of keys) {
    const t0 = midnight(key, tz), t1 = midnight(addDays(key, 1), tz);
    const off = offsetMin(t0 + 12 * 3600e3, tz);
    const inDay = (d) => (d instanceof Date && !isNaN(d) && d.getTime() >= t0 && d.getTime() < t1 ? d.getTime() : null);
    const sun = getTimes(new Date(t0 + 12 * 3600e3), lat, lon, 0, off);
    const moon = getMoonTimes(new Date(t0 + 12 * 3600e3), lat, lon, off);
    const ph = moonPhase(new Date(t0 + 12 * 3600e3));
    out[key] = {
      sunrise: inDay(sun.sunrise), sunset: inDay(sun.sunset),
      moonIllum: ph.illum, moonWaxing: ph.waxing, moonName: ph.name,
      majors: [inDay(moon.transit), inDay(moon.lowerTransit)].filter((x) => x !== null),
      minors: [inDay(moon.rise), inDay(moon.set)].filter((x) => x !== null),
    };
  }
  return out;
}
