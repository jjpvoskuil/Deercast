// Tracking a hit deer over one or more trips: spots on the map (blood, beds, last blood, recovery) set from
// "where I am now" or picked on the map later, trip history, "where you left off", and the track map.
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import Icon from "./Icon.jsx";
import NumInput from "./NumInput.jsx";
import { CARDINALS_8, EARTH_R, YD } from "./lib/geo.js";
import { myLocation } from "./lib/places.js";

const SAT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const r6 = (x) => Math.round(x * 1e6) / 1e6;
export const yardsBetween = (a, b) => {
  const toR = (d) => (d * Math.PI) / 180, dLat = toR(b.lat - a.lat), dLon = toR(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round((2 * EARTH_R * Math.asin(Math.sqrt(h))) / YD);
};

export const MARK_KINDS = { blood: ["🩸", "Blood"], last: ["🚩", "Last blood"], bed: ["🛏️", "Bed"], lost: ["❓", "Lost the trail"], arrow: ["🏹", "Arrow / bolt"] };
/** Spots of a trip (older trips stored a single lat/lon = last blood). */
export const tripMarks = (t) => t.marks || (t.lat != null ? [{ kind: "last", lat: t.lat, lon: t.lon }] : []);
const pin = (emoji, big) => L.divIcon({ className: "", iconSize: [big ? 30 : 24, big ? 30 : 24], iconAnchor: [big ? 15 : 12, big ? 15 : 12], html: `<div class="emoji"${big ? ' style="font-size:24px"' : ""}>${emoji}</div>` });

// ---------------------------------------------------------------- a spot: where I am now, or picked on the map
/** Tap the satellite map to place a spot. `context` = other spots drawn for reference. */
function MapPicker({ center, value, context = [], onPick, onCancel }) {
  const el = useRef(null), map = useRef(null), mk = useRef(null);
  const [pt, setPt] = useState(value);
  useEffect(() => {
    const m = L.map(el.current, { zoomControl: true, attributionControl: false }).setView(value ? [value.lat, value.lon] : center, 18);
    L.tileLayer(SAT, { maxZoom: 21, maxNativeZoom: 19 }).addTo(m);
    for (const c of context) L.marker([c.lat, c.lon], { icon: pin(c.emoji), interactive: false, opacity: 0.85 }).addTo(m);
    m.on("click", (e) => setPt({ lat: r6(e.latlng.lat), lon: r6(e.latlng.lng) }));
    map.current = m;
    setTimeout(() => m.invalidateSize(), 0);
    return () => m.remove();
  }, []);
  useEffect(() => {
    if (!map.current) return;
    if (mk.current) mk.current.remove();
    mk.current = pt ? L.marker([pt.lat, pt.lon], { icon: pin("📍", true) }).addTo(map.current) : null;
  }, [pt]);
  return (
    <div className="picker-map">
      <div ref={el} className="rec-map" style={{ height: 300 }} />
      <p className="muted small">Tap the map where it was (best you can). Pinch to zoom.</p>
      <div className="btn-row">
        <button className="btn primary" disabled={!pt} onClick={() => onPick(pt)}>Use this spot</button>
        <button className="btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** A location field: 📍 where I am now · 🗺️ pick on the map · clear. */
export function PointField({ label, value, onChange, center, context }) {
  const [msg, setMsg] = useState(""), [picking, setPicking] = useState(false);
  const here = async () => {
    setMsg("Getting your location…");
    try { const p = await myLocation(); onChange({ lat: r6(p.lat), lon: r6(p.lon) }); setMsg(""); } catch (e) { setMsg(e.message); }
  };
  return (
    <div className="field"><span>{label}</span>
      {value && <span className="small">📍 Spot saved{value.lat != null ? ` (${value.lat.toFixed(5)}, ${value.lon.toFixed(5)})` : ""}</span>}
      {!picking && <div className="btn-row">
        <button className="btn sm" onClick={here}>📍 Where I am now</button>
        <button className="btn sm" onClick={() => setPicking(true)}>🗺️ Pick on map</button>
        {value && <button className="btn sm" onClick={() => onChange(null)}>Clear</button>}
      </div>}
      {msg && <span className="muted small">{msg}</span>}
      {picking && <MapPicker center={center} value={value} context={context} onCancel={() => setPicking(false)} onPick={(p) => { onChange(p); setPicking(false); }} />}
    </div>
  );
}

// ---------------------------------------------------------------- trips
const BLOOD_AMT = ["None", "Drops", "Steady", "Heavy"];
const BLOOD_LOOK = ["Bright red", "Bright red + bubbles", "Dark red", "Gut matter / food", "Watery / pinkish", "Mixed", "Not sure"];
const SIGN = ["Hair", "Bone chips", "Bed with blood", "Arrow / bolt", "Tracks only", "Deer jumped"];
const STOPPED = ["Got dark", "Lost the blood", "Jumped the deer — backed out", "Rain / weather", "Giving it time", "Found it"];
export const hm12 = (hm) => { if (!hm) return "?"; const [h, m] = hm.split(":").map(Number); return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); };
export const dayTxt = (d) => new Date(`${d}T12:00`).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
const tripHours = (t) => { if (!t.from || !t.to) return 0; const [a, b] = [t.from, t.to].map((x) => { const [h, m] = x.split(":").map(Number); return h * 60 + m; }); return ((b - a + 1440) % 1440) / 60; };
export const trackHours = (tracks = []) => tracks.reduce((n, t) => n + tripHours(t), 0);
export const tripText = (t) => [t.blood_amt && t.blood_amt !== "None" ? `${t.blood_amt.toLowerCase()} blood${t.blood_look && t.blood_look !== "Not sure" ? ` (${t.blood_look.toLowerCase()})` : ""}` : t.blood_amt === "None" ? "no blood" : "",
  (t.sign || []).join(", ").toLowerCase(), t.heading ? `heading ${t.heading}` : "", t.blood_yd ? `last blood ~${t.blood_yd} yd from hit` : "",
  t.stopped ? `stopped: ${t.stopped.toLowerCase()}` : "", t.helpers ? `with ${t.helpers}` : ""].filter(Boolean).join(" · ");

/** Trip history + add/edit a trip (what you found and every spot you marked). */
export function Tracks({ tracks, setTracks, defaultDate, center, context }) {
  const blank = () => ({ date: defaultDate, from: "", to: "", blood_amt: "", blood_look: "", sign: [], heading: "", blood_yd: null,
    marks: [], stopped: "", helpers: "", notes: "" });
  const [nw, setNw] = useState(null), [idx, setIdx] = useState(null), [kind, setKind] = useState(null);
  const set = (k) => (v) => setNw({ ...nw, [k]: v });
  const chips = (k, opts, multi) => (
    <div className="filter-row">{opts.map((o) => {
      const on = multi ? nw[k].includes(o) : nw[k] === o;
      return <button key={o} className={`fchip ${on ? "on" : ""}`} onClick={() => set(k)(multi ? (on ? nw[k].filter((x) => x !== o) : [...nw[k], o]) : on ? "" : o)}>{o}</button>;
    })}</div>
  );
  const done = () => {
    const rec = { ...nw }; delete rec.lat; delete rec.lon;
    const list = idx == null ? [...tracks, rec] : tracks.map((t, i) => (i === idx ? rec : t));
    setTracks(list.sort((a, b) => `${a.date}${a.from}`.localeCompare(`${b.date}${b.from}`))); setNw(null); setIdx(null); setKind(null);
  };
  const ctx = [...context, ...(nw ? nw.marks.map((m) => ({ ...m, emoji: MARK_KINDS[m.kind]?.[0] || "•" })) : [])];
  return (
    <div className="field"><span>Tracking trips {tracks.length > 0 && <>· {trackHours(tracks).toFixed(1)} h total</>}</span>
      {tracks.map((t, i) => (
        <button key={i} className="trip" onClick={() => { setNw({ ...blank(), ...t, marks: tripMarks(t) }); setIdx(i); }}>
          <b>Trip {i + 1} · {dayTxt(t.date)} {hm12(t.from)}–{hm12(t.to)}</b>
          {tripText(t) && <div className="small">{tripText(t)}</div>}
          {tripMarks(t).length > 0 && <div className="muted small">{tripMarks(t).map((m) => MARK_KINDS[m.kind]?.[0]).join(" ")} {tripMarks(t).length} spot{tripMarks(t).length === 1 ? "" : "s"} on the map</div>}
          {t.notes && <div className="muted small"><i>{t.notes}</i></div>}
        </button>
      ))}
      {nw ? (
        <div className="form trip-form">
          <div className="sub-h">{idx == null ? `Trip ${tracks.length + 1}` : `Trip ${idx + 1}`}</div>
          <div className="grid3">
            <label className="field"><span>Date</span><input type="date" value={nw.date} onChange={(e) => set("date")(e.target.value)} /></label>
            <label className="field"><span>From</span><input type="time" value={nw.from} onChange={(e) => set("from")(e.target.value)} /></label>
            <label className="field"><span>To</span><input type="time" value={nw.to} onChange={(e) => set("to")(e.target.value)} /></label>
          </div>
          <div className="field"><span>Blood amount</span>{chips("blood_amt", BLOOD_AMT)}</div>
          {nw.blood_amt && nw.blood_amt !== "None" && <div className="field"><span>Blood looked</span>{chips("blood_look", BLOOD_LOOK)}</div>}
          <div className="field"><span>Other sign</span>{chips("sign", SIGN, true)}</div>
          <div className="field"><span>Trail heading</span>{chips("heading", CARDINALS_8)}</div>
          <div className="field"><span>Spots on the map (blood, beds, last blood…)</span>
            {nw.marks.map((m, j) => (
              <div key={j} className="sighting"><div style={{ flex: 1 }}>{MARK_KINDS[m.kind]?.[0]} {MARK_KINDS[m.kind]?.[1]}</div>
                <button className="x" aria-label="Remove spot" onClick={() => set("marks")(nw.marks.filter((_, k) => k !== j))}><Icon name="x" size={18} /></button></div>
            ))}
            {!kind && <div className="filter-row">{Object.entries(MARK_KINDS).map(([k, [e, l]]) => <button key={k} className="fchip" onClick={() => setKind(k)}>+ {e} {l}</button>)}</div>}
            {kind && <div className="trip-form">
              <PointField label={`Where was the ${MARK_KINDS[kind][1].toLowerCase()}?`} value={null} center={center} context={ctx}
                onChange={(p) => { if (p) { setNw({ ...nw, marks: [...nw.marks, { kind, ...p }] }); setKind(null); } }} />
              <button className="link" onClick={() => setKind(null)}>Cancel</button></div>}
          </div>
          <label className="field"><span>About how far the trail went from the hit site (yd)</span><NumInput empty min={0} max={3000} value={nw.blood_yd} onChange={set("blood_yd")} /></label>
          <div className="field"><span>Why you stopped</span>{chips("stopped", STOPPED)}</div>
          <label className="field"><span>Who helped / dog (optional)</span><input value={nw.helpers} onChange={(e) => set("helpers")(e.target.value)} /></label>
          <label className="field"><span>Notes for next time (landmarks, flagging, what to check first)</span><textarea rows="2" value={nw.notes} onChange={(e) => set("notes")(e.target.value)} /></label>
          <div className="btn-row"><button className="btn primary" disabled={!nw.date} onClick={done}>{idx == null ? "Add trip" : "Update trip"}</button>
            {idx != null && <button className="btn" onClick={() => { setTracks(tracks.filter((_, j) => j !== idx)); setNw(null); setIdx(null); }}>Remove</button>}
            <button className="btn" onClick={() => { setNw(null); setIdx(null); setKind(null); }}>Cancel</button></div>
        </div>
      ) : <button className="btn primary wide" onClick={() => setNw(blank())}>+ Add a tracking trip{tracks.length ? " (picking it back up)" : ""}</button>}
      {tracks.length > 0 && !nw && <span className="muted small">Tap a trip to change it or add spots you forgot. Save below to keep changes.</span>}
    </div>
  );
}

/** "Where you left off" — the last trip's key facts + a walk-there link to its last spot. */
export function LeftOff({ tracks }) {
  const t = tracks[tracks.length - 1];
  if (!t) return null;
  const ms = tripMarks(t), last = ms.find((m) => m.kind === "last") || ms[ms.length - 1];
  return (
    <div className="confirm small"><b>Where you left off</b> — {dayTxt(t.date)} at {hm12(t.to)}{t.stopped ? ` (${t.stopped.toLowerCase()})` : ""}
      {tripText(t) && <div>{tripText(t)}</div>}
      {t.notes && <div><i>{t.notes}</i></div>}
      {last && <div className="btn-row" style={{ marginTop: 6 }}><a className="btn sm" href={`https://maps.apple.com/?daddr=${last.lat},${last.lon}&dirflg=w`} target="_blank" rel="noreferrer">📍 Walk to the {MARK_KINDS[last.kind]?.[1].toLowerCase() || "last spot"}</a></div>}
      <div className="muted small">{tracks.length} trip{tracks.length === 1 ? "" : "s"}, {trackHours(tracks).toFixed(1)} h so far.</div>
    </div>
  );
}

/** Satellite map of the whole track: stand, hit site, every trip's spots (joined in order), where it was found. */
export function TrackMap({ from, hit, tracks, found, active }) {
  const el = useRef(null), map = useRef(null), lg = useRef(null);
  useEffect(() => {
    const m = L.map(el.current, { zoomControl: true, attributionControl: false });
    L.tileLayer(SAT, { maxZoom: 21, maxNativeZoom: 19 }).addTo(m);
    lg.current = L.layerGroup().addTo(m); map.current = m;
    return () => m.remove();
  }, []);
  useEffect(() => { if (active && map.current) setTimeout(() => map.current.invalidateSize(), 0); }, [active]);
  const key = JSON.stringify([from, hit, tracks.map(tripMarks), found]);
  useEffect(() => {
    const g = lg.current; if (!g) return; g.clearLayers();
    const pts = [from, hit];
    L.circleMarker(from, { radius: 8, color: "#fff", weight: 2, fillColor: "#1e7bff", fillOpacity: 1 }).bindPopup("Stand / where you shot from").addTo(g);
    L.circleMarker(hit, { radius: 8, color: "#fff", weight: 2, fillColor: "#ff3b30", fillOpacity: 1 }).bindPopup("Hit site").addTo(g);
    const COL = ["#ffd60a", "#ff8c1a", "#52b788", "#3a86ff", "#e76f51"];
    let prev = hit;
    tracks.forEach((t, i) => {
      const ms = tripMarks(t); if (!ms.length) return;
      const line = [prev, ...ms.map((m) => [m.lat, m.lon])];
      L.polyline(line, { color: COL[i % COL.length], weight: 3, dashArray: "3 6" }).addTo(g);
      ms.forEach((m) => { L.marker([m.lat, m.lon], { icon: pin(MARK_KINDS[m.kind]?.[0] || "•") }).bindPopup(`Trip ${i + 1} (${dayTxt(t.date)}): ${MARK_KINDS[m.kind]?.[1] || "spot"}`).addTo(g); pts.push([m.lat, m.lon]); });
      prev = line[line.length - 1];
    });
    if (found) { L.marker([found.lat, found.lon], { icon: pin("🦌", true) }).bindPopup("Recovered here").addTo(g); pts.push([found.lat, found.lon]); }
    map.current.fitBounds(L.latLngBounds(pts).pad(0.25), { maxZoom: 19 });
  }, [key]);
  return (
    <>
      <div ref={el} className="rec-map" style={{ height: 260 }} />
      <p className="muted small">🔵 stand · 🔴 hit site · dotted line = each trip's spots in order (🩸 blood, 🚩 last blood, 🛏️ bed, ❓ lost, 🏹 arrow){found ? " · 🦌 recovered" : ""}.</p>
    </>
  );
}
