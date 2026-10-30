// Scent-drift geometry — JavaScript port of deercast/scent.py (keep the two in step; parity test in geo.test.js).

export const EARTH_R = 6371000;
export const YD = 0.9144;
export const CARDINALS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const CARDINALS_8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function degToCardinal(d, points = 16) {
  const names = points === 16 ? CARDINALS : CARDINALS_8;
  const step = 360 / names.length;
  return names[Math.floor((((d % 360) + 360) % 360 + step / 2) / step) % names.length];
}

/** Point reached travelling distM metres along bearing (great circle). Returns [lat, lon]. */
export function destination(lat, lon, bearingDeg, distM) {
  const br = rad(bearingDeg), p1 = rad(lat), l1 = rad(lon), d = distM / EARTH_R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br));
  const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [deg(p2), ((deg(l2) + 540) % 360) - 180];
}

/** [length in yards, half-angle in degrees]. Light wind → short wide cone; steady wind → long narrow cone. */
export function coneParams(mph) {
  const length = Math.max(150, Math.min(150 + 30 * mph, 700));
  const half = mph < 4 ? 40 : mph < 10 ? 25 : 17;
  return [length, half];
}

/** Cone polygon toward a drift bearing (wind + thermals); extraHalf widens it when thermals swirl. */
export function driftCone(lat, lon, toBearing, mph, extraHalf = 0, frac = 1, steps = 16) {
  const [lengthYd, half0] = coneParams(mph);
  const half = Math.min(75, half0 + extraHalf);
  const dist = lengthYd * YD * frac;
  const pts = [[lat, lon]];
  for (let i = 0; i <= steps; i++) pts.push(destination(lat, lon, toBearing - half + (2 * half * i) / steps, dist));
  pts.push([lat, lon]);
  return pts;
}

/** Downwind cone from wind direction (meteorological: wind blows FROM windFromDeg). */
export function scentCone(lat, lon, windFromDeg, mph, frac = 1, steps = 16) {
  const [lengthYd, half] = coneParams(mph);
  const dist = lengthYd * YD * frac;
  const down = (windFromDeg + 180) % 360;
  const pts = [[lat, lon]];
  for (let i = 0; i <= steps; i++) pts.push(destination(lat, lon, down - half + (2 * half * i) / steps, dist));
  pts.push([lat, lon]);
  return pts;
}

export const angleDiff = (a, b) => Math.abs(((((a - b + 180) % 360) + 360) % 360) - 180);

/** true/false if the wind is within ±22.5° of one of the stand's good winds; null if none set. */
export function windOkForStand(windFromDeg, goodWinds) {
  if (!goodWinds || !goodWinds.length) return null;
  const dirs = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
  return goodWinds.some((w) => w in dirs && angleDiff(windFromDeg, dirs[w]) <= 22.5);
}
