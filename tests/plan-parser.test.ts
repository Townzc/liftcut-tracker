import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePlanText, ENGLISH_PLAN_TEXT_TEMPLATE, CHINESE_PLAN_TEXT_TEMPLATE } from "../src/lib/plan-parser";

test("parsePlanText returns error for empty input", () => {
  const result = parsePlanText("");
  assert.equal(result.draft, null);
  assert.ok(result.errors.length > 0);
  assert.equal(result.errors[0].reason, "empty_input");
});

test("parsePlanText returns error for whitespace-only input", () => {
  const result = parsePlanText("   \n  \n  ");
  assert.equal(result.draft, null);
  assert.ok(result.errors.length > 0);
});

test("parsePlanText parses English template successfully", () => {
  const result = parsePlanText(ENGLISH_PLAN_TEXT_TEMPLATE);
  assert.ok(result.draft !== null, "should produce a draft");
  assert.equal(result.errors.length, 0, "should have no errors");
  assert.ok(result.draft!.weeks.length > 0, "should have weeks");
  assert.ok(result.draft!.weeks[0].days.length > 0, "should have days");
  assert.ok(result.draft!.weeks[0].days[0].exercises.length > 0, "should have exercises");
});

test("parsePlanText parses Chinese template successfully", () => {
  const result = parsePlanText(CHINESE_PLAN_TEXT_TEMPLATE);
  assert.ok(result.draft !== null, "should produce a draft");
  assert.equal(result.errors.length, 0, "should have no errors");
  assert.ok(result.draft!.weeks.length > 0, "should have weeks");
});

test("parsePlanText extracts exercise fields correctly", () => {
  const input = `Week 1
Day 1
Bench Press 4 x 5 RPE 7`;
  const result = parsePlanText(input);
  assert.ok(result.draft !== null);
  const exercise = result.draft!.weeks[0].days[0].exercises[0];
  assert.equal(exercise.name, "Bench Press");
  assert.equal(exercise.sets, 4);
  assert.equal(exercise.repRange, "5");
  assert.equal(exercise.targetRpe, 7);
});

test("parsePlanText handles rep ranges", () => {
  const input = `Week 1
Day 1
Incline DB Press 3 x 8-10 RPE 8`;
  const result = parsePlanText(input);
  assert.ok(result.draft !== null);
  const exercise = result.draft!.weeks[0].days[0].exercises[0];
  assert.equal(exercise.repRange, "8-10");
});

test("parsePlanText defaults RPE to 7 when missing", () => {
  const input = `Week 1
Day 1
Squat 3 x 5`;
  const result = parsePlanText(input);
  assert.ok(result.draft !== null);
  const exercise = result.draft!.weeks[0].days[0].exercises[0];
  assert.equal(exercise.targetRpe, 7);
  assert.ok(result.warnings.length > 0, "should have RPE missing warning");
});

test("parsePlanText handles multiple weeks and days", () => {
  const input = `Week 1
Day 1
Bench Press 4 x 5 RPE 7

Day 2
Squat 3 x 6 RPE 6

Week 2
Day 1
Deadlift 3 x 5 RPE 7`;
  const result = parsePlanText(input);
  assert.ok(result.draft !== null);
  assert.equal(result.draft!.weeks.length, 2);
  assert.equal(result.draft!.weeks[0].days.length, 2);
  assert.equal(result.draft!.weeks[1].days.length, 1);
});

test("parsePlanText uses custom plan name", () => {
  const input = `Week 1
Day 1
Bench Press 4 x 5 RPE 7`;
  const result = parsePlanText(input, "My Custom Plan");
  assert.ok(result.draft !== null);
  assert.equal(result.draft!.name, "My Custom Plan");
});

test("parsePlanText handles notes after exercise", () => {
  const input = `Week 1
Day 1
Bench Press 4 x 5 RPE 7 # focus on form`;
  const result = parsePlanText(input);
  assert.ok(result.draft !== null);
  const exercise = result.draft!.weeks[0].days[0].exercises[0];
  assert.ok(exercise.notes.length > 0, "should capture notes");
});
