// Full-screen map of one logged hunt: wind cone(s) hour by hour, the deer you saw (with their trails), the shot
// deer (hit site + where you think it ran), tracking trails and pins, and the ground's stands & bait — each a layer
// you can switch on or off.
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import Icon from "./Icon.jsx";
import { BAIT, FEATURE } from "./MapScreen.jsx";
import { PIN_KINDS, normalizeTrack } from "./TrackMode.jsx";
import { CARDINALS, YD, degToCardinal, driftCone, scentCone } from "./lib/geo.js";
import { groupSightings } from "./lib/huntlog.js";
import { rowAt, shotRun, shotSighting, sitHours, startHourIdx } from "./lib/huntmap.js";
import { combine, slopeFrom, slopePoints, thermalPhase } from "./lib/terrain.js";
import { elevations, fetchRange } from "./lib/weather.js";
import { RUN_COLOR, TRIP_COLORS, drawShotRun, drawSighting, drawTrips } from "./mapdraw.js";

const SAT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const LAYERS = [["wind", "💨", "Wind"], ["deer", "🦌", "Deer seen"], ["shot", "🎯", "Shot deer"], ["tracks", "👣", "Tracking"],
  ["pins", "📍", "Pins"], ["sites", "🌲", "Stands & bait"]];
const LS = "deercast.huntmapLayers";
const emojiIcon = (e) => L.divIcon({ className: "", iconSize: [28, 28], iconAnchor: [14, 14], html: `<div class="emoji pin">${e}</div>` });

export default function HuntMap({ hunt, shots = [], stands = [], features = [], tz, onClose }) {
  const [on, setOn] = useState(() => {
    const all = { wind: true, deer: true, shot: true, tracks: true, pins: true, sites: true };
    try { return { ...all, ...JSON.parse(localStorage.getItem(LS) || "{}") }; } catch { return all; }
  });
  useEffect(() => { try { localStorage.setItem(LS, JSON.stringify(on)); } catch { /* ignore */ } }, [on]);
  const startMs = Date.parse(hunt.start), endMs = Date.parse(hunt.end);
  const st = stands.find((x) => `Stand: ${x.name}` === hunt.stand);
  const sit = hunt.lat != null ? [hunt.lat, hunt.lon] : st ? [st.lat, st.lon] : null; // where you sat
  const hours = useMemo(() => sitHours(startMs, endMs), [hunt.start, hunt.end]);
  const sightings = useMemo(() => groupSightings(hunt.sightings), [hunt]);
  const tracks = useMemo(() => shots.map((x) => normalizeTrack(x)), [shots]);
  const [idx, setIdx] = useState(() => startHourIdx(hours, shots, hunt.sightings || []));
  const fmtH = (ms) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: hours.length === 1 ? "2-digit" : undefined, timeZone: tz });

  // ---------------------------------------------------------------- weather for the sit (hourly wind) + slope for thermals
  const [rows, setRows] = useState(null);   // null = loading, [] = unavailable
  const [slope, setSlope] = useState(null);
  useEffect(() => {
    if (!sit) { setRows([]); return; }
    fetchRange(sit[0], sit[1], String(hunt.start).slice(0, 10), String(hunt.end).slice(0, 10)).then((r) => setRows(r.rows)).catch(() => setRows([]));
    elevations(slopePoints(sit[0], sit[1])).then((el) => setSlope(slopeFrom(el))).catch(() => setSlope(null));
  }, [hunt.id]);
  const wind = useMemo(() => {
    const t = hours[idx], r = rowAt(rows, t);
    if (r && r.wind_dir != null) return { dir: r.wind_dir, mph: r.wind_mph, gust: r.gust_mph, t, src: "hourly" };
    const w = hunt.weather;
    if (rows && w?.wind_from && CARDINALS.includes(w.wind_from)) return { dir: CARDINALS.indexOf(w.wind_from) * 22.5, mph: w.wind_mph, t, src: "log" };
    return null;
  }, [rows, idx, hours]);
  const drift = useMemo(() => {
    if (!wind || !slope) return null;
    const [phase, strength] = thermalPhase(sit[0], sit[1], new Date(wind.t + 30 * 60e3));
    return combine(wind.dir, wind.mph, slope[0], slope[1], phase, strength);
  }, [wind, slope]);

  // ---------------------------------------------------------------- map
  const el = useRef(null), map = useRef(null), lg = useRef({});
  useEffect(() => {
    const m = L.map(el.current, { zoomControl: false, attributionControl: false }).setView(sit || [37.3, -86.06], 17);
    L.tileLayer(SAT, { maxZoom: 21, maxNativeZoom: 19 }).addTo(m);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    for (const [k] of LAYERS) lg.current[k] = L.layerGroup();
    lg.current.you = L.layerGroup().addTo(m); // where you sat: always shown
    map.current = m;
    const t = setTimeout(() => m.invalidateSize(), 0);
    return () => { clearTimeout(t); m.remove(); };
  }, []);

  // draw everything once (wind redraws on its own); fit the view to all of it
  const counts = useRef({});
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const g = lg.current, all = sit ? [sit] : [];
    for (const k of ["you", "deer", "shot", "tracks", "pins", "sites"]) g[k].clearLayers();
    const c = { deer: 0, shot: 0, tracks: 0, pins: 0, sites: 0 };
    // you: where you sat
    if (sit) L.marker(sit, { icon: L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13], html: '<div class="stand-pin">S</div>' }) })
      .bindPopup(esc(`You sat here · ${hunt.stand.replace("Stand: ", "")}`)).addTo(g.you);
    for (const e of sightings) { const p = drawSighting(g.deer, e, tz); if (p.length) { c.deer++; all.push(...p); } }
    tracks.forEach((x) => {
      if (x.status !== "hit") return;
      const run = shotRun(x, shotSighting(hunt, x), sit);
      const pinHit = x.pins.some((p) => p.kind === "hit");
      const p = drawShotRun(g.shot, run, { label: x.deer || "Shot deer", hitMarker: !pinHit });
      if (p.length) { c.shot++; all.push(...p); }
      const t = drawTrips(g.tracks, x.trips);
      if (t.length) { c.tracks += x.trips.length; all.push(...t); }
      for (const pin of x.pins) {
        const [e, label] = PIN_KINDS[pin.kind] || ["📌", "Pin"];
        const det = Object.values(pin.details || {}).flat().filter(Boolean).join(", ");
        L.marker([pin.lat, pin.lon], { icon: emojiIcon(e) }).bindPopup(esc(`${label}${det ? ` — ${det}` : ""}${pin.notes ? ` · ${pin.notes}` : ""}`)).addTo(g.pins);
        c.pins++; all.push([pin.lat, pin.lon]);
      }
      if (x.recovery?.lat != null) { L.marker([x.recovery.lat, x.recovery.lon], { icon: emojiIcon("🦌") }).bindPopup("Recovered here").addTo(g.pins); c.pins++; all.push([x.recovery.lat, x.recovery.lon]); }
    });
    for (const s of stands) {
      if (`Stand: ${s.name}` === hunt.stand) continue;
      L.marker([s.lat, s.lon], { icon: L.divIcon({ className: "", iconSize: [22, 22], iconAnchor: [11, 11], html: '<div class="stand-pin sm">S</div>' }) }).bindPopup(esc(s.name)).addTo(g.sites);
      c.sites++;
    }
    for (const f of features) {
      const [col, e, label] = FEATURE[f.type] || ["#999", "•", f.type];
      if (BAIT.has(f.type) || f.type === "camera") L.marker([f.lat, f.lon], { icon: emojiIcon(e) }).bindPopup(esc(`${label}${f.name ? ` · ${f.name}` : ""}`)).addTo(g.sites);
      else L.circle([f.lat, f.lon], { radius: (f.radius_yd || 40) * YD, color: col, weight: 2, fillColor: col, fillOpacity: 0.2 }).bindPopup(esc(`${e} ${label}${f.name ? ` · ${f.name}` : ""}`)).addTo(g.sites);
      c.sites++;
    }
    counts.current = c;
    if (all.length > 1) map.current.fitBounds(L.latLngBounds(all).pad(0.25), { maxZoom: 19 });
    setDrawn((n) => n + 1);
  }, [hunt, tracks, stands, features]);

  // wind cone at your spot for the chosen hour (bent by thermals when the slope is known)
  useEffect(() => {
    const g = lg.current.wind; if (!g) return; g.clearLayers();
    if (!wind || !sit) return;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#E8682A";
    for (const [frac, op] of [[1, 0.12], [0.66, 0.18], [0.33, 0.28]]) {
      const poly = drift ? driftCone(sit[0], sit[1], drift.toBearing, drift.mph, drift.extraHalf, frac) : scentCone(sit[0], sit[1], wind.dir, wind.mph, frac);
      L.polygon(poly, { color: accent, weight: 1, opacity: 0.5, fillColor: accent, fillOpacity: op, interactive: false }).addTo(g);
    }
  }, [wind, drift]);

  // layer switches
  useEffect(() => {
    const m = map.current; if (!m) return;
    for (const [k] of LAYERS) { const layer = lg.current[k]; if (on[k]) layer.addTo(m); else layer.remove(); }
  }, [on, drawn]);

  const c = counts.current;
  const show = LAYERS.filter(([k]) => k === "wind" || c[k] > 0);
  const day = new Date(startMs).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric", timeZone: tz });
  return (
    <div className="track-mode">
      <div ref={el} className="track-map" />
      <div className="track-top">
        <button className="btn sm" onClick={onClose} aria-label="Close map"><Icon name="x" size={18} /> Close</button>
        <div className="track-title">
          <b>{day} · {hunt.stand.replace("Stand: ", "")}</b>
          <span className="muted small">{fmtH(startMs)}–{new Date(endMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz })}</span>
        </div>
      </div>
      <div className="layer-chips" role="group" aria-label="Map layers">
        {show.map(([k, e, label]) => (
          <button key={k} className={`layer-chip ${on[k] ? "on" : ""}`} aria-pressed={!!on[k]} onClick={() => setOn({ ...on, [k]: !on[k] })}>
            <span className="e">{e}</span>{label}</button>
        ))}
      </div>
      <div className="track-panel hunt-map-panel">
        {on.wind && (
          <>
            <div className="hour-row">
              {hours.length > 1 && <input type="range" min={0} max={hours.length - 1} value={idx} onChange={(e) => setIdx(+e.target.value)} aria-label="Hour of the sit" />}
              <b>{fmtH(hours[idx])}</b>
            </div>
            <div className="small">{rows === null ? "Loading the wind for this sit…"
              : wind ? <>Wind from <b>{degToCardinal(wind.dir)}</b> {Math.round(wind.mph)} mph{wind.gust ? `, gusts ${Math.round(wind.gust)}` : ""}
                {wind.src === "log" ? " (at the start of the sit — hourly wind unavailable)" : ""}{drift ? " · cone bent by thermals" : ""}</>
              : "Wind for this sit isn't available."}</div>
          </>
        )}
        <div className="muted small">
          {c.deer > 0 && <>● deer seen: dashed = came from, arrow = went. </>}
          {c.shot > 0 && <><span className="sw" style={{ background: RUN_COLOR }} /> where the shot deer ran (hit analysis, else "went toward"). </>}
          {c.tracks > 0 && <><span className="sw" style={{ background: TRIP_COLORS[0] }} /> tracking trips (dashed = drawn by hand). </>}
          Tap anything for details.
        </div>
      </div>
    </div>
  );
}
