// Rank stands for a morning or evening sit — JavaScript copy of deercast/beststand.py (keep in step; parity test).
import { angleDiff, degToCardinal } from "../geo.js";
import { combine, thermalPhase } from "../terrain.js";

const DIRS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
export const AM_END_HOUR = 11, PM_START_HOUR = 14;

export const sessionHours = (dayRows, session) =>
  dayRows.filter((r) => r.legal && (session === "Morning" ? r.hour < AM_END_HOUR : r.hour >= PM_START_HOUR));

export function scentOk(stand, windFrom, driftTo) {
  const goods = (stand.good_winds || []).filter((g) => g in DIRS).map((g) => DIRS[g]);
  if (!goods.length) return null;
  if (driftTo == null) return goods.some((g) => angleDiff(windFrom, g) <= 22.5);
  return goods.some((g) => angleDiff(driftTo, (g + 180) % 360) <= 30);
}

/** [deer seen, hours hunted] at a stand for morning or evening sits. `hourOf` gives an ISO hour's local hour. */
export function historyRates(hunts, label, session, hourOf) {
  let seen = 0, hours = 0;
  for (const h of hunts) {
    if (h.stand !== label) continue;
    for (const hr of h.hours || []) {
      if ((session === "Morning") !== (hourOf(hr.hour) < 12)) continue;
      hours += (hr.minutes || 0) / 60;
      seen += hr.seen || 0;
    }
  }
  return [seen, hours];
}

/** Hour of day of an ISO timestamp as written (its own UTC offset = the hunt's local time, like pandas). */
export const isoHour = (iso) => +String(iso).slice(11, 13);

export function rank(stands, dayRows, session, hunts, slopes = {}, hourOf = isoHour) {
  const hrs = sessionHours(dayRows, session);
  if (!hrs.length || !stands.length) return [];
  let totSeen = 0, totHours = 0;
  for (const s of stands) { const [a, b] = historyRates(hunts, `Stand: ${s.name}`, session, hourOf); totSeen += a; totHours += b; }
  const K = 4.0;
  const prior = (totSeen + 1.0 * K) / (totHours + K);
  const out = stands.map((s) => {
    const [slope, up] = slopes[s.id] || [0, 0];
    const oks = [], notes = [];
    for (const r of hrs) {
      const [phase, strength] = thermalPhase(s.lat, s.lon, new Date(r.time));
      const d = combine(r.wind_dir, r.wind_mph, slope, up, phase, strength);
      oks.push(scentOk(s, r.wind_dir, slope >= 1.5 ? d.toBearing : null));
      if (d.influence > 0.35 && d.thermalTo != null) notes.push([phase === "down" ? "downhill" : "uphill", d.thermalTo]);
    }
    const known = oks.filter((o) => o !== null);
    const good = known.filter(Boolean).length;
    const fit = known.length ? good / known.length : 0.5;
    const tops = hrs.map((r) => r.score).sort((a, b) => b - a).slice(0, Math.min(3, hrs.length));
    const top = tops.reduce((a, b) => a + b, 0) / tops.length;
    const [seen, hours] = historyRates(hunts, `Stand: ${s.name}`, session, hourOf);
    const rate = (seen + prior * K) / (hours + K);
    const hist = prior > 0 ? Math.max(0.7, Math.min(1.4, rate / prior)) : 1.0;
    const score = top * (0.35 + 0.65 * fit) * hist;
    const reasons = [known.length ? `scent fits ${good}/${known.length} legal hours` : "no good winds set for this stand"];
    if (notes.length) { const [way, to] = notes[Math.floor(notes.length / 2)]; reasons.push(`thermals pull scent ${way} to ${degToCardinal(to)}`); }
    if (hours >= 1) reasons.push(`${seen.toFixed(0)} deer in ${hours.toFixed(1)} logged ${session.toLowerCase()} hours`);
    return { stand: s, score, activity: top, fit, fitHours: good, nHours: known.length, history: hist, reasons };
  });
  return out.sort((a, b) => b.score - a.score);
}
