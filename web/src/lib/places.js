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
