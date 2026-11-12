// Leaflet drawing shared by the hunt map (HuntMap.jsx) and the tracking map (TrackMode.jsx).
import L from "leaflet";
import { CARDINALS_8, YD, destination } from "./lib/geo.js";
import { deerText } from "./lib/huntlog.js";

export const KIND_COLOR = { Buck: "#ff6b1a", Doe: "#ffd60a", "Doe fawn": "#f5deb3", "Button buck": "#f5deb3", Fawn: "#f5deb3", "Fawn?": "#f5deb3", Unknown: "#c0c0c0" };
export const TRIP_COLORS = ["#4cc9f0", "#c77dff", "#52b788", "#3a86ff", "#e76f51", "#ffffff"]; // not the deer colors (buck orange / doe yellow / fawn tan)
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const arrowHead = (at, bearing, col, sm) => L.marker(at, { interactive: false, icon: L.divIcon({ className: "", iconSize: [14, 14], iconAnchor: [7, 7],
  html: `<div class="arrowhead${sm ? " sm" : ""}" style="transform:rotate(${bearing}deg);border-bottom-color:${col}"></div>` }) });

/** One 'Deer seen' entry (grouped): a dot, and its came-from (dashed) / went-toward (arrow) trail. Returns its points. */
export function drawSighting(lg, e, tz) {
  if (e.lat == null) return [];
  const kinds = e.deer.map(([k]) => k);
  const col = KIND_COLOR[kinds.includes("Buck") ? "Buck" : kinds[0]] || "#ccc";
  const pt = [e.lat, e.lon], pts = [pt];
  const when = new Date(e.time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) });
  const tip = `${when} — ${deerText(e.deer)}${e.activity ? ` · ${e.activity}` : ""}${e.bait ? " · at a feeder" : ""}${e.came_from ? ` · came from ${e.came_from}` : ""}${e.went_to ? ` · went ${e.went_to}` : ""}`;
  if (CARDINALS_8.includes(e.came_from)) {
    const end = destination(e.lat, e.lon, CARDINALS_8.indexOf(e.came_from) * 45, 40 * YD);
    L.polyline([end, pt], { color: col, weight: 3, opacity: 0.9, dashArray: "4 4", interactive: false }).addTo(lg); pts.push(end);
  }
  if (CARDINALS_8.includes(e.went_to)) {
    const b = CARDINALS_8.indexOf(e.went_to) * 45, end = destination(e.lat, e.lon, b, 40 * YD);
    L.polyline([pt, end], { color: col, weight: 3, opacity: 0.9, interactive: false }).addTo(lg);
    arrowHead(end, b, col).addTo(lg); pts.push(end);
  }
  const cam = e.source === "camera";
  L.circleMarker(pt, cam ? { radius: 6, color: col, weight: 3, fillColor: "#111", fillOpacity: 0.6 } : { radius: 7, color: "#111", weight: 1, fillColor: col, fillOpacity: 0.95 })
    .bindPopup(esc(cam ? `📷 ${e.camera || "Trail camera"} · ${tip}` : tip)).addTo(lg);
  return pts;
}

export const RUN_COLOR = "#ff3b30";
/** The shot deer: stand → hit site (thin dashed), and where you think it went (red arrow, ~80 yd). Returns its points. */
export function drawShotRun(lg, run, { label = "", hitMarker = true } = {}) {
  const pts = [];
  if (!run?.hit) return pts;
  if (run.from) { L.polyline([run.from, run.hit], { color: "#fff", weight: 2, opacity: 0.8, dashArray: "3 6", interactive: false }).addTo(lg); pts.push(run.from); }
  if (run.bearing != null) {
    const end = destination(run.hit[0], run.hit[1], run.bearing, 80 * YD);
    L.polyline([run.hit, end], { color: RUN_COLOR, weight: 4, opacity: 0.95, dashArray: "10 6", interactive: false }).addTo(lg);
    arrowHead(end, run.bearing, RUN_COLOR).addTo(lg);
    L.polyline([run.hit, end], { color: RUN_COLOR, weight: 18, opacity: 0.01 }) // fat invisible line = easy to tap
      .bindPopup(esc(`${label ? `${label} — ` : ""}ran ${run.dir}${run.source === "sighting" ? " (from 'Went toward')" : " (from hit analysis)"}`)).addTo(lg);
    pts.push(end);
  }
  if (hitMarker) L.marker(run.hit, { icon: L.divIcon({ className: "", iconSize: [30, 30], iconAnchor: [15, 15], html: '<div class="emoji pin">🎯</div>' }) })
    .bindPopup(esc(`${label ? `${label} · ` : ""}Hit site${run.hitSource === "sighting" ? " (where you saw the deer)" : run.hitSource === "analysis" ? " (hit analysis)" : ""}`)).addTo(lg);
  pts.push(run.hit);
  return pts;
}

/** Tracking trips: GPS paths (gaps over a minute dotted white) and drawn paths (dashed). Returns their points. */
export function drawTrips(lg, trips) {
  const all = [];
  (trips || []).forEach((t, i) => {
    const col = TRIP_COLORS[i % TRIP_COLORS.length];
    let seg = [];
    (t.path || []).forEach((p, j) => {
      if (j && p[2] && t.path[j - 1][2] && p[2] - t.path[j - 1][2] > 60000) {
        if (seg.length > 1) L.polyline(seg, { color: col, weight: 4, opacity: 0.9, interactive: false }).addTo(lg);
        L.polyline([[t.path[j - 1][0], t.path[j - 1][1]], [p[0], p[1]]], { color: "#fff", weight: 2, opacity: 0.7, dashArray: "2 8", interactive: false }).addTo(lg);
        seg = [];
      }
      seg.push([p[0], p[1]]);
      all.push([p[0], p[1]]);
    });
    if (seg.length > 1) L.polyline(seg, { color: col, weight: 4, opacity: 0.9, interactive: false }).addTo(lg);
    if ((t.drawn || []).length > 1) L.polyline(t.drawn, { color: col, weight: 4, opacity: 0.9, dashArray: "8 8", interactive: false }).addTo(lg);
    for (const p of (t.drawn || []).length === 1 ? t.drawn : []) L.circleMarker(p, { radius: 4, color: col, interactive: false }).addTo(lg);
    all.push(...(t.drawn || []));
  });
  return all;
}
