// Local-time helpers for an IANA time zone (the forecast location's), DST-safe, no libraries.
const fmts = new Map();
function fmt(tz) {
  if (!fmts.has(tz)) fmts.set(tz, new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  return fmts.get(tz);
}
/** {y, m, d, h, mi, s} of an instant (ms) in tz. */
export function parts(ms, tz) {
  const o = {};
  for (const p of fmt(tz).formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = +p.value;
  return { y: o.year, m: o.month, d: o.day, h: o.hour % 24, mi: o.minute, s: o.second };
}
export const offsetMin = (ms, tz) => { const p = parts(ms, tz); return (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / 60000; };
const pad = (n) => String(n).padStart(2, "0");
/** 'YYYY-MM-DD' local date of an instant. */
export const dateKey = (ms, tz) => { const p = parts(ms, tz); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
/** Instant (ms) of local midnight starting a 'YYYY-MM-DD' date. */
export function midnight(key, tz) {
  const [y, m, d] = key.split("-").map(Number);
  let t = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 3; i++) t = Date.UTC(y, m - 1, d) - offsetMin(t, tz) * 60000;
  return t;
}
export const addDays = (key, n) => { const [y, m, d] = key.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
/** Whole days between two date keys (b - a). */
export const daysBetween = (a, b) => { const p = (k) => { const [y, m, d] = k.split("-").map(Number); return Date.UTC(y, m - 1, d); }; return Math.round((p(b) - p(a)) / 864e5); };
