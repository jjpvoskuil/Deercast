import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { degToCardinal, destination, driftCone, scentCone, windOkForStand, YD } from "./lib/geo.js";
import { combine, describe, gridSlopes, slopeFrom, slopePoints, thermalPhase } from "./lib/terrain.js";
import { currentWind, elevations, hourlyWind } from "./lib/weather.js";
import Icon from "./Icon.jsx";
import { GroundChip, ThemeButton } from "./Shell.jsx";
import { SiteLists, TapActions } from "./MapEdit.jsx";

export const FEATURE = {
  water: ["#3a86ff", "💧", "Water"], cover: ["#2d6a4f", "🌲", "Thick cover"], bedding: ["#ffb703", "🛏️", "Bedding area"],
  feeder: ["#f4a261", "🛢️", "Broadcast corn feeder"], corn_shelled: ["#e9c46a", "🌽", "Shelled corn pile"],
  corn_ear: ["#e9c46a", "🌽", "Ear corn pile"], food_other: ["#90be6d", "🍎", "Other food / plot"],
  camera: ["#8d99ae", "📷", "Trail camera"],
};
export const BAIT = new Set(["feeder", "corn_shelled", "corn_ear", "food_other"]);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmtHour = (d) => d.toLocaleString([], { weekday: "short", hour: "numeric" });

function useStored(key, initial) {
  const [v, setV] = useState(() => { try { const s = localStorage.getItem(key); return s === null ? initial : JSON.parse(s); } catch { return initial; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }, [key, v]);
  return [v, setV];
}

const TREE = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l5 7h-3l4 6H6l4-6H7l5-7z"/><path d="M12 16v5"/></svg>';

export default function MapScreen({ ground, data, demo, theme, onMenu, active, save, onForecastPin }) {
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
  const [keyOpen, setKeyOpen] = useState(false);
  // Leaflet must re-measure when its tab becomes visible again
  useEffect(() => { if (active && map.current) setTimeout(() => map.current.invalidateSize(), 0); }, [active]);

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
    layers.current = { field: g(), cones: g(), marks: g(), bait: g(), stands: g(), tap: g(), me: g() };
    L.control.layers({ Satellite: sat, Topo: topo, Streets: streets },
      { Labels: labels, "Bait & food": layers.current.bait, "Water / cover / bedding": layers.current.marks }, { position: "topleft", collapsed: true }).addTo(m);
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
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#E8682A";
    if (showCones) stands.forEach((s) => cone(s.lat, s.lon, accent, drifts[s.id]));
    if (tapped) cone(tapped[0], tapped[1], "#ffd60a", drifts._tap);
  }, [wind, drifts, showCones, stands, tapped, theme.theme]);

  // ------------------------------------------------------------- draw: stands
  useEffect(() => {
    const lg = layers.current.stands; if (!lg) return;
    lg.clearLayers();
    stands.forEach((s) => {
      const ok = wind ? windOkForStand(wind.dir, s.good_winds) : null;
      const cls = ok === true ? "good" : ok === false ? "bad" : "none";
      const icon = L.divIcon({ className: "", iconSize: [0, 0],
        html: `<div class="stand ${cls}"><div class="dot">${TREE}</div><div class="lbl">${esc(s.name)}</div></div>` });
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
      if (f.type === "camera") {
        L.marker([f.lat, f.lon], { icon: L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="emoji">${emoji}</div>` }) })
          .bindPopup(`<b>${esc(label)}</b>${f.name ? `<br>${esc(f.name)}` : ""}`).addTo(marks);
      } else if (BAIT.has(f.type)) {
        const filled = f.last_filled ? ` · filled ${f.last_filled}` : "";
        L.marker([f.lat, f.lon], { icon: L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="emoji">${emoji}</div>` }) })
          .bindPopup(`<b>${esc(label)}</b>${f.name ? `<br>${esc(f.name)}` : ""}${esc(filled)}`).addTo(bait);
      } else {
        L.circle([f.lat, f.lon], { radius: (f.radius_yd || 40) * YD, color: col, weight: 2, fillColor: col, fillOpacity: 0.25 })
          .bindPopup(`<b>${emoji} ${esc(label)}</b>${f.name ? `<br>${esc(f.name)}` : ""}`).addTo(marks);
      }
    });
  }, [features]);

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
    <div className="screen" style={{ display: active ? undefined : "none" }}>
      <div ref={mapEl} className="map" />

      <header className="topbar">
        <GroundChip ground={ground} onClick={onMenu} demo={demo} />
        <span className="spacer" />
        <ThemeButton theme={theme} />
      </header>

      <Compass wind={wind} />
      <button className="fab" onClick={locate} aria-label="My location"><Icon name="locate" /></button>

      <section className={`sheet ${sheetOpen ? "open" : ""}`}>
        <button className="handle" onClick={() => setSheetOpen(!sheetOpen)} aria-label="Expand">
          <span className="grip" />
          {wind ? (
            <div className="wind-line">
              <span className="big">{degToCardinal(wind.dir)} {Math.round(wind.mph)}</span>
              <span className="muted">mph · gusts {Math.round(wind.gust)} · {wind.label}</span>
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
          {mode === "live" && <button className="link" onClick={() => loadLive(true)}><Icon name="refresh" size={18} />Refresh wind</button>}

          {tapped && (
            <div className="card tapcard">
              <div><b>Test point</b> — scent drifts to <b>{degToCardinal(tapDrift ? tapDrift.toBearing : ((wind?.dir ?? 0) + 180) % 360)}</b></div>
              {tapDrift && <div className="muted small">{describe(tapDrift)}</div>}
              <TapActions tapped={tapped} ground={ground} save={save} stands={stands} onClear={() => setTapped(null)}
                onForecast={() => onForecastPin({ lat: tapped[0], lon: tapped[1], label: `Pin ${tapped[0].toFixed(4)}, ${tapped[1].toFixed(4)}` })} />
              <button className="link" onClick={() => setTapped(null)}>Clear point</button>
            </div>
          )}

          <div className="card">
            {!data && <div className="muted">Loading stands…</div>}
            {data && !stands.length && <div className="muted">No stands on this ground yet.</div>}
            {stands.map((s) => {
              const ok = wind ? windOkForStand(wind.dir, s.good_winds) : null;
              const d = drifts[s.id];
              const cls = ok === null ? "none" : ok ? "good" : "bad";
              return (
                <div className="stand-row" key={s.id}>
                  <span className={`status ${cls}`}><Icon name={ok === null ? "minus" : ok ? "check" : "x"} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="name">{s.name}</div>
                    <div className="muted small">Good winds {(s.good_winds || []).join(", ") || "not set"}
                      {d && d.slope >= 1.5 ? ` · ${describe(d)}` : ""}</div>
                  </div>
                  {ok !== null && <span className={`verdict ${cls}`}>{ok ? "Good wind" : "Bad wind"}</span>}
                </div>
              );
            })}
          </div>

          <div className="toggles">
            <Toggle label="Scent cones" on={showCones} set={setShowCones} />
            <Toggle label="Drift field" on={showField} set={setShowField} />
            <Toggle label="Bend for thermals" on={useThermals} set={setUseThermals} disabled={!showCones && !showField} />
          </div>
          {!showCones && !showField && <div className="muted small">"Bend for thermals" adjusts the scent cones and drift field — turn one of them on to see it.</div>}
          {fieldNote && <div className="muted small">{fieldNote}</div>}
          <SiteLists features={features} stands={stands} wind={wind} ground={ground} save={save}
            onCenter={(st) => { map.current?.setView([st.lat, st.lon], 17); setSheetOpen(false); }} />

          <button className="link" onClick={() => setKeyOpen(!keyOpen)}><Icon name="key" size={18} />Map key {keyOpen ? "▴" : "▾"}</button>
          {keyOpen && (
            <div className="card small key">
              <p>Stands: <span className="g">green</span> = wind is one of its good winds, <span className="r">red</span> = bad wind, blue = no good winds set.</p>
              <p>Orange cones: where scent drifts from each stand. Short &amp; wide = light, swirly wind; long &amp; narrow = steady wind. With Thermals on, cones bend uphill as the sun warms slopes and downhill as they cool; around sunrise and the hour before sunset they widen (switching).</p>
              <p>Tap anywhere to test a spot (yellow cone) — then forecast it, or add a stand or mark there. Tap the red dot to clear it.</p>
              <p>Drift field arrows: orange = wind-driven, purple = thermal-driven, yellow = thermals switching.</p>
              <p>🛢️🌽🍎 bait &amp; food · 💧 water · 🌲 cover · 🛏️ bedding (circles).</p>
              <p>Deer you've seen are on each hunt's own map: Hunt Log → open a hunt → 🗺️ Map this hunt.</p>
              <p className="muted">Wind is one value for the area (forecast models don't resolve wind inside a property); terrain is what varies.</p>
            </div>
          )}
        </div>
      </section>

    </div>
  );
}

function Toggle({ label, on, set, disabled }) {
  return (
    <label className={`toggle ${disabled ? "off" : ""}`}>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => set(e.target.checked)} />
      <span className="track"><span className="knob" /></span>
      <span>{label}</span>
    </label>
  );
}

function Compass({ wind }) {
  const down = wind ? (wind.dir + 180) % 360 : null;
  return (
    <div className="compass" aria-label="Compass">
      <svg viewBox="0 0 100 100" width="64" height="64" role="img" aria-label="Compass with downwind arrow">
        <circle cx="50" cy="50" r="46" fill="var(--chip)" stroke="var(--line)" strokeWidth="1.5" />
        {["N", "E", "S", "W"].map((t, i) => {
          const a = (i * 90 * Math.PI) / 180;
          return <text key={t} x={50 + 36 * Math.sin(a)} y={54 - 36 * Math.cos(a)} textAnchor="middle" fontSize="12"
            fill={t === "N" ? "var(--bad)" : "var(--muted)"} fontWeight="700">{t}</text>;
        })}
        {down !== null && (
          <g transform={`rotate(${down} 50 50)`}>
            <line x1="50" y1="72" x2="50" y2="30" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round" />
            <polygon points="50,18 41,34 59,34" fill="var(--accent)" />
          </g>
        )}
      </svg>
      {wind && <div className="compass-lbl">{degToCardinal(wind.dir)} {Math.round(wind.mph)}</div>}
    </div>
  );
}
