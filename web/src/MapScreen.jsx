import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { CARDINALS_8, degToCardinal, destination, driftCone, scentCone, windOkForStand, YD } from "./lib/geo.js";
import { combine, describe, gridSlopes, slopeFrom, slopePoints, thermalPhase } from "./lib/terrain.js";
import { currentWind, elevations, hourlyWind } from "./lib/weather.js";

const KIND_COLOR = { Buck: "#ff6b1a", Doe: "#ffd60a", Fawn: "#f5deb3", Unknown: "#c0c0c0" };
const FEATURE = {
  water: ["#3a86ff", "💧", "Water"], cover: ["#2d6a4f", "🌲", "Thick cover"], bedding: ["#ffb703", "🛏️", "Bedding area"],
  feeder: ["#f4a261", "🛢️", "Broadcast corn feeder"], corn_shelled: ["#e9c46a", "🌽", "Shelled corn pile"],
  corn_ear: ["#e9c46a", "🌽", "Ear corn pile"], food_other: ["#90be6d", "🍎", "Other food / plot"],
};
const BAIT = new Set(["feeder", "corn_shelled", "corn_ear", "food_other"]);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmtHour = (d) => d.toLocaleString([], { weekday: "short", hour: "numeric" });

function useStored(key, initial) {
  const [v, setV] = useState(() => { try { const s = localStorage.getItem(key); return s === null ? initial : JSON.parse(s); } catch { return initial; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }, [key, v]);
  return [v, setV];
}

/** Deer seen together (same `group`) shown as one entry. */
function groupSightings(hunts) {
  const out = [];
  for (const h of hunts) {
    const by = new Map();
    (h.sightings || []).forEach((s, i) => {
      if (s.lat == null) return;
      const k = s.group || `_${i}`;
      if (!by.has(k)) { by.set(k, { ...s, deer: [] }); out.push(by.get(k)); }
      by.get(k).deer.push([s.kind, s.count || 1]);
    });
  }
  return out;
}

export default function MapScreen({ ground, grounds, onGround, data, email, onSignOut, demo }) {
  const mapEl = useRef(null);
  const map = useRef(null);
  const layers = useRef({});
  const [center, setCenter] = useState(null);
  const [mode, setMode] = useState("live");
  const [hours, setHours] = useState([]);
  const [hourIdx, setHourIdx] = useState(0);
  const [live, setLive] = useState(null);
  const [windErr, setWindErr] = useState("");
  const [showCones, setShowCones] = useStored("deercast.cones", true);
  const [useThermals, setUseThermals] = useStored("deercast.thermals", true);
  const [showField, setShowField] = useStored("deercast.field", false);
  const [tapped, setTapped] = useState(null);
  const [drifts, setDrifts] = useState({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);

  const stands = data?.stands || [];
  const features = data?.features || [];
  const home = ground?.home || { lat: 37.3006, lon: -86.0608 };

  // ------------------------------------------------------------- map (created once, never rebuilt)
  useEffect(() => {
    const m = L.map(mapEl.current, { zoomControl: false, attributionControl: true, tap: true })
      .setView([home.lat, home.lon], 16);
    const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 21, maxNativeZoom: 19, attribution: "Esri, Maxar, Earthstar Geographics" }).addTo(m);
    const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 21, maxNativeZoom: 17, attribution: "OpenTopoMap (CC-BY-SA)" });
    const streets = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 21, maxNativeZoom: 19, attribution: "© OpenStreetMap" });
    const labels = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 21, maxNativeZoom: 19 });
    const g = (on = true) => { const lg = L.layerGroup(); if (on) lg.addTo(m); return lg; };
    layers.current = { field: g(), cones: g(), marks: g(), bait: g(), sightings: g(), stands: g(), tap: g(), me: g() };
    L.control.layers({ Satellite: sat, Topo: topo, Streets: streets },
      { Labels: labels, "Bait & food": layers.current.bait, "Water / cover / bedding": layers.current.marks,
        "Deer sightings": layers.current.sightings }, { position: "topleft", collapsed: true }).addTo(m);
    m.attributionControl.setPrefix(false);
    m.on("click", (e) => setTapped([e.latlng.lat, e.latlng.lng]));
    m.on("moveend", () => { const c = m.getCenter(); setCenter([c.lat, c.lng]); });
    m.on("locationfound", (e) => {
      layers.current.me.clearLayers();
      L.circle(e.latlng, { radius: e.accuracy, color: "#4da3ff", weight: 1, fillOpacity: 0.12, interactive: false }).addTo(layers.current.me);
      L.circleMarker(e.latlng, { radius: 7, color: "#fff", weight: 2, fillColor: "#1e7bff", fillOpacity: 1 }).addTo(layers.current.me);
    });
    map.current = m;
    setCenter([home.lat, home.lon]);
    return () => m.remove();
  }, []);

  // switching grounds flies to that ground's home
  useEffect(() => {
    if (map.current && ground?.home) { map.current.setView([ground.home.lat, ground.home.lon], 16); setTapped(null); }
  }, [ground?.id]);

  // ------------------------------------------------------------- wind
  const loadLive = async (force) => {
    try {
      setWindErr("");
      const c = map.current?.getCenter() || { lat: home.lat, lng: home.lon };
      const w = await currentWind(c.lat, c.lng, force);
      const now = new Date(); now.setMinutes(now.getMinutes() - (now.getMinutes() % 10), 0, 0);
      setLive({ ...w, when: now });
    } catch (e) { setWindErr("Wind unavailable — check signal"); }
  };
  useEffect(() => {
    loadLive();
    const t = setInterval(loadLive, 10 * 60e3);
    const vis = () => document.visibilityState === "visible" && loadLive();
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", vis); };
  }, [ground?.id]);
  useEffect(() => {
    if (mode !== "forecast" || hours.length) return;
    hourlyWind(home.lat, home.lon).then(setHours).catch(() => setWindErr("Forecast unavailable"));
  }, [mode]);

  const wind = useMemo(() => {
    if (mode === "forecast" && hours[hourIdx]) {
      const h = hours[hourIdx];
      return { mph: h.mph, dir: h.dir, gust: h.gust, when: h.time, label: `Forecast ${fmtHour(h.time)}` };
    }
    return live ? { ...live, label: "Live · updates every 10 min" } : null;
  }, [mode, hours, hourIdx, live]);

  // ------------------------------------------------------------- thermal drift per stand + tapped point
  useEffect(() => {
    let stale = false;
    const pts = stands.map((s) => [s.id, s.lat, s.lon]).concat(tapped ? [["_tap", ...tapped]] : []);
    if (!wind || !useThermals || !pts.length) { setDrifts({}); return; }
    (async () => {
      try {
        const sample = pts.flatMap(([, a, b]) => slopePoints(a, b));
        const el = await elevations(sample);
        const [phase, strength] = thermalPhase(pts[0][1], pts[0][2], wind.when);
        const out = {};
        pts.forEach(([id], i) => {
          const [slope, up] = slopeFrom(el.slice(5 * i, 5 * i + 5));
          out[id] = combine(wind.dir, wind.mph, slope, up, phase, strength);
        });
        if (!stale) setDrifts(out);
      } catch { if (!stale) setDrifts({}); }
    })();
    return () => { stale = true; };
  }, [wind, useThermals, stands, tapped]);

  // ------------------------------------------------------------- draw: cones
  useEffect(() => {
    const lg = layers.current.cones; if (!lg) return;
    lg.clearLayers();
    if (!wind) return;
    const cone = (lat, lon, color, d) => {
      for (const [frac, op] of [[1, 0.12], [0.66, 0.18], [0.33, 0.28]]) {
        const poly = d ? driftCone(lat, lon, d.toBearing, d.mph, d.extraHalf, frac) : scentCone(lat, lon, wind.dir, wind.mph, frac);
        L.polygon(poly, { color, weight: 1, opacity: 0.5, fillColor: color, fillOpacity: op, interactive: false }).addTo(lg);
      }
    };
    if (showCones) stands.forEach((s) => cone(s.lat, s.lon, "#ff8c1a", drifts[s.id]));
    if (tapped) cone(tapped[0], tapped[1], "#ffd60a", drifts._tap);
  }, [wind, drifts, showCones, stands, tapped]);

  // ------------------------------------------------------------- draw: stands
  useEffect(() => {
    const lg = layers.current.stands; if (!lg) return;
    lg.clearLayers();
    stands.forEach((s) => {
      const ok = wind ? windOkForStand(wind.dir, s.good_winds) : null;
      const cls = ok === true ? "good" : ok === false ? "bad" : "none";
      const icon = L.divIcon({ className: "", iconSize: [0, 0],
        html: `<div class="stand ${cls}"><div class="pin">🌲</div><div class="lbl">${esc(s.name)}</div></div>` });
      L.marker([s.lat, s.lon], { icon }).bindPopup(
        `<b>${esc(s.name)}</b><br>${esc(s.type)}<br>Good winds: ${esc((s.good_winds || []).join(", ") || "—")}` +
        (s.notes ? `<br>${esc(s.notes)}` : "")).addTo(lg);
    });
  }, [stands, wind?.dir]);

  // ------------------------------------------------------------- draw: marks + bait
  useEffect(() => {
    const { marks, bait } = layers.current; if (!marks) return;
    marks.clearLayers(); bait.clearLayers();
    features.forEach((f) => {
      const [col, emoji, label] = FEATURE[f.type] || ["#999", "•", f.type];
      if (BAIT.has(f.type)) {
        const filled = f.last_filled ? ` · filled ${f.last_filled}` : "";
        L.marker([f.lat, f.lon], { icon: L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="emoji">${emoji}</div>` }) })
          .bindPopup(`<b>${esc(label)}</b>${f.name ? `<br>${esc(f.name)}` : ""}${esc(filled)}`).addTo(bait);
      } else {
        L.circle([f.lat, f.lon], { radius: (f.radius_yd || 40) * YD, color: col, weight: 2, fillColor: col, fillOpacity: 0.25 })
          .bindPopup(`<b>${emoji} ${esc(label)}</b>${f.name ? `<br>${esc(f.name)}` : ""}`).addTo(marks);
      }
    });
  }, [features]);

  // ------------------------------------------------------------- draw: deer sightings (everyone's, this ground)
  const sightings = useMemo(() => groupSightings(data?.hunts || []), [data]);
  useEffect(() => {
    const lg = layers.current.sightings; if (!lg) return;
    lg.clearLayers();
    sightings.forEach((e) => {
      const kinds = e.deer.map(([k]) => k);
      const col = KIND_COLOR[kinds.includes("Buck") ? "Buck" : kinds[0]] || "#ccc";
      const pt = [e.lat, e.lon];
      const deer = e.deer.map(([k, n]) => `${n} ${k.toLowerCase()}${n > 1 && k !== "Unknown" ? "s" : ""}`).join(" + ");
      const when = new Date(e.time).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
      const tip = `${when} — ${deer}${e.activity ? ` · ${e.activity}` : ""}${e.came_from ? ` · came from ${e.came_from}` : ""}${e.went_to ? ` · went ${e.went_to}` : ""}`;
      if (CARDINALS_8.includes(e.came_from)) {
        const end = destination(e.lat, e.lon, CARDINALS_8.indexOf(e.came_from) * 45, 30 * YD);
        L.polyline([end, pt], { color: col, weight: 3, opacity: 0.9, dashArray: "4 4", interactive: false }).addTo(lg);
      }
      if (CARDINALS_8.includes(e.went_to)) {
        const b = CARDINALS_8.indexOf(e.went_to) * 45;
        const end = destination(e.lat, e.lon, b, 30 * YD);
        L.polyline([pt, end], { color: col, weight: 3, opacity: 0.9, interactive: false }).addTo(lg);
        L.marker(end, { interactive: false, icon: L.divIcon({ className: "", iconSize: [14, 14], iconAnchor: [7, 7],
          html: `<div class="arrowhead" style="transform:rotate(${b}deg);border-bottom-color:${col}"></div>` }) }).addTo(lg);
      }
      L.circleMarker(pt, { radius: 7, color: "#111", weight: 1, fillColor: col, fillOpacity: 0.95 }).bindPopup(esc(tip)).addTo(lg);
    });
  }, [sightings]);

  // ------------------------------------------------------------- draw: tapped test point
  useEffect(() => {
    const lg = layers.current.tap; if (!lg) return;
    lg.clearLayers();
    if (tapped) L.circleMarker(tapped, { radius: 8, color: "#fff", weight: 2, fillColor: "#ff3b30", fillOpacity: 1 })
      .on("click", (e) => { L.DomEvent.stop(e); setTapped(null); }).addTo(lg);
  }, [tapped]);

  // ------------------------------------------------------------- draw: scent drift field around the map center
  const [fieldNote, setFieldNote] = useState("");
  useEffect(() => {
    const lg = layers.current.field; if (!lg) return;
    lg.clearLayers(); setFieldNote("");
    if (!showField || !wind || !center) return;
    let stale = false;
    const N = 8, SP = 120, half = (N - 1) / 2;
    const grid = [...Array(N)].map((_, r) => [...Array(N)].map((_, c) =>
      destination(...destination(center[0], center[1], 0, (half - r) * SP), 90, (c - half) * SP)));
    (async () => {
      try {
        const el = await elevations(grid.flat());
        if (stale) return;
        const E = grid.map((row, r) => row.map((_, c) => el[r * N + c]));
        const S = gridSlopes(E, SP);
        const [phase, strength] = thermalPhase(center[0], center[1], wind.when);
        for (let r = 1; r < N - 1; r++) for (let c = 1; c < N - 1; c++) {
          const [lat, lon] = grid[r][c];
          const d = combine(wind.dir, wind.mph, S[r][c][0], S[r][c][1], phase, strength);
          const len = 25 + 8 * Math.min(d.mph, 10);
          const tail = destination(lat, lon, (d.toBearing + 180) % 360, len / 2);
          const head = destination(lat, lon, d.toBearing, len / 2);
          const col = d.influence > 0.35 ? "#b388ff" : d.switching ? "#ffd60a" : "#ff8c1a";
          const tip = `Scent drifts to ${degToCardinal(d.toBearing)} · ${describe(d)}`;
          L.polyline([tail, head], { color: col, weight: 3, opacity: 0.9 }).bindPopup(esc(tip)).addTo(lg);
          L.marker(head, { interactive: false, icon: L.divIcon({ className: "", iconSize: [12, 12], iconAnchor: [6, 6],
            html: `<div class="arrowhead sm" style="transform:rotate(${d.toBearing}deg);border-bottom-color:${col}"></div>` }) }).addTo(lg);
        }
      } catch { if (!stale) setFieldNote("Terrain unavailable — drift field needs signal"); }
    })();
    return () => { stale = true; };
  }, [showField, wind, center && Math.round(center[0] * 400), center && Math.round(center[1] * 400)]);

  const locate = () => map.current?.locate({ setView: true, maxZoom: 17, enableHighAccuracy: true });
  const tapDrift = tapped && drifts._tap;

  return (
    <div className="screen">
      <div ref={mapEl} className="map" />

      <header className="topbar">
        <button className="chip" onClick={() => setMenu(!menu)}>🏞️ {ground?.name || "—"} ▾</button>
        {demo && <span className="demo">DEMO DATA</span>}
      </header>
      {menu && (
        <div className="menu" onClick={() => setMenu(false)}>
          <div className="menu-card" onClick={(e) => e.stopPropagation()}>
            <div className="menu-h">Hunting ground</div>
            {grounds.map((g) => (
              <button key={g.id} className={`menu-row ${g.id === ground?.id ? "on" : ""}`} onClick={() => { onGround(g.id); setMenu(false); }}>
                {g.id === ground?.id ? "✓ " : ""}{g.name}
              </button>
            ))}
            <div className="menu-h">Signed in</div>
            <div className="menu-row muted">{email}</div>
            <button className="menu-row" onClick={onSignOut}>Sign out</button>
          </div>
        </div>
      )}

      <Compass wind={wind} />
      <button className="fab locate" onClick={locate} aria-label="My location">◎</button>

      <section className={`sheet ${sheetOpen ? "open" : ""}`}>
        <button className="handle" onClick={() => setSheetOpen(!sheetOpen)} aria-label="Expand">
          <span className="grip" />
          {wind ? (
            <div className="wind-line">
              <span className="big">💨 {Math.round(wind.mph)} mph {degToCardinal(wind.dir)}</span>
              <span className="muted"> gusts {Math.round(wind.gust)} · {wind.label}</span>
            </div>
          ) : <div className="wind-line muted">{windErr || "Getting wind…"}</div>}
        </button>

        <div className="sheet-body">
          <div className="seg">
            <button className={mode === "live" ? "on" : ""} onClick={() => setMode("live")}>Live now</button>
            <button className={mode === "forecast" ? "on" : ""} onClick={() => setMode("forecast")}>Forecast hour</button>
          </div>
          {mode === "forecast" && hours.length > 0 && (
            <div className="slider">
              <input type="range" min="0" max={hours.length - 1} value={hourIdx} onChange={(e) => setHourIdx(+e.target.value)} />
              <div className="muted small">{fmtHour(hours[hourIdx].time)} · {Math.round(hours[hourIdx].mph)} mph from {degToCardinal(hours[hourIdx].dir)}</div>
            </div>
          )}
          {mode === "live" && <button className="link" onClick={() => loadLive(true)}>↻ Refresh wind</button>}

          {tapped && (
            <div className="card tapcard">
              <div><b>📍 Test point</b> — scent drifts to <b>{degToCardinal(tapDrift ? tapDrift.toBearing : ((wind?.dir ?? 0) + 180) % 360)}</b></div>
              {tapDrift && <div className="muted small">{describe(tapDrift)}</div>}
              <button className="link" onClick={() => setTapped(null)}>Clear point</button>
            </div>
          )}

          <div className="card">
            {!data && <div className="muted">Loading stands…</div>}
            {data && !stands.length && <div className="muted">No stands on this ground yet.</div>}
            {stands.map((s) => {
              const ok = wind ? windOkForStand(wind.dir, s.good_winds) : null;
              const d = drifts[s.id];
              return (
                <div className="stand-row" key={s.id}>
                  <span className="mark">{ok === null ? "⚪" : ok ? "✅" : "❌"}</span>
                  <div>
                    <div><b>{s.name}</b> <span className="muted small">good: {(s.good_winds || []).join(", ") || "none set"}</span></div>
                    {d && d.slope >= 1.5 && <div className="muted small">{describe(d)}</div>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="toggles">
            <Toggle label="Scent cones" on={showCones} set={setShowCones} />
            <Toggle label="Thermals" on={useThermals} set={setUseThermals} />
            <Toggle label="Drift field" on={showField} set={setShowField} />
          </div>
          {fieldNote && <div className="muted small">{fieldNote}</div>}

          <button className="link" onClick={() => setKeyOpen(!keyOpen)}>🗝️ Map key {keyOpen ? "▴" : "▾"}</button>
          {keyOpen && (
            <div className="card small key">
              <p>🌲 Stands: <span className="g">green</span> = wind is one of its good winds, <span className="r">red</span> = bad wind, blue = no good winds set.</p>
              <p>🟧 Orange cones: where scent drifts from each stand. Short &amp; wide = light, swirly wind; long &amp; narrow = steady wind. With Thermals on, cones bend uphill as the sun warms slopes and downhill as they cool; around sunrise and the hour before sunset they widen (switching).</p>
              <p>Tap anywhere to test a spot (yellow cone). Tap the red dot to clear it.</p>
              <p>Drift field arrows: orange = wind-driven, purple = thermal-driven, yellow = thermals switching.</p>
              <p>🛢️🌽🍎 bait &amp; food · 💧 water · 🌲 cover · 🛏️ bedding (circles).</p>
              <p>Deer: <span style={{ color: KIND_COLOR.Buck }}>●</span> buck <span style={{ color: KIND_COLOR.Doe }}>●</span> doe <span style={{ color: KIND_COLOR.Fawn }}>●</span> fawn — dashed = came from, solid arrow = went.</p>
              <p className="muted">Wind is one value for the area (forecast models don't resolve wind inside a property); terrain is what varies.</p>
            </div>
          )}
          <div className="foot muted small">Deercast web test · read-only · {sightings.length} sightings on this ground</div>
        </div>
      </section>
    </div>
  );
}

function Toggle({ label, on, set }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />
      <span className="track"><span className="knob" /></span>
      <span>{label}</span>
    </label>
  );
}

function Compass({ wind }) {
  const down = wind ? (wind.dir + 180) % 360 : null;
  return (
    <div className="compass" aria-label="Compass">
      <svg viewBox="0 0 100 100" width="76" height="76">
        <circle cx="50" cy="50" r="46" fill="rgba(20,24,26,.72)" stroke="rgba(255,255,255,.5)" strokeWidth="1.5" />
        {["N", "E", "S", "W"].map((t, i) => {
          const a = (i * 90 * Math.PI) / 180;
          return <text key={t} x={50 + 36 * Math.sin(a)} y={54 - 36 * Math.cos(a)} textAnchor="middle" fontSize="12"
            fill={t === "N" ? "#ff5a4f" : "#ddd"} fontWeight="700">{t}</text>;
        })}
        {down !== null && (
          <g transform={`rotate(${down} 50 50)`}>
            <line x1="50" y1="72" x2="50" y2="30" stroke="#ff8c1a" strokeWidth="5" strokeLinecap="round" />
            <polygon points="50,18 41,34 59,34" fill="#ff8c1a" />
          </g>
        )}
      </svg>
      {wind && <div className="compass-lbl">{degToCardinal(wind.dir)} {Math.round(wind.mph)}</div>}
    </div>
  );
}
