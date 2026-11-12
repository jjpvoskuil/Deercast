// What goes on the map of one logged hunt (HuntMap.jsx) and on the tracking map (TrackMode.jsx): pure helpers.
import { CARDINALS, CARDINALS_8 } from "./geo.js";
import { deerText, groupSightings } from "./huntlog.js";

/** The "Deer seen" entry a shot was taken at (the shot form stores its deer text, e.g. "1 Buck"), or null. */
export function shotSighting(hunt, shot) {
  if (!hunt || !shot?.deer) return null;
  return groupSightings(hunt.sightings).find((g) => deerText(g.deer) === shot.deer) || null;
}

const bearingOf = (c) => (CARDINALS.includes(c) ? CARDINALS.indexOf(c) * 22.5 : CARDINALS_8.includes(c) ? CARDINALS_8.indexOf(c) * 45 : null);

/** Where the shot deer is thought to have gone: from the hit site (tracking hit pin → hit analysis → the sighting
 *  spot), in the direction it ran (hit analysis), else the way the sighting says it went. */
export function shotRun(shot, sighting = null, stand = null) {
  const pin = (shot.pins || []).find((p) => p.kind === "hit");
  const hit = pin ? [pin.lat, pin.lon] : shot.hit_lat != null ? [shot.hit_lat, shot.hit_lon]
    : sighting?.lat != null ? [sighting.lat, sighting.lon] : null;
  const ran = shot.input?.ran ?? shot.ran;
  let bearing = bearingOf(ran), dir = bearing == null ? null : ran, source = bearing == null ? null : "analysis";
  if (bearing == null && sighting && bearingOf(sighting.went_to) != null) {
    bearing = bearingOf(sighting.went_to); dir = sighting.went_to; source = "sighting";
  }
  const from = shot.from_lat != null ? [shot.from_lat, shot.from_lon] : stand;
  return { from, hit, hitSource: pin ? "pin" : shot.hit_lat != null ? "analysis" : hit ? "sighting" : null, bearing, dir, source };
}

/** Hour starts (ms) covering a sit, for the wind slider. */
export function sitHours(startMs, endMs) {
  const out = [];
  for (let t = Math.floor(startMs / 3600e3) * 3600e3; t < endMs; t += 3600e3) out.push(t);
  return out.length ? out : [Math.floor(startMs / 3600e3) * 3600e3];
}

/** The weather row for an hour (rows from weather.fetchRange; nearest within 90 min). */
export function rowAt(rows, ms) {
  let best = null;
  for (const r of rows || []) if (Math.abs(r.time - ms) <= 90 * 60e3 && (!best || Math.abs(r.time - ms) < Math.abs(best.time - ms))) best = r;
  return best;
}

/** Which hour the slider opens on: the first shot during the sit, else the first deer seen, else the start. */
export function startHourIdx(hours, shots = [], sightings = []) {
  const times = [...shots.map((x) => Date.parse(x.time_iso || String(x.time).replace(" ", "T"))), ...sightings.map((s) => Date.parse(s.time))].filter(Number.isFinite);
  const t = shots.length ? times[0] : times.length ? Math.min(...times) : null;
  if (t == null) return 0;
  const i = hours.findIndex((h) => t >= h && t < h + 3600e3);
  return i < 0 ? 0 : i;
}
