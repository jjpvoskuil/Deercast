// The JavaScript model must agree with the Python one (fixtures: python web/supabase/make_model_fixtures.py).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scoreForecast, bestWindows } from "./scoring.js";
import { dailyAstro } from "./astro.js";
import { rank } from "./beststand.js";
import { peakFor, rutPeakFor } from "./rut.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url)));
const scored = scoreForecast(fx.rows, fx.lat, fx.lon, fx.tz, { rutPeak: fx.rutPeak, start: fx.start });
const MIN = 60000;

test("sun & moon within 2 minutes", () => {
  const a = dailyAstro(fx.lat, fx.lon, Object.keys(fx.astro), fx.tz);
  for (const [k, p] of Object.entries(fx.astro)) {
    assert.ok(Math.abs(a[k].sunrise - p.sunrise) < 2 * MIN, k);
    assert.ok(Math.abs(a[k].sunset - p.sunset) < 2 * MIN, k);
    assert.ok(Math.abs(a[k].moonIllum - p.illum) < 0.01, k);
    assert.equal(a[k].moonName, p.name, k);
    assert.equal(a[k].majors.length, p.majors.length, k);
    a[k].majors.sort((x, y) => x - y).forEach((t, i) => assert.ok(Math.abs(t - p.majors[i]) < 3 * MIN, k));
    a[k].minors.sort((x, y) => x - y).forEach((t, i) => assert.ok(Math.abs(t - p.minors[i]) < 3 * MIN, k));
  }
});

test("every hour: same factors and score", () => {
  assert.equal(scored.length, fx.scored.length);
  let maxDiff = 0;
  scored.forEach((r, i) => {
    const p = fx.scored[i];
    assert.equal(r.time, p.time); assert.equal(r.date, p.date); assert.equal(r.legal, p.legal, new Date(r.time).toISOString());
    for (const f of ["f_season", "f_temp", "f_pressure", "f_wind", "f_precip", "f_cloud"]) assert.ok(Math.abs(r[f] - p[f]) < 1e-9, f);
    for (const f of ["f_diel", "f_solunar"]) assert.ok(Math.abs(r[f] - p[f]) < 0.01, `${f} ${r[f]} vs ${p[f]}`);
    assert.ok(Math.abs(r.sun_alt - p.sun_alt) < 0.05, "sun_alt");
    maxDiff = Math.max(maxDiff, Math.abs(r.score - p.score));
  });
  assert.ok(maxDiff <= 0.1 + 1e-9, `max score difference ${maxDiff}`);
});

test("best windows", () => {
  const d = bestWindows(scored);
  assert.equal(d.length, fx.days.length);
  d.forEach((x, i) => { assert.equal(x.date, fx.days[i].date); assert.ok(Math.abs(x.bestScore - fx.days[i].bestScore) <= 0.1 + 1e-9); });
});

test("best stand ranking", () => {
  const day = scored.filter((r) => r.date === fx.day2);
  for (const s of ["Morning", "Evening"]) {
    const js = rank(fx.stands, day, s, fx.hunts, fx.slopes);
    assert.deepEqual(js.map((r) => r.stand.id), fx.best[s].map((r) => r.id), s);
    js.forEach((r, i) => {
      const p = fx.best[s][i];
      assert.ok(Math.abs(r.score - p.score) < 0.1, `${s} ${r.score} vs ${p.score}`);
      assert.ok(Math.abs(r.fit - p.fit) < 1e-9 && Math.abs(r.history - p.history) < 1e-9);
      assert.deepEqual(r.reasons, p.reasons);
    });
  }
});

test("rut dates", () => {
  for (const [st, la, lo, [m, d]] of fx.ruts) { const r = peakFor(st, la, lo); assert.deepEqual([r.month, r.day], [m, d], st); }
  for (const [d, st, e] of fx.peaks) assert.equal(rutPeakFor(d, 37.3, -86, st), e, `${d} ${st}`);
});
