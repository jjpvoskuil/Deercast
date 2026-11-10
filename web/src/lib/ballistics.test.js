import { test } from "node:test";
import assert from "node:assert/strict";
import { atRange, energy, gunTable } from "./ballistics.js";

test("energy formula", () => { assert.equal(Math.round(energy(168, 2700)), 2719); });

test("308 Win 168 gr, BC .462, 2700 fps, 100 yd zero, 1.5 in sight — close to published G1 tables", () => {
  const t = gunTable({ type: "Rifle", gr: 168, fps: 2700, bc: 0.462, zero_yd: 100, sight_in: 1.5 });
  const r = Object.fromEntries(t.rows.map((x) => [x.yd, x]));
  assert.ok(Math.abs(r[100].dropIn) < 0.05, "zeroed at 100");
  // Federal Gold Medal 168 gr SMK (BC .462) lists 2650 → 2101 fps at 300 yd (−549); same loss from 2700 ≈ 2150
  assert.ok(r[300].fps > 2100 && r[300].fps < 2200, `300 yd velocity ${r[300].fps}`);
  assert.ok(r[200].dropIn < -2.8 && r[200].dropIn > -4.5, `200 yd drop ${r[200].dropIn}`); // ≈ −3.6
  assert.ok(r[300].dropIn < -11.5 && r[300].dropIn > -15.5, `300 yd drop ${r[300].dropIn}`); // ≈ −13.5
  assert.ok(r[25].dropIn < 0 && r[50].dropIn > -1, "below the line close in");
  assert.equal(t.maxDeerYd, 300);
});

test("12 ga slug runs out of energy and drops fast", () => {
  const t = gunTable({ type: "Shotgun slug", gr: 437, fps: 1600, bc: 0.1, zero_yd: 75, sight_in: 1 }, [50, 100, 150]);
  const r = Object.fromEntries(t.rows.map((x) => [x.yd, x]));
  assert.ok(r[150].dropIn < -8, `150 yd drop ${r[150].dropIn}`);
  assert.ok(r[100].ftlb < energy(437, 1600));
  assert.ok(atRange({ type: "Rifle", gr: 150, fps: 2800, bc: 0.4 }, 120).ftlb > 1500);
});
