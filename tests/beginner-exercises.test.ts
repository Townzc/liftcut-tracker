import assert from "node:assert/strict";
import test from "node:test";

import {
  beginnerExercises,
  filterBeginnerExercises,
} from "../src/lib/beginner-exercises";

test("beginner demo keeps source IDs unique", () => {
  const ids = beginnerExercises.map((exercise) => exercise.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("filters by focus", () => {
  const results = filterBeginnerExercises(beginnerExercises, "", "core");
  assert.ok(results.length > 0);
  assert.ok(results.every((exercise) => exercise.focus === "core"));
});

test("searches Chinese and English labels", () => {
  assert.deepEqual(
    filterBeginnerExercises(beginnerExercises, "墙壁", "all").map((exercise) => exercise.id),
    ["0659"],
  );
  assert.deepEqual(
    filterBeginnerExercises(beginnerExercises, "bridge", "all").map((exercise) => exercise.id),
    ["3013"],
  );
});

test("combines query and focus filters", () => {
  assert.deepEqual(
    filterBeginnerExercises(beginnerExercises, "push-up", "lower"),
    [],
  );
});
