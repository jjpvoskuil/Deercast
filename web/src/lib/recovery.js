// Recovery search map — JavaScript copy of deercast/recovery.py (parity test: shot.test.js).
// Where a hit deer is likely to be: typical travel distance for the hit × run direction × downhill pull × water & cover.
import { destination, YD } from "./geo.js";

const linspace = (a, b, n) => Array.from({ length: n }, (_, i) => (n === 1 ? a : a + ((b - a) * i) / (n - 1)));

/** Polar grid of cells around the hit site; a wedge ±100° around the run direction when it's known. */
export function searchGrid(lat, lon, yards, runDir, rings = 8, sectors = 12) {
  const [, , hi] = yards;
  const rMax = Math.max(hi * 1.15, 60);
  const bearings = runDir == null ? linspace(0, 360, sectors + 1) : linspace(runDir - 100, runDir + 100, sectors + 1);
  const radii = linspace(0, rMax, rings + 1);
  const cells = [];
  for (let i = 0; i < rings; i++) for (let j = 0; j < sectors; j++) {
    const r0 = radii[i], r1 = radii[i + 1], b0 = bearings[j], b1 = bearings[j + 1];
    const arc = linspace(b0, b1, 5);
    const poly = [...arc.map((b) => destination(lat, lon, b, r1 * YD)), ...[...arc].reverse().map((b) => destination(lat, lon, b, Math.max(r0, 0.5) * YD))];
    const rc = (r0 + r1) / 2, bc = (b0 + b1) / 2;
    cells.push({ poly, center: destination(lat, lon, bc, rc * YD), dist_yd: rc, bearing: ((bc % 360) + 360) % 360 });
  }
  return cells;
}

/** Normalized weights: log-normal distance × run direction (von Mises) × downhill tendency. */
export function weightCells(cells, yards, runDir, elev, shotElev, downhillBias) {
  const [, med0, hi] = yards;
  const med = Math.max(med0, 10);
  const sigma = Math.max(0.35, Math.log(Math.max(hi, med + 1) / med) / 1.28);
  const w = cells.map((c, k) => {
    const d = Math.max(c.dist_yd, 1);
    let p = Math.exp(-((Math.log(d) - Math.log(med)) ** 2) / (2 * sigma ** 2)) / d;
    if (runDir != null) { const dev = ((((c.bearing - runDir + 180) % 360) + 360) % 360 - 180) * Math.PI / 180; p *= Math.exp(2.2 * (Math.cos(dev) - 1)); }
    if (elev && shotElev != null && downhillBias > 0) { const drop = shotElev - elev[k]; p *= Math.exp(downhillBias * Math.max(-3, Math.min(3, drop / 8))); }
    return p;
  });
  const s = w.reduce((a, b) => a + b, 0);
  return s > 0 ? w.map((x) => x / s) : w;
}

export const DOWNHILL_BIAS = { liver: 0.5, paunch: 0.6, single_lung: 0.4, muscle: 0.3, shoulder_only: 0.3, kidneys: 0.3, neck_vessels: 0.2 };
export const WATER_BIAS = { liver: 1.2, paunch: 1.5, single_lung: 1.0, kidneys: 0.8, muscle: 0.8, shoulder_only: 0.8, neck_vessels: 0.6, femoral: 0.5, double_lung: 0.3, heart: 0.3, aorta: 0.3 };
export const COVER_BIAS = { liver: 1.4, paunch: 1.5, single_lung: 1.2, kidneys: 1.0, muscle: 1.0, shoulder_only: 1.0, neck_vessels: 0.8, femoral: 0.6, double_lung: 0.5, heart: 0.5, aorta: 0.5 };

/** Water and woods/cover from OpenStreetMap (Overpass): {water: [[[lat, lon], ...]], cover: [...]}, or null. */
const osmCache = new Map();
export async function fetchOsm(lat, lon, radiusM) {
  const r = Math.round(Math.min(Math.max(radiusM, 200), 2500));
  const k = `${lat.toFixed(4)},${lon.toFixed(4)},${r}`;
  if (osmCache.has(k)) return osmCache.get(k);
  const q = `[out:json][timeout:20];(
    way(around:${r},${lat},${lon})["waterway"~"^(stream|river|brook|ditch|canal|drain)$"];
    way(around:${r},${lat},${lon})["natural"="water"]; way(around:${r},${lat},${lon})["natural"="wetland"];
    way(around:${r},${lat},${lon})["natural"~"^(wood|scrub|heath)$"]; way(around:${r},${lat},${lon})["landuse"="forest"];
    relation(around:${r},${lat},${lon})["natural"~"^(water|wetland|wood)$"]; relation(around:${r},${lat},${lon})["landuse"="forest"];
  );out tags geom;`;
  try {
    const resp = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: q }) });
    if (!resp.ok) return null;
    const out = { water: [], cover: [] };
    for (const el of (await resp.json()).elements || []) {
      const t = el.tags || {};
      const geoms = el.type === "relation"
        ? (el.members || []).filter((m) => ["outer", ""].includes(m.role)).map((m) => (m.geometry || []).map((g) => [g.lat, g.lon]))
        : [(el.geometry || []).map((g) => [g.lat, g.lon])];
      for (const g of geoms) {
        if (g.length < 2) continue;
        if ("waterway" in t || t.natural === "water") out.water.push(g);
        if (t.natural === "wetland") { out.water.push(g); out.cover.push(g); }
        if (["wood", "scrub", "heath"].includes(t.natural) || t.landuse === "forest") out.cover.push(g);
      }
    }
    osmCache.set(k, out);
    return out;
  } catch { return null; }
}

const xy = (lat0, lon0, pts) => { const k = Math.cos((lat0 * Math.PI) / 180); return pts.map(([a, b]) => [(b - lon0) * 111320 * k, (a - lat0) * 110540]); };
function distToPolyline(p, line) {
  let best = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i], b = line[i + 1], abx = b[0] - a[0], aby = b[1] - a[1];
    const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / Math.max(abx * abx + aby * aby, 1e-9)));
    best = Math.min(best, Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t)));
  }
  return best;
}
function inside([x, y], ring) {
  let ins = false;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    if ((y1 > y) !== (y2 > y) && x < ((x2 - x1) * (y - y1)) / ((y2 - y1) || 1e-12) + x1) ins = !ins;
  }
  return ins;
}

/** Per cell: [m to nearest water, m to nearest cover (0 if inside), m to nearest bedding mark]. */
export function featureDistances(cells, lat0, lon0, osm, marks) {
  const centers = xy(lat0, lon0, cells.map((c) => c.center));
  const water = (osm?.water || []).map((g) => xy(lat0, lon0, g)), cover = (osm?.cover || []).map((g) => xy(lat0, lon0, g));
  const mk = marks.map((m) => ({ ...m, p: xy(lat0, lon0, [[m.lat, m.lon]])[0] }));
  return centers.map((p) => {
    let dw = water.reduce((m, g) => Math.min(m, distToPolyline(p, g)), Infinity);
    let dc = Infinity;
    for (const g of cover) {
      const closed = g.length > 3 && Math.hypot(g[0][0] - g[g.length - 1][0], g[0][1] - g[g.length - 1][1]) < 5;
      if (closed && inside(p, g)) { dc = 0; break; }
      dc = Math.min(dc, distToPolyline(p, g));
    }
    for (const m of mk) {
      const d = Math.max(0, Math.hypot(p[0] - m.p[0], p[1] - m.p[1]) - (m.radius_yd ?? 40) * YD);
      if (m.type === "water") dw = Math.min(dw, d); else if (m.type === "cover" || m.type === "bedding") dc = Math.min(dc, d);
    }
    const bed = mk.filter((m) => m.type === "bedding").reduce((acc, m) => Math.min(acc, Math.max(0, Math.hypot(p[0] - m.p[0], p[1] - m.p[1]) - (m.radius_yd ?? 40) * YD)), Infinity);
    return [dw, dc, bed];
  });
}
export const habitatMultiplier = (dists, wb, cb) => dists.map(([dw, dc, bed]) => {
  let f = 1;
  if (Number.isFinite(dw)) f *= 1 + wb * Math.exp(-dw / 90);
  if (Number.isFinite(dc)) f *= 1 + cb * Math.exp(-dc / 40);
  if (Number.isFinite(bed)) f *= 1 + 1.5 * cb * Math.exp(-bed / 40);
  return f;
});
