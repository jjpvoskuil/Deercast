import { test } from "node:test";
import assert from "node:assert/strict";
import { deerText, groupSightings } from "./huntlog.js";
import { rowAt, shotRun, shotSighting, sitHours, startHourIdx } from "./huntmap.js";

const hunt = { sightings: [
  { group: "a", kind: "Doe", count: 2, time: "2026-11-08T07:10:00-06:00", lat: 37.1, lon: -86.1, came_from: "N", went_to: "S" },
  { group: "b", kind: "Buck", count: 1, time: "2026-11-08T07:40:00-06:00", lat: 37.2, lon: -86.2, went_to: "NE" },
] };

test("hunt map: the shot is matched to its 'Deer seen' entry", () => {
  const buck = deerText(groupSightings(hunt.sightings)[1].deer);
  assert.equal(shotSighting(hunt, { deer: buck }).group, "b");
  assert.equal(shotSighting(hunt, { deer: "" }), null);
  assert.equal(shotSighting(hunt, { deer: "7 fawns" }), null);
});

test("hunt map: where the shot deer went — hit pin / analysis / sighting, ran direction else 'went toward'", () => {
  const sight = groupSightings(hunt.sightings)[1];
  let r = shotRun({ from_lat: 37, from_lon: -86, hit_lat: 37.01, hit_lon: -86.01, input: { ran: "ESE" } }, sight);
  assert.deepEqual(r.hit, [37.01, -86.01]); assert.equal(r.hitSource, "analysis");
  assert.equal(r.bearing, 112.5); assert.equal(r.source, "analysis"); assert.deepEqual(r.from, [37, -86]);
  r = shotRun({ pins: [{ kind: "hit", lat: 1, lon: 2 }], hit_lat: 3, hit_lon: 4, ran: "Unknown" }, sight, [9, 9]);
  assert.deepEqual(r.hit, [1, 2]); assert.equal(r.hitSource, "pin");
  assert.equal(r.bearing, 45); assert.equal(r.dir, "NE"); assert.equal(r.source, "sighting"); assert.deepEqual(r.from, [9, 9]);
  r = shotRun({}, sight);
  assert.deepEqual(r.hit, [37.2, -86.2]); assert.equal(r.hitSource, "sighting");
  r = shotRun({});
  assert.equal(r.hit, null); assert.equal(r.bearing, null);
});

test("hunt map: wind slider hours and the hour it opens on", () => {
  const s = Date.parse("2026-11-08T06:20:00-06:00"), e = Date.parse("2026-11-08T09:05:00-06:00");
  const hrs = sitHours(s, e);
  assert.equal(hrs.length, 4); assert.equal(hrs[0], Date.parse("2026-11-08T06:00:00-06:00"));
  assert.equal(sitHours(s, s).length, 1);
  assert.equal(startHourIdx(hrs, [], hunt.sightings), 1);
  assert.equal(startHourIdx(hrs, [{ time: "2026-11-08 08:15" , time_iso: "2026-11-08T14:15:00.000Z" }], hunt.sightings), 2);
  assert.equal(startHourIdx(hrs), 0);
  const rows = [{ time: hrs[0], wind_dir: 10 }, { time: hrs[1], wind_dir: 20 }];
  assert.equal(rowAt(rows, hrs[1] + 10 * 60e3).wind_dir, 20);
  assert.equal(rowAt(rows, hrs[3]), null);
});
