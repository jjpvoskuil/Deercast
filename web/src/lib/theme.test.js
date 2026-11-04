import { test } from "node:test";
import assert from "node:assert/strict";
import { autoTheme, resolveTheme } from "./theme.js";

const LAT = 37.3006, LON = -86.0608; // Cub Run; Nov 4 2026 sunrise ≈ 6:12 CST, sunset ≈ 4:43 CST
const at = (iso) => new Date(iso);

test("dark before sunrise+30, light midday, dark from sunset-30", () => {
  assert.equal(autoTheme(LAT, LON, at("2026-11-04T12:30:00Z")).theme, "dark");   // 6:30 AM
  assert.equal(autoTheme(LAT, LON, at("2026-11-04T12:50:00Z")).theme, "light");  // 6:50 AM
  assert.equal(autoTheme(LAT, LON, at("2026-11-04T22:00:00Z")).theme, "light");  // 4:00 PM
  assert.equal(autoTheme(LAT, LON, at("2026-11-04T22:20:00Z")).theme, "dark");   // 4:20 PM
  assert.equal(autoTheme(LAT, LON, at("2026-11-05T03:00:00Z")).theme, "dark");   // 9 PM
});

test("next switch times", () => {
  const a = autoTheme(LAT, LON, at("2026-11-04T18:00:00Z"));
  assert.ok(Math.abs(a.next - at("2026-11-04T22:13:09Z")) < 120e3, a.next.toISOString());
  const b = autoTheme(LAT, LON, at("2026-11-05T03:00:00Z")); // 9 PM → tomorrow sunrise+30
  assert.ok(b.next > at("2026-11-05T12:30:00Z") && b.next < at("2026-11-05T12:55:00Z"), b.next.toISOString());
});

test("manual override lasts until the next automatic switch, 'always' sticks", () => {
  const noon = at("2026-11-04T18:00:00Z");
  const until = autoTheme(LAT, LON, noon).next.getTime();
  assert.equal(resolveTheme({ mode: "dark", until }, LAT, LON, noon).theme, "dark");
  assert.equal(resolveTheme({ mode: "dark", until }, LAT, LON, at("2026-11-04T22:30:00Z")).manual, false);
  assert.equal(resolveTheme({ mode: "light", until: null }, LAT, LON, at("2026-11-05T03:00:00Z")).theme, "light");
  assert.equal(resolveTheme({ mode: "auto" }, LAT, LON, noon).theme, "light");
});
