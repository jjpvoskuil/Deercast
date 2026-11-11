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
    cells.push({ poly, center: destination(lat, lon, bc, rc * YD), dist_yd: rc, bearing: ((bc % 360) + 360) % 360, ring: i, sector: j, r0, r1, b0, b1 });
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

const same = (a, b) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/** Join a multipolygon's member ways end-to-end into closed rings (same as recovery.assemble_rings). */
export function assembleRings(ways) {
  const rings = [], open = [];
  for (const w0 of ways) {
    if (w0.length < 2) continue;
    const w = w0.map((p) => [p[0], p[1]]);
    (w.length >= 4 && same(w[0], w[w.length - 1]) ? rings : open).push(w);
  }
  while (open.length) {
    let cur = open.shift(), grew = true;
    while (grew && !same(cur[0], cur[cur.length - 1])) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const w = open[i], first = cur[0], last = cur[cur.length - 1];
        if (same(last, w[0])) cur = [...cur, ...w.slice(1)];
        else if (same(last, w[w.length - 1])) cur = [...cur, ...[...w].reverse().slice(1)];
        else if (same(first, w[w.length - 1])) cur = [...w, ...cur.slice(1)];
        else if (same(first, w[0])) cur = [...[...w].reverse(), ...cur.slice(1)];
        else continue;
        open.splice(i, 1); grew = true; break;
      }
    }
    if (cur.length >= 4 && same(cur[0], cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}

const isOpenWater = (t) => t.intermittent !== "yes" && t.seasonal !== "yes" && (t.natural === "water" || t.waterway === "riverbank" || t.landuse === "reservoir");

/** Overpass elements → {water: lines, cover: lines/rings, lakes: [[ring, ...], ...]} (same as recovery.parse_osm). */
export function parseOsm(elements) {
  const out = { water: [], cover: [], lakes: [] };
  for (const el of elements || []) {
    const t = el.tags || {};
    let outer, inner = [];
    if (el.type === "relation") {
      const mem = (el.members || []).filter((m) => (m.type ?? "way") === "way").map((m) => [m.role ?? "", (m.geometry || []).map((g) => [g.lat, g.lon])]);
      outer = mem.filter(([r, g]) => (r === "outer" || r === "") && g.length >= 2).map(([, g]) => g);
      inner = mem.filter(([r, g]) => r === "inner" && g.length >= 2).map(([, g]) => g);
    } else {
      const g = (el.geometry || []).map((p) => [p.lat, p.lon]);
      outer = g.length >= 2 ? [g] : [];
    }
    const area = isOpenWater(t);
    if (("waterway" in t && t.waterway !== "riverbank") || area || t.natural === "wetland") out.water.push(...outer, ...inner);
    if (area) { const rings = [...assembleRings(outer), ...assembleRings(inner)]; if (rings.length) out.lakes.push(rings); }
    if (t.natural === "wetland") out.cover.push(...outer);
    if (["wood", "scrub", "heath"].includes(t.natural) || t.landuse === "forest") {
      const rings = el.type === "relation" ? assembleRings(outer) : [];
      out.cover.push(...(rings.length ? rings : outer));
    }
  }
  return out;
}

/** Water and woods/cover from OpenStreetMap (Overpass) — see parseOsm — or null if Overpass fails. */
const osmCache = new Map();
export async function fetchOsm(lat, lon, radiusM) {
  const r = Math.round(Math.min(Math.max(radiusM, 200), 2500));
  const k = `${lat.toFixed(4)},${lon.toFixed(4)},${r}`;
  if (osmCache.has(k)) return osmCache.get(k);
  const q = `[out:json][timeout:20];(
    way(around:${r},${lat},${lon})["waterway"~"^(stream|river|brook|ditch|canal|drain|riverbank)$"];
    way(around:${r},${lat},${lon})["natural"="water"]; way(around:${r},${lat},${lon})["landuse"="reservoir"]; way(around:${r},${lat},${lon})["natural"="wetland"];
    way(around:${r},${lat},${lon})["natural"~"^(wood|scrub|heath)$"]; way(around:${r},${lat},${lon})["landuse"="forest"];
    relation(around:${r},${lat},${lon})["natural"~"^(water|wetland|wood)$"]; relation(around:${r},${lat},${lon})["landuse"~"^(forest|reservoir)$"];
    relation(around:${r},${lat},${lon})["waterway"="riverbank"];
  );out tags geom;`;
  try {
    const resp = await fetch("https://overpass-api.de/api/interpreter", { method: "POST", body: new URLSearchParams({ data: q }) });
    if (!resp.ok) return null;
    const out = parseOsm((await resp.json()).elements);
    osmCache.set(k, out);
    return out;
  } catch { return null; }
}

// ---- bundled lake shorelines (Nolin River Lake, lidar; tools/make_nolin_water.py) — used even when Overpass fails
export const NEAR_BUNDLED_M = 5000;
export function nearBbox(lat, lon, [s, w, n, e], margin = NEAR_BUNDLED_M) {
  const dlat = Math.max(s - lat, 0, lat - n) * 110540, dlon = Math.max(w - lon, 0, lon - e) * 111320 * Math.cos((lat * Math.PI) / 180);
  return Math.hypot(dlat, dlon) <= margin;
}
/** The bundled lake as {water, cover, lakes} if the hit is near it (data = the parsed nolin_water.json). */
export function bundledWater(lat, lon, data) {
  if (!data || !nearBbox(lat, lon, data.bbox)) return null;
  return { water: data.lakes.flat(), cover: [], lakes: data.lakes };
}
let bundledPromise = null;
export async function fetchBundledWater(lat, lon) {
  if (!nearBbox(lat, lon, [37.2719, -86.2544, 37.3876, -86.0983])) return null; // skip the download far from Nolin
  const base = (import.meta.env && import.meta.env.BASE_URL) || "/";
  bundledPromise ??= fetch(`${base}data/nolin_water.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const data = await bundledPromise;
  if (!data) bundledPromise = null;
  return bundledWater(lat, lon, data);
}
/** Combine OSM + bundled data (water = union of both). */
export function mergeFeatures(...feats) {
  const got = feats.filter(Boolean);
  if (!got.length) return null;
  return Object.fromEntries(["water", "cover", "lakes"].map((k) => [k, got.flatMap((f) => f[k] || [])]));
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

// ---- open water: no-go, and no swimming across (same as recovery.water_mask / apply_water)
export const SWIM_MAX_M = 50;
export const REMOVED_NOTE = 0.15;

function segCrossings(P, ring) {
  const n = ring.length > 1 && Math.abs(ring[0][0] - ring[ring.length - 1][0]) < 1e-8 && Math.abs(ring[0][1] - ring[ring.length - 1][1]) < 1e-8 ? ring.length - 1 : ring.length;
  const ts = [];
  for (let i = 0; i < n; i++) {
    const A = ring[i], B = ring[(i + 1) % n], ex = B[0] - A[0], ey = B[1] - A[1];
    const den = P[0] * ey - P[1] * ex;
    if (!(Math.abs(den) > 1e-12)) continue;
    const t = (A[0] * ey - A[1] * ex) / den, u = (A[0] * P[1] - A[1] * P[0]) / den;
    if (t > 0 && t < 1 && u >= 0 && u < 1) ts.push(t);
  }
  return ts;
}

/** Open-water features in local meters around (lat0, lon0), ready for waterMask / inWater. */
export function lakesXY(lat0, lon0, feats) {
  const out = [];
  for (const f of feats?.lakes || []) {
    const rings = f.filter((r) => r.length >= 4).map((r) => xy(lat0, lon0, r));
    if (!rings.length) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of rings) for (const [x, y] of r) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    const start = rings.reduce((a, r) => a + (inside([0, 0], r) ? 1 : 0), 0) % 2 === 1;
    const area = Math.max(...rings.map((r) => Math.abs(r.reduce((a, [xa, ya], i) => { const [xb, yb] = r[(i + 1) % r.length]; return a + xa * yb - xb * ya; }, 0)) / 2));
    out.push({ rings, min: [x0, y0], max: [x1, y1], start, area });
  }
  return out;
}
/** Is a local-meters point inside open water? */
export const inWater = (p, lakes) => lakes.some((L) => p[0] >= L.min[0] && p[0] <= L.max[0] && p[1] >= L.min[1] && p[1] <= L.max[1]
  && L.rings.reduce((a, r) => a + (inside(p, r) ? 1 : 0), 0) % 2 === 1);

/** Per cell: [center is in open water, meters of open water on the straight line from the hit site to it]. */
export function waterMask(cells, lat0, lon0, feats) {
  const lakes = lakesXY(lat0, lon0, feats);
  return xy(lat0, lon0, cells.map((c) => c.center)).map((P) => {
    const lo = [Math.min(P[0], 0), Math.min(P[1], 0)], hi = [Math.max(P[0], 0), Math.max(P[1], 0)];
    const spans = []; let wet = false;
    for (const L of lakes) {
      if (L.max[0] < lo[0] || L.max[1] < lo[1] || L.min[0] > hi[0] || L.min[1] > hi[1]) continue;
      const ts = L.rings.flatMap((r) => segCrossings(P, r)).sort((a, b) => a - b);
      const edges = [0, ...ts, 1];
      let state = L.start;
      for (let i = 0; i < edges.length - 1; i++) { if (state) spans.push([edges[i], edges[i + 1]]); state = !state; }
      if ((ts.length % 2 === 1) !== L.start) wet = true;
    }
    spans.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let len = 0, cur = null;
    for (const [a, b] of spans) {
      if (cur && a <= cur[1]) cur[1] = Math.max(cur[1], b);
      else { if (cur) len += cur[1] - cur[0]; cur = [a, b]; }
    }
    if (cur) len += cur[1] - cur[0];
    return [wet, len * Math.hypot(P[0], P[1])];
  });
}

/** Zero cells in / across open water; move their share to the last dry, reachable cell on the same bearing (the shore).
 *  Returns {w: normalized weights, removed: share of the probability that was over / across water}. */
export function applyWater(w0, cells, mask) {
  const total = w0.reduce((a, b) => a + b, 0), out = [...w0];
  let removed = 0;
  const sectors = new Map();
  cells.forEach((c, k) => { if (!sectors.has(c.sector)) sectors.set(c.sector, []); sectors.get(c.sector).push(k); });
  for (const ks of sectors.values()) {
    let shore = null;
    for (const k of [...ks].sort((a, b) => cells[a].ring - cells[b].ring)) {
      const [wet, m] = mask[k];
      if (!wet && m <= SWIM_MAX_M) { shore = k; continue; }
      removed += w0[k]; out[k] = 0;
      if (shore != null) out[shore] += w0[k];
    }
  }
  const s = out.reduce((a, b) => a + b, 0);
  return { w: s > 0 ? out.map((x) => x / s) : out, removed: total > 0 ? removed / total : 0 };
}

/** The dry part of a grid cell, for drawing: the cell itself if it's all land, else strips of its n×n sub-cells whose
 *  centers are on land (so no shading is drawn over the water). lakes = lakesXY(hit…). */
export function dryPieces(cell, hit, lakes, n = 5) {
  if (!lakes.length) return [cell.poly];
  const [lat, lon] = hit, r0 = Math.max(cell.r0, 0.5), dr = (cell.r1 - r0) / n, db = (cell.b1 - cell.b0) / n;
  const dry = [];
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const p = xy(lat, lon, [destination(lat, lon, cell.b0 + (b + 0.5) * db, (r0 + (a + 0.5) * dr) * YD)])[0];
    dry.push(!inWater(p, lakes));
  }
  if (dry.every(Boolean)) return [cell.poly];
  const pieces = [];
  for (let a = 0; a < n; a++) {
    let b = 0;
    while (b < n) {
      if (!dry[a * n + b]) { b++; continue; }
      let e = b; while (e + 1 < n && dry[a * n + e + 1]) e++;
      const ra = r0 + a * dr, rb = ra + dr, arc = linspace(cell.b0 + b * db, cell.b0 + (e + 1) * db, 3);
      pieces.push([...arc.map((x) => destination(lat, lon, x, rb * YD)), ...[...arc].reverse().map((x) => destination(lat, lon, x, ra * YD))]);
      b = e + 1;
    }
  }
  return pieces;
}
