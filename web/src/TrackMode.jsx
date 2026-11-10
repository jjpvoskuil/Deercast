// Full-screen tracking map for one shot. Live: records your walking path by GPS (screen kept awake) and drops pins
// where you stand. Editing/recreating later: draw the path roughly and place pins by tapping the map.
// Every action saves the shot record right away (onSave), so you can close the app and pick it up later.
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import Icon from "./Icon.jsx";
import NumInput from "./NumInput.jsx";
import { newId, nowIso } from "./lib/db.js";
import { ORGANS } from "./lib/shot.js";
import { EARTH_R, YD } from "./lib/geo.js";

const SAT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const r6 = (x) => Math.round(x * 1e6) / 1e6;
export const meters = (a, b) => {
  const toR = (d) => (d * Math.PI) / 180, dLat = toR(b[0] - a[0]), dLon = toR(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a[0])) * Math.cos(toR(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.sqrt(h));
};
const yds = (a, b) => Math.round(meters(a, b) / YD);
const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "?");
const day = (iso) => (iso ? new Date(iso).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }) : "");
const pathYards = (pts) => Math.round(pts.reduce((n, p, i) => (i ? n + meters(pts[i - 1], p) : 0), 0) / YD);

export const PIN_KINDS = {
  hit: ["🎯", "Hit site"], blood: ["🩸", "Blood"], trail_start: ["🟢", "Blood trail start"], trail_end: ["🔴", "Blood trail end"],
  arrow: ["🏹", "Arrow / bolt"], bed: ["🛏️", "Bed"], lost: ["❓", "Lost the trail"], other: ["📌", "Other"],
};
const PIN_ORDER = ["hit", "blood", "trail_start", "trail_end", "arrow", "bed", "lost", "other"];
// quick details per pin kind (chips); every pin also has notes
const DETAILS = {
  hit: [["found", "Found at the hit site", ["Blood", "Hair", "Arrow", "Bone chips", "Nothing yet"], true],
    ["hair", "Hair color", ["Brown (side)", "White (belly / brisket)", "Long dark (back)", "Grey"]]],
  blood: [["amount", "Amount", ["Drops", "Steady", "Heavy", "Pooled"]],
    ["look", "Looks", ["Bright red", "Bright + bubbles", "Dark red", "With gut / food", "Watery / pink"]],
    ["height", "Where", ["On the ground", "On brush, knee high", "Both sides of trail"]]],
  trail_start: [["amount", "Blood", ["Drops", "Steady", "Heavy"]]],
  trail_end: [["why", "Why it ended", ["Blood stopped", "Lost it in leaves", "Hit water / creek", "Into thick cover", "Found the deer"]]],
  arrow: [["state", "Arrow", ["Pass-through", "Broken piece", "Whole arrow"]],
    ["blood", "On the arrow", ["Bright red", "Bubbles (lung)", "Dark red (liver)", "Gut matter / smell", "Fat / tallow", "Clean"]],
    ["head", "Broadhead", ["Intact", "Damaged", "Missing"]]],
  bed: [["with", "Bed", ["Blood in bed", "No blood"]], ["how", "Deer", ["Jumped it", "Already gone"]]],
  lost: [], other: [],
};
const STOPS = ["Got dark", "Backing out — let it lie", "Jumped the deer", "Rain / weather", "Need help / a dog", "Other"];
const pinIcon = (emoji, sel) => L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 15],
  html: `<div class="emoji pin${sel ? " sel" : ""}">${emoji}</div>` });

/** Bring older records (trips with date/from/to + marks) into the trips/pins shape. */
export function normalizeTrack(s) {
  if (s.trips) return { ...s, pins: s.pins || [] };
  const KIND = { blood: "blood", last: "trail_end", bed: "bed", lost: "lost", arrow: "arrow" };
  const trips = [], pins = [];
  for (const t of s.tracking || []) {
    const id = newId(), at = (hm) => (t.date && hm ? new Date(`${t.date}T${hm}`).toISOString() : null);
    trips.push({ id, start: at(t.from), end: at(t.to) || at(t.from), path: [], drawn: [], stopped: t.stopped || "", helpers: t.helpers || "",
      notes: [t.notes, t.blood_amt && `${t.blood_amt} blood ${t.blood_look || ""}`.trim(), (t.sign || []).join(", "), t.heading && `heading ${t.heading}`].filter(Boolean).join(" · ") });
    for (const m of t.marks || (t.lat != null ? [{ kind: "last", lat: t.lat, lon: t.lon }] : []))
      pins.push({ id: newId(), kind: KIND[m.kind] || "other", lat: m.lat, lon: m.lon, time: at(t.to), trip: id, details: {}, notes: "" });
  }
  if (s.hit_fix) pins.unshift({ id: newId(), kind: "hit", lat: s.hit_fix.lat, lon: s.hit_fix.lon, time: null, trip: trips[0]?.id || null, details: {}, notes: "" });
  let recovery = s.recovery || null;
  if (!recovery && s.result === "recovered" && s.found_lat != null)
    recovery = { time: s.found_date && s.found_time ? new Date(`${s.found_date}T${s.found_time}`).toISOString() : null, lat: s.found_lat, lon: s.found_lon,
      organs_actual: s.organs_actual || [], notes: s.found_notes || "" };
  return { ...s, trips, pins, recovery };
}

export default function TrackMode({ shot: initial, center, live: startLive, onSave, onClose, onAnalysis }) {
  const [s, setS] = useState(() => normalizeTrack(initial));
  const sRef = useRef(s); sRef.current = s;
  const [live, setLive] = useState(startLive);          // GPS recording on
  const [me, setMe] = useState(null);                    // [lat, lon, accuracy]
  const [gpsMsg, setGpsMsg] = useState("");
  const [mode, setMode] = useState(startLive ? "gps" : "tap"); // where new pins go: "gps" = where I am, "tap" = tap the map
  const [arm, setArm] = useState(null);                  // pin kind waiting for a map tap
  const [draw, setDraw] = useState(false);
  const [sel, setSel] = useState(null);                  // pin id being edited
  const [sheet, setSheet] = useState(null);              // "stop" | "found" | "off" | "log" | "trip"
  const [crumbs, setCrumbs] = useState(true);            // breadcrumb path on/off (pause for a break without ending the trip)
  const crumbsRef = useRef(true); crumbsRef.current = crumbs;
  const [mini, setMini] = useState(false);               // panel pulled down → more map
  const drag = useRef(null);
  const [fd, setFd] = useState(null);                    // recovery draft while the Found sheet is open
  const openTrip = s.trips.find((t) => !t.end) || null;
  const tripNo = (id) => s.trips.findIndex((t) => t.id === id) + 1;

  // ---------------------------------------------------------------- saving
  const timer = useRef(null);
  const persist = async (next, now = true) => {
    setS(next); sRef.current = next;
    clearTimeout(timer.current);
    const go = async () => { try { await onSave({ ...sRef.current, updated: nowIso() }); } catch { /* toast shown by onSave */ } };
    if (now) await go(); else timer.current = setTimeout(go, 15000); // GPS points: batch saves
  };
  useEffect(() => () => { clearTimeout(timer.current); }, []);
  const close = async () => { clearTimeout(timer.current); await onSave({ ...sRef.current, updated: nowIso() }); onClose(); };

  // a live session needs an open trip
  const startTrip = (when = nowIso()) => persist({ ...sRef.current, result: "tracking", trips: [...sRef.current.trips, { id: newId(), start: when, end: null, path: [], drawn: [], stopped: "", notes: "" }] });
  useEffect(() => { if (startLive && !openTrip && !s.recovery && s.result !== "not_found") setSheet("start"); }, []);

  // ---------------------------------------------------------------- GPS + keep the screen on
  useEffect(() => {
    if (!live) return;
    if (!navigator.geolocation) { setGpsMsg("Location isn't available on this device"); return; }
    let lock = null;
    navigator.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
    const id = navigator.geolocation.watchPosition((p) => {
      const pt = [r6(p.coords.latitude), r6(p.coords.longitude)], acc = p.coords.accuracy;
      setMe([...pt, acc]); setGpsMsg("");
      const cur = sRef.current, t = cur.trips.find((x) => !x.end);
      if (!t || acc > 35 || !crumbsRef.current) return;
      const last = t.path[t.path.length - 1];
      if (last && meters(last, pt) < 4) return;
      const trips = cur.trips.map((x) => (x.id === t.id ? { ...x, path: [...x.path, [...pt, Date.now()]] } : x));
      persist({ ...cur, trips }, false);
    }, (e) => setGpsMsg(e.code === 1 ? "Location permission is off — allow it for Safari to record your path" : "Looking for GPS…"),
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    const wake = () => {
      if (document.visibilityState === "visible") navigator.wakeLock?.request("screen").then((l) => { lock = l; }).catch(() => {});
      else { clearTimeout(timer.current); onSave({ ...sRef.current, updated: nowIso() }).catch(() => {}); } // phone locked / app switched: save the path so far now
    };
    document.addEventListener("visibilitychange", wake);
    return () => { navigator.geolocation.clearWatch(id); lock?.release?.().catch(() => {}); document.removeEventListener("visibilitychange", wake); };
  }, [live]);

  // ---------------------------------------------------------------- pins
  const dropPin = (kind, at) => {
    const cur = sRef.current;
    const pos = at || (me ? [me[0], me[1]] : null);
    if (!pos) { setArm(kind); return; }                  // no GPS fix yet → tap the map
    const t = cur.trips.find((x) => !x.end) || cur.trips[cur.trips.length - 1];
    const p = { id: newId(), kind, lat: pos[0], lon: pos[1], time: t && !live && t.end ? t.start : nowIso(), trip: t?.id || null, details: {}, notes: "" };
    persist({ ...cur, pins: [...cur.pins, p] });
    setArm(null); setSel(p.id);
  };
  const onPinButton = (kind) => (mode === "gps" && me ? dropPin(kind) : setArm(kind));
  const updPin = (id, patch) => persist({ ...sRef.current, pins: sRef.current.pins.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const delPin = (id) => { persist({ ...sRef.current, pins: sRef.current.pins.filter((p) => p.id !== id) }); setSel(null); };

  // ---------------------------------------------------------------- map
  const el = useRef(null), map = useRef(null), lg = useRef(null), meLayer = useRef(null), fitted = useRef(false);
  const followRef = useRef(startLive); // live: keep the map on you until you drag it
  useEffect(() => {
    const m = L.map(el.current, { zoomControl: false, attributionControl: false }).setView(center, 18);
    L.tileLayer(SAT, { maxZoom: 21, maxNativeZoom: 19 }).addTo(m);
    L.control.zoom({ position: "topright" }).addTo(m);
    lg.current = L.layerGroup().addTo(m); meLayer.current = L.layerGroup().addTo(m);
    m.on("dragstart", () => { followRef.current = false; });
    map.current = m;
    setTimeout(() => m.invalidateSize(), 0);
    return () => m.remove();
  }, []);
  // taps: armed pin → place it; draw mode → add a path point
  const tapRef = useRef(null);
  tapRef.current = (ll) => {
    const pt = [r6(ll.lat), r6(ll.lng)];
    if (arm === "found") { setFd((f) => ({ ...f, lat: pt[0], lon: pt[1] })); setArm(null); setSheet("found"); return; }
    if (arm) return dropPin(arm, pt);
    if (draw) {
      const cur = sRef.current;
      const t = cur.trips.find((x) => !x.end) || cur.trips[cur.trips.length - 1];
      if (!t) { // no trip yet: start trip 1 at the shot time (times can be fixed in the Log)
        const at = cur.time_iso || nowIso();
        persist({ ...cur, trips: [{ id: newId(), start: at, end: at, path: [], drawn: [pt], stopped: "", notes: "" }] });
        return;
      }
      persist({ ...cur, trips: cur.trips.map((x) => (x.id === t.id ? { ...x, drawn: [...(x.drawn || []), pt] } : x)) });
    }
  };
  useEffect(() => { const m = map.current; const f = (e) => tapRef.current(e.latlng); m.on("click", f); return () => m.off("click", f); }, []);
  const COLORS = ["#ffd60a", "#ff8c1a", "#52b788", "#3a86ff", "#e76f51", "#c77dff"];
  useEffect(() => {
    const g = lg.current; if (!g) return; g.clearLayers();
    const all = [center];
    L.marker(center, { icon: L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="stand-pin">S</div>' }), interactive: false }).addTo(g);
    s.trips.forEach((t, i) => {
      const col = COLORS[i % COLORS.length];
      const pts = t.path.map((p) => [p[0], p[1]]);
      if (pts.length > 1) L.polyline(pts, { color: col, weight: 4, opacity: 0.9, interactive: false }).addTo(g);
      if ((t.drawn || []).length > 1) L.polyline(t.drawn, { color: col, weight: 4, opacity: 0.9, dashArray: "8 8", interactive: false }).addTo(g);
      for (const p of (t.drawn || []).length === 1 ? t.drawn : []) L.circleMarker(p, { radius: 4, color: col, interactive: false }).addTo(g);
      all.push(...pts, ...(t.drawn || []));
    });
    for (const p of s.pins) {
      L.marker([p.lat, p.lon], { icon: pinIcon(PIN_KINDS[p.kind]?.[0] || "📌", p.id === sel) }).on("click", () => setSel(p.id)).addTo(g);
      all.push([p.lat, p.lon]);
    }
    if (fd?.lat != null && sheet === "found") L.marker([fd.lat, fd.lon], { icon: pinIcon("🦌", true) }).addTo(g);
    if (s.recovery?.lat != null) { L.marker([s.recovery.lat, s.recovery.lon], { icon: pinIcon("🦌") }).bindPopup("Recovered here").addTo(g); all.push([s.recovery.lat, s.recovery.lon]); }
    if (!fitted.current && all.length > 1) { map.current.fitBounds(L.latLngBounds(all).pad(0.3), { maxZoom: 19 }); fitted.current = true; }
  }, [s, sel, fd, sheet]);
  useEffect(() => {
    const g = meLayer.current; if (!g) return; g.clearLayers();
    if (me) { L.circle([me[0], me[1]], { radius: me[2], color: "#4da3ff", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(g);
      L.circleMarker([me[0], me[1]], { radius: 7, color: "#fff", weight: 3, fillColor: "#0a84ff", fillOpacity: 1, interactive: false }).addTo(g);
      if (followRef.current && live) map.current.panTo([me[0], me[1]], { animate: true }); }
  }, [me]);
  useEffect(() => { setTimeout(() => map.current?.invalidateSize(), 220); }, [mini]);
  const handle = {
    onPointerDown: (e) => { drag.current = e.clientY; e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ } },
    onPointerUp: (e) => {
      const dy = drag.current == null ? 0 : e.clientY - drag.current; drag.current = null;
      if (dy > 25) setMini(true); else if (dy < -25) setMini(false); else setMini(!mini);
    },
  };
  const follow = () => { followRef.current = true; if (me) map.current.setView([me[0], me[1]], Math.max(map.current.getZoom(), 18)); };

  // ---------------------------------------------------------------- ending a trip / the track
  const endTrip = (patch, extra = {}) => {
    const cur = sRef.current, t = cur.trips.find((x) => !x.end);
    const trips = t ? cur.trips.map((x) => (x.id === t.id ? { ...x, end: nowIso(), ...patch } : x)) : cur.trips;
    return persist({ ...cur, trips, ...extra });
  };
  const selPin = s.pins.find((p) => p.id === sel);
  const walked = openTrip ? pathYards(openTrip.path.map((p) => [p[0], p[1]])) : 0;
  const lastPin = s.pins[s.pins.length - 1];
  const hitPin = s.pins.find((p) => p.kind === "hit");

  return (
    <div className="track-mode">
      <div ref={el} className="track-map" />
      <div className="track-top">
        <button className="btn sm" onClick={close} aria-label="Close map"><Icon name="x" size={18} /> Close</button>
        <div className="track-title">
          <b>{s.recovery ? "Recovered 🦌" : s.result === "not_found" ? "Track ended — not found" : openTrip ? `Tracking · trip ${tripNo(openTrip.id)}` : "Track paused"}</b>
          <span className="muted small">{live ? (me ? `${crumbs && openTrip ? "● Recording" : "Paused"} · ${walked} yd · ±${Math.round(me[2])} m` : gpsMsg || "Finding GPS…") : "Editing — tap the map to place things"}</span>
        </div>
        {live && openTrip && <button className={`btn sm ${crumbs ? "" : "primary"}`} onClick={() => setCrumbs(!crumbs)}>{crumbs ? "Pause" : "Resume"}</button>}
        <button className="btn sm" onClick={() => setSheet(sheet === "log" ? null : "log")}>Log</button>
      </div>
      {live && <button className="fab track-me" aria-label="Center on me" onClick={follow}><Icon name="locate" /></button>}
      {(arm || draw) && <div className="track-hint">{arm ? <>Tap the map where {arm === "found" ? "the deer lay" : `the ${PIN_KINDS[arm][1].toLowerCase()} was`}. <button className="link" onClick={() => setArm(null)}>Cancel</button></>
        : <>Tap along the way you walked{s.trips.length ? ` (trip ${s.trips.length})` : ""} — each tap adds a point. <button className="link" onClick={() => { const cur = sRef.current, t = cur.trips.find((x) => !x.end) || cur.trips[cur.trips.length - 1];
          if (t) persist({ ...cur, trips: cur.trips.map((x) => (x.id === t.id ? { ...x, drawn: (x.drawn || []).slice(0, -1) } : x)) }); }}>Undo</button> · <button className="link" onClick={() => setDraw(false)}>Done</button></>}</div>}

      <div className={`track-panel ${mini ? "mini" : ""}`}>
        <div className="track-handle" {...handle} role="button" aria-label={mini ? "Pull up the panel" : "Pull down the panel"}><span className="grab" /></div>
        {mini ? (
          selPin || sheet ? <button className="mini-label" onClick={() => setMini(false)}>{selPin ? `${PIN_KINDS[selPin.kind]?.[0]} ${PIN_KINDS[selPin.kind]?.[1]} — pull up to edit` : "Pull up to finish"}</button>
            : <div className="pin-row">{PIN_ORDER.map((k) => <button key={k} className={`pin-mini ${arm === k ? "on" : ""}`} aria-label={PIN_KINDS[k][1]} onClick={() => onPinButton(k)}>{PIN_KINDS[k][0]}</button>)}</div>
        ) : selPin ? (
          <PinSheet pin={selPin} onChange={(patch) => updPin(selPin.id, patch)} onDelete={() => delPin(selPin.id)} onDone={() => setSel(null)} live={live} />
        ) : sheet === "start" ? (
          <StartSheet n={s.trips.length + 1} onCancel={() => setSheet(null)}
            onStart={async (when) => { await startTrip(when); setSheet(null); setLive(true); setMode("gps"); setCrumbs(true); }} />
        ) : sheet === "stop" ? (
          <StopSheet onCancel={() => setSheet(null)} onStop={async (stops, notes, end) => { await endTrip({ stopped: stops.join(", "), stops, notes, end }); setSheet(null); setLive(false); }} />
        ) : sheet === "off" ? (
          <OffSheet onCancel={() => setSheet(null)} onOff={async (notes, yd, end) => { await endTrip({ stopped: "Called it off", notes, ...(openTrip ? { end } : {}) }, { result: "not_found", found_yd: yd }); setSheet(null); setLive(false); }}
            farthest={hitPin ? Math.max(0, ...s.pins.map((p) => yds([hitPin.lat, hitPin.lon], [p.lat, p.lon]))) : null} />
        ) : sheet === "found" ? (
          <FoundSheet r={fd} setR={setFd} me={me} lastPin={lastPin} onCancel={() => setSheet(null)} onTapMap={() => { setSheet(null); setArm("found"); }}
            onSave={async (rec) => { await endTrip({ stopped: "Found it" }, { recovery: rec, result: "recovered", found_yd: hitPin && rec.lat != null ? yds([hitPin.lat, hitPin.lon], [rec.lat, rec.lon]) : s.found_yd ?? null }); setSheet(null); setLive(false); }} />
        ) : sheet === "log" ? (
          <LogSheet s={s} onPin={(p) => { setSheet(null); setSel(p.id); map.current.setView([p.lat, p.lon], 19); }} onClose={() => setSheet(null)}
            onTrip={(id, patch) => persist({ ...sRef.current, trips: sRef.current.trips.map((t) => (t.id === id ? { ...t, ...patch } : t)) })}
            onDelTrip={(id) => persist({ ...sRef.current, trips: sRef.current.trips.filter((t) => t.id !== id), pins: sRef.current.pins.filter((p) => p.trip !== id) })} />
        ) : (
          <>
            <div className="pin-grid">
              {PIN_ORDER.map((k) => (
                <button key={k} className={`pin-btn ${arm === k ? "on" : ""}`} onClick={() => onPinButton(k)}>
                  <span className="e">{PIN_KINDS[k][0]}</span><span>{PIN_KINDS[k][1]}</span></button>
              ))}
            </div>
            <div className="track-tools">
              <div className="seg small-seg">
                <button className={mode === "gps" ? "on" : ""} onClick={() => setMode("gps")} disabled={!me}>Pin where I am</button>
                <button className={mode === "tap" ? "on" : ""} onClick={() => setMode("tap")}>Pin by tapping map</button>
              </div>
              <button className={`btn sm ${draw ? "primary" : ""}`} onClick={() => { setDraw(!draw); setArm(null); }}>✏️ Draw path</button>
            </div>
            {s.recovery || s.result === "not_found" ? (
              <div className="btn-row">
                <button className="btn" onClick={() => setSheet("log")}>See the whole track</button>
                {s.recovery && <button className="btn" onClick={() => { setFd(blankRecovery(s.recovery)); setSheet("found"); }}>Edit recovery</button>}
                {s.result === "not_found" && <button className="btn" onClick={() => persist({ ...sRef.current, result: "tracking" })}>Re-open track</button>}
              </div>
            ) : openTrip ? (
              <div className="track-actions">
                <button className="btn" onClick={() => setSheet("stop")}>⏸ Stop for now</button>
                <button className="btn primary" onClick={() => { setFd(blankRecovery(s.recovery)); setSheet("found"); }}>🦌 Found it</button>
                <button className="btn" onClick={() => setSheet("off")}>✖ Call it off</button>
              </div>
            ) : (
              <div className="track-actions">
                <button className="btn primary" onClick={() => setSheet("start")}>▶ Pick up the track</button>
                <button className="btn" onClick={() => setSheet("trip")}>+ Add a past trip</button>
                <button className="btn" onClick={() => { setFd(blankRecovery(s.recovery)); setSheet("found"); }}>🦌 Found it</button>
                <button className="btn" onClick={() => setSheet("off")}>✖ Called it off</button>
              </div>
            )}
            {sheet === "trip" && <PastTrip onCancel={() => setSheet(null)} onAdd={(start, end, stopped, notes) => {
              persist({ ...sRef.current, trips: [...sRef.current.trips, { id: newId(), start, end, path: [], drawn: [], stopped, notes }] }); setSheet(null); setDraw(true);
            }} />}
            {onAnalysis && <button className="link small" onClick={onAnalysis}>Hit analysis (where you hit it → wait time, search map) ›</button>}
          </>
        )}
      </div>
    </div>
  );
  // eslint-disable-next-line no-unreachable
}


function Chips({ opts, value, onChange, multi }) {
  return (
    <div className="filter-row">{opts.map((o) => {
      const on = multi ? (value || []).includes(o) : value === o;
      return <button key={o} className={`fchip ${on ? "on" : ""}`} onClick={() => onChange(multi ? (on ? value.filter((x) => x !== o) : [...(value || []), o]) : on ? null : o)}>{o}</button>;
    })}</div>
  );
}

function PinSheet({ pin, onChange, onDelete, onDone, live }) {
  const [notes, setNotes] = useState(pin.notes || "");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setNotes(pin.notes || ""), [pin.id]);
  const hm = pin.time ? new Date(pin.time).toTimeString().slice(0, 5) : "";
  return (
    <div className="pin-sheet">
      <div className="row-head"><b className="h2">{PIN_KINDS[pin.kind]?.[0]} {PIN_KINDS[pin.kind]?.[1]}</b><span className="muted small">saved {clock(pin.time)}</span></div>
      {(DETAILS[pin.kind] || []).map(([k, label, opts, multi]) => (
        <div key={k} className="field"><span>{label}</span><Chips opts={opts} multi={multi} value={pin.details?.[k] ?? (multi ? [] : null)} onChange={(v) => onChange({ details: { ...pin.details, [k]: v } })} /></div>
      ))}
      {!live && <label className="field"><span>Time (about)</span><input type="time" value={hm} onChange={(e) => {
        if (!e.target.value || !pin.time) return; const d = new Date(pin.time); const [h, m] = e.target.value.split(":").map(Number); d.setHours(h, m, 0, 0); onChange({ time: d.toISOString() }); }} /></label>}
      <label className="field"><span>Notes</span><input value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (pin.notes || "") && onChange({ notes })} placeholder="flagging, landmark, what you saw" /></label>
      <div className="btn-row">
        <button className="btn primary" onClick={() => { if (notes !== (pin.notes || "")) onChange({ notes }); onDone(); }}>Done</button>
        {confirm ? <button className="btn danger" onClick={onDelete}>Delete pin</button> : <button className="btn" onClick={() => setConfirm(true)}>Delete</button>}
      </div>
      <p className="muted small">Drag the map to look around; tap another pin to edit it.</p>
    </div>
  );
}

/** Now, or a date + time you enter (when you're logging it after the fact). */
function WhenField({ label, value, onChange }) {
  const [manual, setManual] = useState(false);
  const p = (n) => String(n).padStart(2, "0");
  const d = new Date(value || Date.now());
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  const put = (dd, tt) => { if (dd && tt) onChange(new Date(`${dd}T${tt}`).toISOString()); };
  return (
    <div className="field"><span>{label}</span>
      <div className="seg small-seg">
        <button className={!manual ? "on" : ""} onClick={() => { setManual(false); onChange(null); }}>Now</button>
        <button className={manual ? "on" : ""} onClick={() => { setManual(true); onChange(d.toISOString()); }}>Enter date & time</button>
      </div>
      {manual && <div className="grid2">
        <label className="field half"><span>Date</span><input type="date" value={day} onChange={(e) => put(e.target.value, hm)} /></label>
        <label className="field half"><span>Time</span><input type="time" value={hm} onChange={(e) => put(day, e.target.value)} /></label>
      </div>}
    </div>
  );
}

function StartSheet({ n, onStart, onCancel }) {
  const [when, setWhen] = useState(null);
  return (
    <div className="pin-sheet">
      <b className="h2">▶ Trip {n}{n > 1 ? " — picking up the track" : " — start tracking"}</b>
      <WhenField label="Started" value={when} onChange={setWhen} />
      <p className="muted small">Your path records by GPS while this map is open on screen.</p>
      <div className="btn-row"><button className="btn primary" onClick={() => onStart(when || nowIso())}>Start trip {n}</button><button className="btn" onClick={onCancel}>Not yet</button></div>
    </div>
  );
}

function StopSheet({ onStop, onCancel }) {
  const [why, setWhy] = useState([]), [notes, setNotes] = useState(""), [when, setWhen] = useState(null);
  return (
    <div className="pin-sheet">
      <b className="h2">⏸ Stop for now</b>
      <p className="muted small">Ends this trip. The track stays open — pick it up from the Hunt Log.</p>
      <div className="field"><span>Why (pick any)</span><Chips multi opts={STOPS} value={why} onChange={setWhy} /></div>
      <WhenField label="Stopped" value={when} onChange={setWhen} />
      <label className="field"><span>Notes for next time (where to start, what to check first)</span><textarea rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="btn-row"><button className="btn primary" onClick={() => onStop(why, notes, when || nowIso())}>Stop & save</button><button className="btn" onClick={onCancel}>Keep tracking</button></div>
    </div>
  );
}

function OffSheet({ onOff, onCancel, farthest }) {
  const [notes, setNotes] = useState(""), [yd, setYd] = useState(farthest || null), [when, setWhen] = useState(null);
  return (
    <div className="pin-sheet">
      <b className="h2">✖ Call it off</b>
      <p className="muted small">Ends the track as not found. You can re-open it later if you find the deer.</p>
      <WhenField label="Called it off" value={when} onChange={setWhen} />
      <label className="field"><span>Farthest blood from the hit site (yd)</span><NumInput empty min={0} max={5000} value={yd} onChange={setYd} /></label>
      <label className="field"><span>Notes</span><textarea rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <div className="btn-row"><button className="btn danger" onClick={() => onOff(notes, yd, when || nowIso())}>Call it off</button><button className="btn" onClick={onCancel}>Keep tracking</button></div>
    </div>
  );
}

const SEX = ["Buck", "Doe", "Button buck", "Other"];
export const blankRecovery = (rec) => ({ time: nowIso(), lat: null, lon: null, sex: "Buck", points: null, weight_lb: null, organs_actual: [], entry_exit: "", notes: "", ...(rec || {}) });
function FoundSheet({ r, setR, me, lastPin, onSave, onCancel, onTapMap }) {
  const set = (k) => (v) => setR({ ...r, [k]: v });
  const hm = new Date(r.time || Date.now()).toTimeString().slice(0, 5);
  return (
    <div className="pin-sheet">
      <b className="h2">🦌 Found it</b>
      <div className="field"><span>Where it lay</span>
        <div className="btn-row">
          <button className={`btn sm ${r.lat != null && me && r.lat === me[0] ? "primary" : ""}`} disabled={!me} onClick={() => setR({ ...r, lat: me[0], lon: me[1] })}>📍 Where I am</button>
          <button className="btn sm" onClick={onTapMap}>🗺️ Tap on map</button>
          {lastPin && <button className="btn sm" onClick={() => setR({ ...r, lat: lastPin.lat, lon: lastPin.lon })}>At the last pin</button>}
        </div>
        <span className="muted small">{r.lat != null ? "📍 Spot saved — shown as 🦌 on the map." : "Pick one so the map shows where it lay."}</span></div>
      <label className="field"><span>Time found</span><input type="time" value={hm} onChange={(e) => { if (!e.target.value) return; const d = new Date(r.time || Date.now()); const [h, m] = e.target.value.split(":").map(Number); d.setHours(h, m, 0, 0); set("time")(d.toISOString()); }} /></label>
      <div className="field"><span>Deer</span><Chips opts={SEX} value={r.sex} onChange={set("sex")} /></div>
      <div className="grid2">
        {r.sex === "Buck" && <label className="field half"><span>Points</span><NumInput empty min={0} max={40} value={r.points} onChange={set("points")} /></label>}
        <label className="field half"><span>Weight (lb, est.)</span><NumInput empty min={0} max={400} value={r.weight_lb} onChange={set("weight_lb")} /></label>
      </div>
      <div className="field"><span>What it actually hit</span><Chips multi opts={ORGANS.map((o) => o.label)} value={r.organs_actual} onChange={set("organs_actual")} /></div>
      <label className="field"><span>Entry / exit</span><input value={r.entry_exit} onChange={(e) => set("entry_exit")(e.target.value)} placeholder="e.g. in behind left shoulder, out low right" /></label>
      <label className="field"><span>Notes</span><textarea rows="2" value={r.notes} onChange={(e) => set("notes")(e.target.value)} /></label>
      <div className="btn-row"><button className="btn primary" onClick={() => onSave(r)}>Save recovery</button><button className="btn" onClick={onCancel}>Back</button></div>
    </div>
  );
}

function PastTrip({ onAdd, onCancel }) {
  const today = new Date(); const d0 = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const [d, setD] = useState(d0), [a, setA] = useState(""), [b, setB] = useState(""), [why, setWhy] = useState([]), [notes, setNotes] = useState("");
  const iso = (hm) => new Date(`${d}T${hm || "00:00"}`).toISOString();
  return (
    <div className="pin-sheet">
      <b className="h2">+ Add a past trip</b>
      <div className="grid3">
        <label className="field"><span>Date</span><input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
        <label className="field"><span>From</span><input type="time" value={a} onChange={(e) => setA(e.target.value)} /></label>
        <label className="field"><span>To</span><input type="time" value={b} onChange={(e) => setB(e.target.value)} /></label>
      </div>
      <div className="field"><span>Why you stopped (pick any)</span><Chips multi opts={STOPS} value={why} onChange={setWhy} /></div>
      <label className="field"><span>Notes</span><input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <p className="muted small">After adding, draw the path you walked and tap pins onto the map.</p>
      <div className="btn-row"><button className="btn primary" disabled={!d || !a} onClick={() => onAdd(iso(a), iso(b || a), why.join(", "), notes)}>Add trip, then draw it</button><button className="btn" onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function LogSheet({ s, onPin, onTrip, onDelTrip, onClose }) {
  const [del, setDel] = useState(null);
  return (
    <div className="pin-sheet log-sheet">
      <div className="row-head"><b className="h2">Track log</b><button className="btn sm" onClick={onClose}>Back to map</button></div>
      <div className="small">🎯 Shot {s.time_iso ? `${day(s.time_iso)} ${clock(s.time_iso)}` : s.time}{s.distance_yd ? ` · ${s.distance_yd} yd` : ""}{s.outcome && s.outcome !== "Hit — spot not marked" ? ` · ${s.outcome}` : ""}</div>
      {s.trips.map((t, i) => {
        const pins = s.pins.filter((p) => p.trip === t.id);
        const walked = pathYards(t.path.map((p) => [p[0], p[1]])) || pathYards(t.drawn || []);
        return (
          <div key={t.id} className="log-trip">
            <div className="row-head"><b>Trip {i + 1} · {day(t.start)} {clock(t.start)}–{t.end ? clock(t.end) : "now"}</b>
              {del === t.id ? <button className="btn sm danger" onClick={() => { onDelTrip(t.id); setDel(null); }}>Delete trip?</button>
                : <button className="x" aria-label="Delete trip" onClick={() => setDel(t.id)}><Icon name="trash" size={16} /></button>}</div>
            {walked > 0 && <div className="muted small">{t.path.length > 1 ? "Walked" : "Drawn path"} ~{walked} yd</div>}
            {pins.map((p) => (
              <button key={p.id} className="log-pin" onClick={() => onPin(p)}>{PIN_KINDS[p.kind]?.[0]} {clock(p.time)} {PIN_KINDS[p.kind]?.[1]}
                {Object.values(p.details || {}).flat().filter(Boolean).length > 0 && <span className="muted"> — {Object.values(p.details).flat().filter(Boolean).join(", ")}</span>}
                {p.notes && <span className="muted"> · {p.notes}</span>}</button>
            ))}
            {t.stopped && <div className="small">⏸ {t.stopped}{t.notes ? ` — ${t.notes}` : ""}</div>}
            {!t.stopped && t.notes && <div className="small muted">{t.notes}</div>}
            {t.end && <TripTimes t={t} onChange={(patch) => onTrip(t.id, patch)} />}
            {t.end && <label className="field"><span>Trip notes</span><input defaultValue={t.notes} onBlur={(e) => e.target.value !== t.notes && onTrip(t.id, { notes: e.target.value })} /></label>}
          </div>
        );
      })}
      {s.pins.filter((p) => !p.trip).map((p) => <button key={p.id} className="log-pin" onClick={() => onPin(p)}>{PIN_KINDS[p.kind]?.[0]} {PIN_KINDS[p.kind]?.[1]}</button>)}
      {s.recovery && <div className="small">🦌 Recovered {day(s.recovery.time)} {clock(s.recovery.time)} · {s.recovery.sex}{s.recovery.points ? ` ${s.recovery.points} pts` : ""}{s.found_yd ? ` · ${s.found_yd} yd from hit` : ""}
        {(s.recovery.organs_actual || []).length > 0 && <> · hit {s.recovery.organs_actual.join(", ").toLowerCase()}</>}</div>}
      {s.result === "not_found" && <div className="small">✖ Not found{s.found_yd ? ` · blood to ${s.found_yd} yd` : ""}</div>}
    </div>
  );
}

/** Fix a finished trip's date and times (for trips recreated from memory). */
function TripTimes({ t, onChange }) {
  const loc = (iso) => { const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return [`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, `${p(d.getHours())}:${p(d.getMinutes())}`]; };
  const [d0, a0] = loc(t.start), [, b0] = loc(t.end);
  const put = (d, a, b) => { const s = new Date(`${d}T${a}`), e = new Date(`${d}T${b}`); if (e < s) e.setDate(e.getDate() + 1); onChange({ start: s.toISOString(), end: e.toISOString() }); };
  return (
    <div className="grid3">
      <label className="field"><span>Date</span><input type="date" defaultValue={d0} onBlur={(e) => e.target.value && put(e.target.value, a0, b0)} /></label>
      <label className="field"><span>From</span><input type="time" defaultValue={a0} onBlur={(e) => e.target.value && put(d0, e.target.value, b0)} /></label>
      <label className="field"><span>To</span><input type="time" defaultValue={b0} onBlur={(e) => e.target.value && put(d0, a0, e.target.value)} /></label>
    </div>
  );
}
