// Shot & recovery must agree with the Python (fixtures: python web/supabase/make_shot_fixtures.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { classify, standAngle, trace } from "./shot.js";
import { applyWater, bundledWater, dryPieces, lakesXY, featureDistances, habitatMultiplier, mergeFeatures, parseOsm, searchGrid, waterMask, weightCells } from "./recovery.js";
import { readFileSync } from "node:fs";

const fx = JSON.parse(readFileSync(new URL("./shot.fixtures.json", import.meta.url)));
const close = (a, b, t = 1e-6) => assert.ok(Math.abs(a - b) <= t, `${a} vs ${b}`);

test("arrow path through the anatomy + classification (every point, angle and weapon)", () => {
  for (const [sx, sy, yaw, pitch, ee, hits, p, s, notes, p2, s2] of fx.traces) {
    const r = trace(sx, sy, yaw, pitch);
    assert.equal(r.missed, ee === null, `${sx},${sy} ${yaw}/${pitch}`);
    if (ee) { r.entry.forEach((v, i) => close(v, ee[0][i])); r.exit.forEach((v, i) => close(v, ee[1][i])); }
    assert.deepEqual(r.hits.map((h) => h.key), hits.map((h) => h[0]), `${sx},${sy} ${yaw}/${pitch}`);
    r.hits.forEach((h, i) => { close(h.tIn, hits[i][1]); close(h.tOut, hits[i][2]); assert.equal(h.afterBone, hits[i][3]); });
    assert.deepEqual(classify(r, "Bow"), [p, s, notes]);
    const [q, q2] = classify(r, "Rifle / shotgun slug");
    assert.equal(q, p2); assert.equal(q2, s2);
  }
});

test("search map: grid, weights, water/cover distances", () => {
  for (const c of fx.rec) {
    const cells = searchGrid(37.29, -86.04, c.yards, c.run);
    cells.forEach((x, i) => { close(x.center[0], c.centers[i][0], 1e-9); close(x.center[1], c.centers[i][1], 1e-9); close(x.dist_yd, c.dist[i]); close(x.bearing, c.bearing[i]); });
    weightCells(cells, c.yards, c.run, c.elev, 200, 0.5).forEach((x, i) => close(x, c.w[i], 1e-12));
    const fd = featureDistances(cells, 37.29, -86.04, c.osm, c.marks);
    fd.forEach((d, i) => d.forEach((x, j) => (c.fd[i][j] === null ? assert.ok(!Number.isFinite(x)) : close(x, c.fd[i][j], 1e-6))));
    habitatMultiplier(fd, 1.2, 1.4).forEach((x, i) => close(x, c.hab[i], 1e-9));
  }
});

test("search map: open water is a no-go, no swimming, bundled Nolin (parity with Python)", () => {
  const nolin = JSON.parse(readFileSync(new URL("../../public/data/nolin_water.json", import.meta.url)));
  const deep = (a, b, eps = 1e-9) => {
    if (b === null) return assert.ok(a === null || !Number.isFinite(a));
    if (typeof b === "number") return close(a, b, eps);
    if (Array.isArray(b)) { assert.equal(a.length, b.length); return b.forEach((x, i) => deep(a[i], x, eps)); }
    if (typeof b === "object") return Object.keys(b).forEach((k) => deep(a[k], b[k], eps));
    assert.equal(a, b);
  };
  assert.equal(fx.water.length, 7);
  for (const c of fx.water) {
    const osm = c.elements ? parseOsm(c.elements) : null;
    if (osm) deep(osm, c.parsed, 0);
    const feats = mergeFeatures(osm, c.bundled ? bundledWater(c.hit[0], c.hit[1], nolin) : null);
    const cells = searchGrid(c.hit[0], c.hit[1], c.yards, c.run);
    let w = weightCells(cells, c.yards, c.run, null, null, 0);
    const fd = featureDistances(cells, c.hit[0], c.hit[1], feats, c.marks);
    deep(fd, c.fd, 1e-6);
    const hm = habitatMultiplier(fd, 1.2, 1.4); w = w.map((x, i) => x * hm[i]); const s = w.reduce((a, b) => a + b, 0); w = w.map((x) => x / s);
    deep(w, c.w, 1e-9);
    const mask = waterMask(cells, c.hit[0], c.hit[1], feats);
    mask.forEach(([wet, m], i) => { assert.equal(wet, c.mask[i][0], `${c.name} cell ${i} wet`); close(m, c.mask[i][1], 1e-6); });
    const r = applyWater(w, cells, mask);
    deep(r.w, c.w2, 1e-9); close(r.removed, c.removed, 1e-9);
    r.w.forEach((x, i) => { if (mask[i][0]) assert.equal(x, 0, `${c.name}: probability left in the water`); });
  }
  assert.equal(bundledWater(37.30, -85.90, nolin), null);
  // drawing: wet cells draw nothing, dry cells draw themselves, shore cells draw only their dry strips
  const c = fx.water[0], feats = parseOsm(c.elements), cells = searchGrid(c.hit[0], c.hit[1], c.yards, c.run), lakes = lakesXY(c.hit[0], c.hit[1], feats);
  const mask = waterMask(cells, c.hit[0], c.hit[1], feats);
  const kinds = cells.map((cell) => { const p = dryPieces(cell, c.hit, lakes); return p.length === 0 ? "wet" : p[0] === cell.poly ? "dry" : "shore"; });
  assert.ok(kinds.includes("wet") && kinds.includes("dry") && kinds.includes("shore"));
  kinds.forEach((k, i) => { if (k === "dry") assert.equal(mask[i][0], false); });
});

test("stand angle", () => fx.angles.forEach(([h, d, a]) => close(standAngle(h, d), a, 1e-9)));
