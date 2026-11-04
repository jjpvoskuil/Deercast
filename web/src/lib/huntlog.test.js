import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deerText, groupSightings, locate, sessionHours, validation, whereText } from "./huntlog.js";
import { scoreForecast } from "./model/scoring.js";

const fx = JSON.parse(readFileSync(new URL("./huntlog.fixtures.json", import.meta.url)));
const mf = JSON.parse(readFileSync(new URL("./model/fixtures.json", import.meta.url)));

test("a sit split into scored hours", () => {
  const sc = scoreForecast(mf.rows, mf.lat, mf.lon, mf.tz, { rutPeak: mf.rutPeak, start: mf.start });
  const js = sessionHours(fx.start, fx.end, sc, fx.sightings, fx.tz);
  assert.equal(js.length, fx.session.length);
  js.forEach((h, i) => {
    const p = fx.session[i];
    assert.equal(h.hour, p.hour); assert.equal(h.minutes, p.minutes); assert.equal(h.seen, p.seen);
    assert.ok(Math.abs(h.score - p.score) <= 0.1 + 1e-9, `${h.hour} ${h.score} vs ${p.score}`);
  });
});

test("forecast validation stats", () => {
  const v = validation(fx.vh);
  assert.equal(v.nHours, fx.val.n); assert.equal(v.nHunts, fx.val.hunts); assert.equal(v.verdict, fx.val.verdict);
  assert.ok(Math.abs(v.rho - fx.val.rho) < 1e-9, `${v.rho} vs ${fx.val.rho}`);
  v.bands.forEach((b, i) => { assert.ok(Math.abs(b.hours - fx.val.bands[i][1]) < 1e-9); assert.equal(b.seen, fx.val.bands[i][2]); });
});

test("sighting position, grouping and text", () => {
  ["N", "NE", "SSW", "W"].forEach((d, i) => assert.deepEqual(locate(37.3, -86.06, d, 80), fx.locate[i]));
  const g = groupSightings(fx.sightings);
  g.forEach((e, i) => {
    assert.equal(e.group, fx.groups[i][0]); assert.deepEqual(e.deer, fx.groups[i][1]);
    assert.equal(deerText(e.deer), fx.groups[i][2]); assert.equal(whereText(e), fx.groups[i][3]);
  });
});
