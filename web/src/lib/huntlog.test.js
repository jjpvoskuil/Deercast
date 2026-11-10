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

test("trail-camera sightings count toward seen and credit the stand they're next to", async () => {
  const { historyRates } = await import("./model/beststand.js");
  const sc = scoreForecast(mf.rows, mf.lat, mf.lon, mf.tz, { rutPeak: mf.rutPeak, start: mf.start });
  const base = sessionHours(fx.start, fx.end, sc, fx.sightings, fx.tz, "Stand: A");
  assert.ok(base.every((h) => !("at" in h)));
  const cam = fx.sightings.map((s) => ({ ...s, source: "camera", camera: "Creek cam", near: "Stand: B" }));
  const far = fx.sightings.map((s) => ({ ...s, source: "camera", camera: "Field cam" }));
  const hrs = sessionHours(fx.start, fx.end, sc, [...fx.sightings, ...cam, ...far], fx.tz, "Stand: A");
  hrs.forEach((h, i) => { assert.equal(h.seen, base[i].seen * 3); assert.equal(h.at["Stand: A"] || 0, base[i].seen); assert.equal(h.at["Stand: B"] || 0, base[i].seen); });
  const hunts = [{ stand: "Stand: A", cam_stands: ["Stand: B"], hours: hrs }];
  const iso = (x) => +String(x).slice(11, 13);
  const tot = base.filter((h) => iso(h.hour) >= 12).reduce((n, h) => n + h.seen, 0);
  assert.equal(historyRates(hunts, "Stand: A", "Evening", iso)[0], tot);
  assert.equal(historyRates(hunts, "Stand: B", "Evening", iso)[0], tot);
  assert.deepEqual(historyRates(hunts, "Stand: C", "Evening", iso), [0, 0]);
  assert.equal(groupSightings(cam)[0].source, "camera");
});
