// Terrain slope + thermal drift — JavaScript port of deercast/terrain.py (keep in step; parity test in geo.test.js).
// Morning sun warms slopes → scent pulled UPHILL; cooling slopes late day/night → scent drains DOWNHILL;
// around sunrise and the hour before sunset it switches and swirls. Thermals are gentle (~0.5–3 mph).
import { getPosition } from "suncalc";
import { destination, degToCardinal } from "./geo.js";

export const SPACING_M = 40;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function slopePoints(lat, lon, d = SPACING_M) {
  return [[lat, lon], destination(lat, lon, 0, d), destination(lat, lon, 180, d),
    destination(lat, lon, 90, d), destination(lat, lon, 270, d)];
}

/** [slope degrees, bearing pointing uphill] from [center, N, S, E, W] elevations (m). */
export function slopeFrom(e5, d = SPACING_M) {
  const [, n, s, e, w] = e5;
  const gy = (n - s) / (2 * d), gx = (e - w) / (2 * d);
  const g = Math.hypot(gx, gy);
  return [deg(Math.atan(g)), g > 1e-6 ? (deg(Math.atan2(gx, gy)) + 360) % 360 : 0];
}

/** Slope + uphill bearing per cell of a north-up grid E[r][c] (row 0 = north), spacing d metres. */
export function gridSlopes(E, d) {
  const R = E.length, C = E[0].length;
  const grad = (a, i, n) => (i === 0 ? a(1) - a(0) : i === n - 1 ? a(n - 1) - a(n - 2) : (a(i + 1) - a(i - 1)) / 2) / d;
  const out = [];
  for (let r = 0; r < R; r++) {
    const row = [];
    for (let c = 0; c < C; c++) {
      const gy = -grad((i) => E[i][c], r, R);
      const gx = grad((i) => E[r][i], c, C);
      row.push([deg(Math.atan(Math.hypot(gx, gy))), (deg(Math.atan2(gx, gy)) + 360) % 360]);
    }
    out.push(row);
  }
  return out;
}

// suncalc ≥2 returns degrees (refraction-corrected), like PyEphem in astro.py.
export const sunAltitudeDeg = (lat, lon, when) => getPosition(when, lat, lon).altitude;

/** ['up' | 'down' | 'switching', strength 0–1] from sun altitude and morning vs evening. */
export function thermalPhase(lat, lon, when) {
  const alt = sunAltitudeDeg(lat, lon, when);
  const rising = sunAltitudeDeg(lat, lon, new Date(when.getTime() + 3600e3)) > alt;
  if (rising) {
    if (alt < 5) return ["down", alt < 0 ? 0.8 : 0.5];
    if (alt < 15) return ["switching", 0];
    return ["up", Math.min(1, 0.5 + (alt - 15) / 20)];
  }
  if (alt > 15) return ["up", Math.min(1, 0.4 + (alt - 15) / 25)];
  if (alt > 8) return ["switching", 0];
  return ["down", alt < 0 ? 1 : 0.6];
}

export const thermalMph = (slope, strength) => (slope < 1.5 ? 0 : strength * Math.min(3, 0.45 * slope));

/** Resulting scent drift: bearing it travels toward, speed, and how much thermals matter. */
export function combine(windFrom, windMph, slope, uphill, phase, strength) {
  const to = rad((windFrom + 180) % 360);
  let vx = windMph * Math.sin(to), vy = windMph * Math.cos(to);
  const t = phase === "up" || phase === "down" ? thermalMph(slope, strength) : 0;
  const tDir = phase === "up" ? uphill : (uphill + 180) % 360;
  if (t) { vx += t * Math.sin(rad(tDir)); vy += t * Math.cos(rad(tDir)); }
  const mph = Math.hypot(vx, vy);
  const bearing = mph > 1e-6 ? (deg(Math.atan2(vx, vy)) + 360) % 360 : (windFrom + 180) % 360;
  const influence = t ? t / (t + Math.max(windMph, 0.5)) : 0;
  const switching = phase === "switching" && slope >= 1.5;
  return { toBearing: bearing, mph, thermalMph: t, thermalTo: t ? tDir : null, phase, slope, uphill, influence,
    extraHalf: 15 * influence + (switching ? 12 : 0), switching };
}

export function describe(c) {
  if (c.slope < 1.5) return "flat ground — wind only";
  if (c.switching) return `${c.slope.toFixed(0)}° slope, thermals switching — expect swirling scent`;
  if (!c.thermalMph) return `${c.slope.toFixed(0)}° slope`;
  const way = c.phase === "up" ? "uphill" : "downhill";
  const level = c.influence > 0.5 ? "thermals dominate" : c.influence > 0.2 ? "thermals bend it" : "wind dominates";
  return `${c.slope.toFixed(0)}° slope · thermals pulling ${way} to ${degToCardinal(c.thermalTo)} (${c.thermalMph.toFixed(1)} mph) — ${level}`;
}
