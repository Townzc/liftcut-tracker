import assert from "node:assert/strict";
import { test } from "node:test";
import { nextTarget, ruleForExercise, type ActualSet, type ExerciseSession, type ProgressionRule } from "@liftcut/core/progression";

const LB = 0.45359237;
const done = (setIndex: number, weightKg: number | null, reps: number | null): ActualSet => ({ setIndex, status: "done", weightKg, reps });
const day = (date: string, ...sets: ActualSet[]): ExerciseSession => ({ date, sets });
const straight = (date: string, kg: number | null, ...reps: (number | null)[]) => day(date, ...reps.map((r, i) => done(i + 1, kg, r)));
const linear: ProgressionRule = { kind: "linear", sets: 3, reps: 5, load: { increment: 2.5, unit: "kg" } };
const double: ProgressionRule = { kind: "double", sets: 3, minReps: 8, maxReps: 12, load: { increment: 2.5, unit: "kg" } };
const bodyweight: ProgressionRule = { kind: "double", sets: 3, minReps: 8, maxReps: 15, load: "bodyweight" };
const timed: ProgressionRule = { kind: "timed", sets: 2, seconds: 30, incrementSeconds: 5, maxSeconds: 60 };

test("no confirmed history never invents a load", () => {
  const t = nextTarget(linear, []);
  assert.equal(t.outcome, "no_data"); assert.equal(t.weight, null); assert.equal(t.weightKg, null); assert.equal(t.basis, null);
  assert.equal(nextTarget(timed, []).seconds, 30);
  assert.equal(nextTarget(bodyweight, []).reps, 8);
});

test("linear: all sets achieved adds the increment and cites the basis", () => {
  const s = straight("2026-10-01", 60, 5, 5, 6);
  const t = nextTarget(linear, [s]);
  assert.deepEqual([t.outcome, t.weight, t.weightKg, t.reps, t.misses], ["increase", 62.5, 62.5, 5, 0]);
  assert.equal(t.basis, s);
  assert.match(t.why.zh, /60 kg.*62\.5 kg/); assert.match(t.why.en, /60 kg.*62\.5 kg/);
});

test("unknown reps or weight count as not achieved and never advance", () => {
  const ok = straight("2026-10-01", 60, 5, 5, 5);
  const noReps = nextTarget(linear, [ok, straight("2026-10-03", 62.5, 5, null, 5)]);
  assert.deepEqual([noReps.outcome, noReps.weight, noReps.misses, noReps.miss], ["hold", 62.5, 1, { set: 2, reason: "no_reps" }]);
  const noWeight = nextTarget(linear, [ok, day("2026-10-03", done(1, 62.5, 5), done(2, null, 5), done(3, 62.5, 5))]);
  assert.deepEqual([noWeight.weight, noWeight.miss], [62.5, { set: 2, reason: "no_weight" }]);
  // Weight never confirmed at all: no number, no deload counter.
  const unknown = nextTarget(linear, [1, 2, 3].map(d => straight(`2026-10-0${d}`, null, 5, 5, 5)));
  assert.deepEqual([unknown.outcome, unknown.weight, unknown.misses], ["no_data", null, 0]);
  assert.match(unknown.why.zh, /重量未记录.*不推算数字/);
});

test("skipped, missing and voided slots are misses", () => {
  const base = straight("2026-10-01", 60, 5, 5, 5);
  const skip = nextTarget(linear, [base, day("2026-10-03", done(1, 62.5, 5), { setIndex: 2, status: "skipped", weightKg: null, reps: null }, done(3, 62.5, 5))]);
  assert.deepEqual(skip.miss, { set: 2, reason: "skipped" });
  const missing = nextTarget(linear, [base, day("2026-10-03", done(1, 62.5, 5), done(2, 62.5, 5))]);
  assert.deepEqual([missing.weight, missing.miss], [62.5, { set: 3, reason: "missing" }]);
  const voided = nextTarget(linear, [base, day("2026-10-03", done(1, 62.5, 5), done(2, 62.5, 5), { ...done(3, 62.5, 5), status: "voided" })]);
  assert.deepEqual(voided.miss, { set: 3, reason: "missing" });
});

test("short reps or a lighter load hold; three misses in a row deload by 10%", () => {
  const h = [straight("2026-10-01", 100, 5, 5, 5)];
  const short = nextTarget(linear, [...h, straight("2026-10-03", 102.5, 5, 5, 4)]);
  assert.deepEqual([short.outcome, short.weight, short.miss], ["hold", 102.5, { set: 3, reason: "short_reps", got: 4, want: 5 }]);
  const light = nextTarget(linear, [...h, straight("2026-10-03", 100, 5, 5, 5)]);
  assert.deepEqual(light.miss, { set: 1, reason: "light", got: 100, want: 102.5 });
  for (const d of ["03", "05", "07"]) h.push(straight(`2026-10-${d}`, 102.5, 5, 5, 3));
  const deloaded = nextTarget(linear, h);
  // 102.5 × 0.9 = 92.25 rounds down to the 2.5 kg step: a deload is never smaller than asked.
  assert.deepEqual([deloaded.outcome, deloaded.weight, deloaded.misses], ["deload", 90, 0]);
  assert.match(deloaded.why.zh, /连续 3 次未达成.*减载 10% 到 90 kg/);
  const recovered = nextTarget(linear, [...h, straight("2026-10-09", 90, 5, 5, 5)]);
  assert.deepEqual([recovered.outcome, recovered.weight], ["increase", 92.5]);
  const custom = nextTarget({ ...linear, deload: { afterMisses: 2, percent: 20 } }, h.slice(0, 3));
  assert.deepEqual([custom.outcome, custom.weight], ["deload", 80]);
});

test("first session miss sets a baseline; heavier than target progresses from the actual load", () => {
  const first = nextTarget(linear, [straight("2026-10-01", 60, 5, 5, 4)]);
  assert.deepEqual([first.outcome, first.weight, first.misses], ["baseline", 60, 1]);
  const heavier = nextTarget(linear, [straight("2026-10-01", 60, 5, 5, 5), straight("2026-10-03", 65, 5, 5, 5)]);
  assert.equal(heavier.weight, 67.5);
});

test("pounds: stored kilograms convert without drift and increments stay in lb", () => {
  const lb: ProgressionRule = { ...linear, load: { increment: 5, unit: "lb" } };
  const t = nextTarget(lb, [straight("2026-10-01", 135 * LB, 5, 5, 5)]);
  assert.deepEqual([t.weight, t.unit, t.weightKg], [140, "lb", 63.503]);
  assert.match(t.why.en, /135 lb.*add 5 lb to 140 lb/);
  const misses = [1, 3, 5].map(d => straight(`2026-10-0${d}`, 135 * LB, 5, 5, 4));
  assert.deepEqual([nextTarget(lb, misses).outcome, nextTarget(lb, misses).weight], ["deload", 120]);
});

test("double progression builds reps, then adds load; more than 12 reps still counts", () => {
  const building = nextTarget(double, [straight("2026-10-01", 40, 10, 9, 9)]);
  assert.deepEqual([building.outcome, building.weight, building.reps, building.repRange], ["progress_reps", 40, 10, [8, 12]]);
  const top = nextTarget(double, [straight("2026-10-01", 40, 10, 9, 9), straight("2026-10-03", 40, 15, 14, 13)]);
  assert.deepEqual([top.outcome, top.weight, top.reps], ["increase", 42.5, 8]);
  const below = nextTarget(double, [straight("2026-10-01", 40, 10, 9, 7)]);
  assert.deepEqual([below.outcome, below.miss?.reason], ["baseline", "short_reps"]);
});

test("bodyweight progresses reps only and never infers an added load", () => {
  const t = nextTarget(bodyweight, [straight("2026-10-01", null, 10, 9, 8)]);
  assert.deepEqual([t.outcome, t.weight, t.weightKg, t.unit, t.reps], ["progress_reps", null, null, null, 9]);
  const capped = nextTarget(bodyweight, [straight("2026-10-01", null, 20, 18, 16)]);
  assert.deepEqual([capped.outcome, capped.reps, capped.weight], ["top_of_range", 15, null]);
  assert.match(capped.why.zh, /重量不自动推算/);
  const missed = [1, 3, 5].map(d => straight(`2026-10-0${d}`, null, 10, 6, null));
  assert.deepEqual([nextTarget(bodyweight, missed).outcome, nextTarget(bodyweight, missed).reps], ["deload", 8]);
});

test("timed sets add seconds up to the ceiling and deload on repeated misses", () => {
  const hold = (date: string, ...seconds: (number | null)[]) => day(date, ...seconds.map((s, i) => ({ ...done(i + 1, null, null), seconds: s })));
  assert.deepEqual([nextTarget(timed, [hold("2026-10-01", 30, 32)]).seconds, nextTarget(timed, [hold("2026-10-01", 30, 32)]).outcome], [35, "increase"]);
  const missed = nextTarget(timed, [hold("2026-10-01", 30, null)]);
  assert.deepEqual([missed.outcome, missed.seconds, missed.miss], ["hold", 30, { set: 2, reason: "no_seconds" }]);
  const climbed = nextTarget(timed, ["01", "02", "03"].map(d => hold(`2026-10-${d}`, 60, 60)));
  assert.equal(climbed.seconds, 45);
  const deload = nextTarget({ ...timed, seconds: 40 }, ["01", "02", "03"].map(d => hold(`2026-10-${d}`, 20, 20)));
  assert.deepEqual([deload.outcome, deload.seconds], ["deload", 35]);
  const ceiling = nextTarget({ ...timed, seconds: 60 }, [hold("2026-10-01", 61, 60)]);
  assert.deepEqual([ceiling.outcome, ceiling.seconds], ["top_of_range", 60]);
});

test("pure history fold: input order does not matter and a corrected record changes the target", () => {
  const h = [straight("2026-10-01", 60, 5, 5, 5), straight("2026-10-03", 62.5, 5, 5, 4), straight("2026-10-05", 62.5, 5, 5, 5)];
  assert.deepEqual(nextTarget(linear, [...h].reverse()), nextTarget(linear, h));
  assert.equal(nextTarget(linear, h).weight, 65);
  const corrected = [h[0], h[1], straight("2026-10-05", 62.5, 5, 5, 3)];
  assert.deepEqual([nextTarget(linear, corrected).weight, nextTarget(linear, corrected).misses], [62.5, 2]);
});

test("every outcome explains itself in both languages without leaking empty values", () => {
  const cases: [ProgressionRule, ExerciseSession[]][] = [
    [linear, []], [linear, [straight("2026-10-01", 60, 5, 5, 4)]], [linear, [straight("2026-10-01", 60, 5, 5, 5)]],
    [double, [straight("2026-10-01", 40, 10, 9, 9)]], [bodyweight, [straight("2026-10-01", null, 15, 15, 15)]],
    [timed, []], [timed, [day("2026-10-01", { ...done(1, null, null), seconds: 31 }, { ...done(2, null, null), seconds: 30 })]],
    [linear, ["01", "02", "03"].map(d => straight(`2026-10-${d}`, 60, 5, 5, 4))],
  ];
  for (const [rule, history] of cases) {
    const { why } = nextTarget(rule, history);
    for (const text of [why.zh, why.en]) assert.ok(text.length > 10 && !/undefined|null|NaN|Infinity/.test(text), text);
  }
});

test("prescription rep ranges map to rules; unparseable prescriptions get no automatic target", () => {
  assert.deepEqual(ruleForExercise({ sets: 3, repRange: "5" }), { kind: "linear", sets: 3, reps: 5, load: { increment: 2.5, unit: "kg" } });
  for (const repRange of ["8-12", "8–12", " 8 ~ 12 次", "8到12"])
    assert.deepEqual(ruleForExercise({ sets: 4, repRange }), { kind: "double", sets: 4, minReps: 8, maxReps: 12, load: { increment: 2.5, unit: "kg" } });
  assert.deepEqual(ruleForExercise({ sets: 2, repRange: "10-15" }, { bodyweight: true }), { kind: "double", sets: 2, minReps: 10, maxReps: 15, load: "bodyweight" });
  assert.deepEqual(ruleForExercise({ sets: 3, repRange: "5" }, { unit: "lb" })?.kind === "linear" && ruleForExercise({ sets: 3, repRange: "5" }, { unit: "lb" }), { kind: "linear", sets: 3, reps: 5, load: { increment: 5, unit: "lb" } });
  for (const repRange of ["AMRAP", "30s", "12-8", "0", "", "5x5"]) assert.equal(ruleForExercise({ sets: 3, repRange }), null, repRange);
  assert.equal(ruleForExercise({ sets: 0, repRange: "5" }), null);
});
