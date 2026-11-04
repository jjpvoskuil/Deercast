// Shot & recovery must agree with the Python (fixtures: python web/supabase/make_shot_fixtures.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, standAngle, trace } from "./shot.js";
import { featureDistances, habitatMultiplier, searchGrid, weightCells } from "./recovery.js";

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

test("stand angle", () => fx.angles.forEach(([h, d, a]) => close(standAngle(h, d), a, 1e-9)));
