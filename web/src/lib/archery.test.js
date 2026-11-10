import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { flightTime, summary } from "./archery.js";

const cases = JSON.parse(readFileSync(new URL("./archery.fixtures.json", import.meta.url)));
test("bow math matches the Python", () => {
  for (const [s, py, ft] of cases) {
    const js = summary(s);
    for (const [a, b] of [["fps", "fps"], ["ke", "ke"], ["momentum", "momentum"], ["effMomentum", "eff_momentum"]]) assert.ok(Math.abs(js[a] - py[b]) < 1e-9, `${a} ${s.bow_type}`);
    assert.equal(js.bone, py.bone); assert.equal(js.keClass, py.ke_class);
    [10, 20, 30, 40].forEach((y, i) => assert.ok(Math.abs(flightTime(js.fps, y) - ft[i]) < 1e-9));
  }
});

test("FOC: balance ahead of the middle, as a % of length", async () => {
  const { foc, focClass } = await import("./archery.js");
  assert.equal(foc(28, 17.5).toFixed(1), "12.5"); // (17.5 − 14) / 28
  assert.equal(foc(29, 14.5), 0);
  assert.equal(foc(28, 0), null); assert.equal(foc(28, 30), null);
  assert.equal(focClass(12.5), "Good for hunting"); assert.equal(focClass(20), "Extreme FOC (19%+)");
});
