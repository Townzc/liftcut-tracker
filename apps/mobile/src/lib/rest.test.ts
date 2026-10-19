import assert from "node:assert/strict";
import { test } from "node:test";
import { clock, extendRest, remaining, startRest, validPreset } from "./rest";

test("rest time follows the wall clock, never exceeds the total and never goes negative", () => {
  const run = startRest(90, 1_000);
  assert.deepEqual([remaining(run, 1_000), remaining(run, 31_500), remaining(run, 91_000), remaining(run, 500_000)], [90, 60, 0, 0]);
  assert.equal(remaining(run, 0), 90); // A stale clock reading cannot show more than the chosen rest.
  const longer = extendRest(run);
  assert.deepEqual([longer.total, remaining(longer, 91_000)], [120, 30]);
  assert.deepEqual([clock(90), clock(5), clock(0)], ["01:30", "00:05", "00:00"]);
  assert.deepEqual([validPreset("120"), validPreset(45), validPreset(null)], [120, 90, 90]);
});
