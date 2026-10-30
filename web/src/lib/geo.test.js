// Parity with the Python model: node --test src/lib/   (fixtures from web/supabase/make_fixtures.py)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { destination, scentCone, driftCone, windOkForStand, degToCardinal } from "./geo.js";
import { slopeFrom, combine, describe, gridSlopes, thermalPhase } from "./terrain.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url)));
const close = (a, b, tol = 1e-7) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
const closePts = (A, B) => { assert.equal(A.length, B.length); A.forEach((p, i) => { close(p[0], B[i][0]); close(p[1], B[i][1]); }); };

test("destination", () => fx.dest.forEach(([la, lo, b, d, ela, elo]) => { const [a, c] = destination(la, lo, b, d); close(a, ela); close(c, elo); }));
test("scent cone", () => fx.cone.forEach(([w, m, pts]) => closePts(scentCone(37.3, -86.06, w, m, 0.66), pts)));
test("drift cone", () => fx.drift.forEach(([b, m, x, pts]) => closePts(driftCone(37.3, -86.06, b, m, x), pts)));
test("good wind", () => fx.ok.forEach(([w, g, e]) => assert.equal(windOkForStand(w, g), e)));
test("cardinal", () => fx.card.forEach(([d, e]) => assert.equal(degToCardinal(d), e)));
test("slope", () => fx.slope.forEach(([e, s, u]) => { const [a, b] = slopeFrom(e); close(a, s); close(b, u); }));
test("combine + describe", () => fx.combine.forEach(([a, c], i) => {
  const j = combine(...a);
  for (const [py, js] of [["to_bearing", "toBearing"], ["mph", "mph"], ["thermal_mph", "thermalMph"], ["influence", "influence"], ["extra_half", "extraHalf"]]) close(j[js], c[py]);
  assert.equal(j.switching, c.switching);
  assert.equal(describe(j), fx.describe[i][1]);
}));
test("grid slopes", () => {
  const [E, S, U] = fx.grid; const g = gridSlopes(E, 120);
  g.forEach((row, r) => row.forEach(([s, u], c) => { close(s, S[r][c]); close(u, U[r][c]); }));
});
test("thermal phase (sun position vs PyEphem)", () => fx.phase.forEach(([ms, ph, st]) => {
  const [p, s] = thermalPhase(37.3, -86.06, new Date(ms));
  assert.equal(p, ph, new Date(ms).toISOString()); close(s, st, 0.02);
}));
