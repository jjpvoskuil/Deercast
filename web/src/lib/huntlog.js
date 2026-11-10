// Hunt log helpers — JavaScript copy of deercast/huntlog.py (+ the scoring of a sit). Parity test: huntlog.test.js.
import { CARDINALS, destination } from "./geo.js";
import { dateKey, offsetMin, parts } from "./model/tz.js";

export const KINDS = ["Buck", "Doe", "Fawn", "Unknown"];
/** Fawns can be split by sex (record: kind "Fawn" + fawn "doe" | "buck" | "unknown"). */
export const FAWN_LABEL = { doe: "Doe fawn", buck: "Button buck", unknown: "Fawn" };
export const kindLabel = (s) => (s.kind === "Fawn" && FAWN_LABEL[s.fawn] ? FAWN_LABEL[s.fawn] : s.kind);
export const ACTIVITIES = ["Feeding", "Walking / cruising", "Chasing", "Rubbing / scraping", "Bedded", "Running (spooked)",
  "At bait / feeder", "Other"];
export const LOC_FIELDS = ["dir", "dist_yd", "came_from", "went_to", "lat", "lon"];
/** Deer on a trail camera while you sit (source "camera"). They count toward `seen` (the forecast check — the cams are
 *  in the same area); a camera next to a stand also credits that stand (`near` = its "Stand: …" label) via hours[].at. */
export const isCamera = (s) => s?.source === "camera";

const pad = (n) => String(n).padStart(2, "0");
/** ISO time with the place's own UTC offset, like Python's isoformat(): 2026-10-27T15:17:00-05:00 */
export function isoLocal(ms, tz) {
  const p = parts(ms, tz), off = offsetMin(ms, tz), sign = off < 0 ? "-" : "+", a = Math.abs(off);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}
export const floorHour = (ms) => Math.floor(ms / 3600e3) * 3600e3; // hour boundaries are whole UTC hours for US zones

/** Split a sit into clock hours with the model score, minutes hunted and deer seen in each.
 *  With trail-cam sightings, `at` = deer per stand label (the sit's own stand + stands next to a camera). */
export function sessionHours(startMs, endMs, scored, sightings, tz, stand = null) {
  const hasCam = sightings.some(isCamera);
  const byTime = new Map(scored.map((r) => [r.time, r.score]));
  const out = [];
  for (let t = floorHour(startMs); t < endMs; t += 3600e3) {
    const a = Math.max(startMs, t), b = Math.min(endMs, t + 3600e3);
    const minutes = (b - a) / 60000;
    if (minutes <= 0) continue;
    const v = byTime.get(t);
    const score = v == null || Number.isNaN(v) ? null : Math.round(v * 10) / 10;
    const inHour = sightings.filter((s) => { const x = Date.parse(s.time); return x >= t && x < t + 3600e3; });
    const seen = inHour.reduce((n, s) => n + (+s.count || 1), 0);
    const row = { hour: isoLocal(t, tz), score, minutes: Math.round(minutes), seen };
    if (hasCam) {
      row.at = {};
      for (const s of inHour) { const k = isCamera(s) ? s.near : stand; if (k) row.at[k] = (row.at[k] || 0) + (+s.count || 1); }
    }
    out.push(row);
  }
  return out;
}

/** Map position of a sighting from the stand: compass direction (16-point) + distance in yards. */
export function locate(lat, lon, dir, distYd) {
  if (!dir || !distYd || !CARDINALS.includes(dir)) return null;
  const [a, b] = destination(lat, lon, CARDINALS.indexOf(dir) * 22.5, distYd * 0.9144);
  return [Math.round(a * 1e6) / 1e6, Math.round(b * 1e6) / 1e6];
}
export function withPosition(rec, anchor) {
  if (anchor) { const p = locate(anchor[0], anchor[1], rec.dir, rec.dist_yd); if (p) [rec.lat, rec.lon] = p; }
  return rec;
}

export function whereText(e) {
  const bits = [];
  if (e.dist_yd && e.dir) bits.push(`${Math.round(e.dist_yd)} yd ${e.dir} of stand`);
  else if (e.dir) bits.push(`${e.dir} of stand`);
  if (e.came_from) bits.push(`came from ${e.came_from}`);
  if (e.went_to) bits.push(`went ${e.went_to}`);
  return bits.join(" · ");
}

/** Records entered together (same `group`) as one entry, in time order; idx = positions in the original list. */
export function groupSightings(sightings) {
  const out = [], by = new Map();
  (sightings || []).forEach((s, i) => {
    const g = s.group || `_${i}`;
    if (!by.has(g)) {
      const e = { group: g, time: s.time, deer: [], activity: s.activity || "", bait: s.bait || "", notes: s.notes || "", idx: [],
        source: s.source || "stand", camera: s.camera || "" };
      for (const k of LOC_FIELDS) e[k] = s[k] ?? null;
      by.set(g, e); out.push(e);
    }
    by.get(g).deer.push([kindLabel(s), +s.count || 1]);
    by.get(g).idx.push(i);
  });
  return out.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
}

export function deerText(deer) {
  const order = { Buck: 0, Doe: 1, "Doe fawn": 2, "Button buck": 3, Fawn: 4, Unknown: 5 };
  return [...deer].sort((a, b) => (order[a[0]] ?? 9) - (order[b[0]] ?? 9))
    .map(([k, n]) => (k === "Unknown" ? `${n} unknown` : `${n} ${n === 1 ? k : k + "s"}`)).join(", ");
}

const rankAvg = (xs) => {
  const idx = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
};
const pearson = (a, b) => {
  const n = a.length, ma = a.reduce((s, x) => s + x, 0) / n, mb = b.reduce((s, x) => s + x, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa && sbb ? sab / Math.sqrt(saa * sbb) : NaN;
};
export const BANDS = ["0–2", "2–4", "4–6", "6–8", "8–10"];

/** Deer seen per hour by forecast-score band, rank correlation (Spearman) and a plain-English verdict. */
export function validation(hunts) {
  const rows = [];
  for (const h of hunts) for (const hr of h.hours || []) {
    if (hr.score == null || (hr.minutes || 0) < 10) continue;
    rows.push({ hunt: h.id, score: hr.score, minutes: hr.minutes, seen: hr.seen });
  }
  if (!rows.length) return { nHours: 0 };
  const bands = BANDS.map((band) => ({ band, hours: 0, seen: 0 }));
  for (const r of rows) {
    const i = r.score <= 2 ? 0 : r.score <= 4 ? 1 : r.score <= 6 ? 2 : r.score <= 8 ? 3 : 4;
    bands[i].hours += r.minutes / 60; bands[i].seen += r.seen;
  }
  bands.forEach((b) => { b.perHour = b.hours > 0 ? b.seen / b.hours : null; });
  const scores = rows.map((r) => r.score), rate = rows.map((r) => r.seen / (r.minutes / 60));
  const rho = rows.length >= 3 && new Set(scores).size > 1 ? pearson(rankAvg(scores), rankAvg(rate)) : NaN;
  const n = rows.length;
  let verdict;
  if (n < 15) verdict = `Only ${n} hunted hours logged — keep logging; ~30+ hours (10+ sits) before trusting the trend.`;
  else if (Number.isNaN(rho)) verdict = "Not enough variation in scores yet.";
  else if (rho >= 0.3) verdict = "The forecast is tracking your sightings well — higher scores are producing more deer.";
  else if (rho >= 0.1) verdict = "Weak positive relationship — the forecast helps a little. More data will sharpen it.";
  else if (rho > -0.1) verdict = "No clear relationship yet between scores and sightings at your stands.";
  else verdict = "Scores are running opposite to your sightings — the model needs tuning for your property.";
  return { nHours: n, nHunts: new Set(rows.map((r) => r.hunt)).size, bands, rho, verdict };
}

export const huntDay = (h, tz) => dateKey(Date.parse(h.start), tz);
