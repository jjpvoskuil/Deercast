// ZIP → place (zippopotam.us) and point → county/state (FCC Census Block API). Free, keyless, from the phone.
import REGS from "./regs/data.json";

export async function geocodeZip(zip) {
  const z = String(zip).trim();
  if (!/^\d{5}$/.test(z)) throw new Error("Enter a 5-digit ZIP code");
  const r = await fetch(`https://api.zippopotam.us/us/${z}`);
  if (!r.ok) throw new Error(`ZIP ${z} not found`);
  const p = (await r.json()).places[0];
  return { lat: +p.latitude, lon: +p.longitude, label: `${p["place name"]}, ${p["state abbreviation"]} ${z}`, state: p["state abbreviation"], zip: z };
}

/** JSONP: the Census geocoder doesn't allow ordinary cross-site requests, only a <script> callback. */
function jsonp(url, ms = 12000) {
  return new Promise((resolve, reject) => {
    const cb = `__dcGeo${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
    const s = document.createElement("script");
    const done = () => { clearTimeout(t); delete window[cb]; s.remove(); };
    const t = setTimeout(() => { done(); reject(new Error("Address lookup timed out")); }, ms);
    window[cb] = (d) => { done(); resolve(d); };
    s.onerror = () => { done(); reject(new Error("Address lookup failed")); };
    s.src = `${url}&callback=${cb}`;
    document.head.appendChild(s);
  });
}

/** A street address → point. US Census geocoder first (best for rural US addresses), then OpenStreetMap. */
export async function geocodeAddress(text) {
  const q = String(text).trim();
  if (q.length < 5) throw new Error("Enter a street address, city and state");
  try {
    const d = await jsonp(`https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?address=${encodeURIComponent(q)}&benchmark=Public_AR_Current&format=jsonp`);
    const m = d?.result?.addressMatches?.[0];
    if (m) return { lat: +m.coordinates.y, lon: +m.coordinates.x, label: m.matchedAddress, state: m.addressComponents?.state || null, zip: m.addressComponents?.zip || null, exact: true };
  } catch { /* fall through to OpenStreetMap */ }
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&countrycodes=us&limit=1&q=${encodeURIComponent(q)}`);
  const p = r.ok ? (await r.json())[0] : null;
  if (!p) throw new Error("Couldn't find that address — check the spelling, or add the city and state");
  const iso = p.address?.["ISO3166-2-lvl4"] || "";
  return { lat: +p.lat, lon: +p.lon, label: p.display_name.split(", ").slice(0, 4).join(", "), state: iso.startsWith("US-") ? iso.slice(3) : null,
    zip: p.address?.postcode || null, exact: ["house", "building", "residential", "address"].includes(p.addresstype) || !!p.address?.house_number };
}

/** "42101" → ZIP lookup; anything else → address lookup. */
export const geocodePlace = (text) => (/^\s*\d{5}\s*$/.test(String(text)) ? geocodeZip(String(text).trim()) : geocodeAddress(text));

const COUNTY_KEY = "deercast.county.v1";
/** {county, state} for a point; cached on the phone (counties don't move). */
export async function countyFor(lat, lon) {
  const k = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  let cache = {};
  try { cache = JSON.parse(localStorage.getItem(COUNTY_KEY)) || {}; } catch { /* none */ }
  if (cache[k]) return cache[k];
  const r = await fetch(`https://geo.fcc.gov/api/census/block/find?latitude=${lat}&longitude=${lon}&format=json&showall=false`);
  if (!r.ok) throw new Error(`county lookup ${r.status}`);
  const d = await r.json();
  let name = d.County?.name || "";
  for (const suf of [" County", " Parish", " Borough"]) if (name.endsWith(suf)) name = name.slice(0, -suf.length);
  const v = { county: name || null, state: d.State?.code || null };
  cache[k] = v;
  try { localStorage.setItem(COUNTY_KEY, JSON.stringify(cache)); } catch { /* ignore */ }
  return v;
}

/** The phone's location (asks permission). */
export const myLocation = () => new Promise((res, rej) => {
  if (!navigator.geolocation) return rej(new Error("Location isn't available on this device"));
  navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }),
    () => rej(new Error("Location permission was denied")), { enableHighAccuracy: true, timeout: 15000 });
});

export const REG_DATA = REGS;
const FIXES = { Mcclean: "McLean", Mclean: "McLean", Mccracken: "McCracken", Mccreary: "McCreary", LaRue: "Larue", Metcalf: "Metcalfe" };
export function normalizeCounty(name) {
  if (!name) return null;
  let n = name.replace(" County", "").trim();
  n = n.slice(0, 1).toUpperCase() + n.slice(1);
  return FIXES[n] || n;
}
