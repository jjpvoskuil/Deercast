import { test } from "node:test";
import assert from "node:assert/strict";
import { allPaths, fitSize, photoPath, thumbPath } from "./photos.js";

test("photos: storage paths start with ground / owner (what the storage rules check)", () => {
  assert.equal(photoPath("g1", " John@Example.com ", "ab12"), "g1/john@example.com/ab12.jpg");
  assert.equal(photoPath(null, "a@b.c", "x", true), "none/a@b.c/x_t.jpg");
  assert.equal(thumbPath("g1/a@b.c/x.jpg"), "g1/a@b.c/x_t.jpg");
  assert.deepEqual(allPaths([{ path: "g/a/1.jpg" }]), ["g/a/1.jpg", "g/a/1_t.jpg"]);
  assert.deepEqual(allPaths(undefined), []);
});

test("photos: shrink keeps the shape and never enlarges", () => {
  assert.deepEqual(fitSize(4032, 3024, 1600), [1600, 1200]);
  assert.deepEqual(fitSize(3024, 4032, 360), [270, 360]);
  assert.deepEqual(fitSize(800, 600, 1600), [800, 600]);
});
