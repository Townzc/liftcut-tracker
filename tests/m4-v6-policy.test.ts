import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildV4 } from "../research/m4-parser/scripts/build-v4";
import { buildV6 } from "../research/m4-parser/scripts/build-v6";
import { mentionedIds, trainingPolicyProblems, repairAliases } from "../research/m4-parser/src/training-policy-v6";
import { identifyExercise } from "@liftcut/core/exercise-catalog";
import type { Item } from "../research/m4-parser/src/synth";

const parse = (s: string): Item[] => s.trim().split("\n").map(s => JSON.parse(s));
const old = buildV4(), built = buildV6();
const original = parse(old.files["train.gold.jsonl"]), control = parse(built.files["T-train.gold.jsonl"]), candidate = parse(built.files["S-train.gold.jsonl"]);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const clone = (r: Item) => structuredClone(r);

test("registry aliases respect exact identity, longest mention and token boundaries", () => {
  assert.deepEqual(mentionedIds("卧推"), ["barbell-bench"]);
  assert.deepEqual(mentionedIds("bench press"), ["barbell-bench"]);
  assert.deepEqual(mentionedIds("哑铃卧推"), ["dumbbell-bench"]);
  assert.deepEqual(mentionedIds("Dumbbell bench press"), ["dumbbell-bench"]);
  assert.deepEqual(mentionedIds("bench pressure"), []);
  assert.deepEqual(mentionedIds("卧推 + 哑铃卧推"), ["barbell-bench", "dumbbell-bench"]);
});
test("v6 fixes precisely the 40 demonstrated targets in both arms without rewriting sentences or old data", () => {
  assert.deepEqual(built.manifest, JSON.parse(readFileSync("research/m4-parser/data/v6-manifest.json", "utf8")));
  const conflicts = original.filter(r => trainingPolicyProblems(r).includes("registered_alias_is_known"));
  assert.equal(conflicts.length, 40); assert.equal(built.manifest.corrections.length, 40);
  assert.deepEqual(repairAliases(control), control); // A repair cannot silently modify corrected targets again.
  control.forEach((r, i) => {
    assert.equal(r.text, original[i].text); assert.equal(candidate[i].text, r.text);
    assert.deepEqual(candidate[i].label, r.label); assert.deepEqual(trainingPolicyProblems(r), [], r.id);
    assert.deepEqual(trainingPolicyProblems(candidate[i]), [], r.id);
  });
  for (const [name, data] of Object.entries(old.files)) if (!name.startsWith("train")) assert.equal(built.files[name], data);
  for (const [name, value] of Object.entries(old.manifest.files)) assert.equal(sha(old.files[name]), value.sha256);
  for (const change of built.manifest.corrections) {
    assert.equal(change.to.intent, "record");
    if (change.to.intent === "record") assert.equal(identifyExercise(change.to.exercise!)?.id, "barbell-bench");
  }
});
test("only training-derived catalogs vary; no extra facts or labels are visible to the model", () => {
  const pool = new Set(control.flatMap(r => r.context.exercises));
  assert.equal(built.manifest.catalogChanges, 6397);
  for (const [i, row] of candidate.entries()) {
    assert.equal(row.context.exercises.length, control[i].context.exercises.length);
    assert.ok(row.context.exercises.every(n => pool.has(n)));
    assert.equal(new Set(row.context.exercises.map(n => identifyExercise(n)?.id)).size, row.context.exercises.length);
    assert.equal(row.context.done, control[i].context.done); assert.equal(row.context.setCount, control[i].context.setCount);
  }
  for (const [arm, rows] of [["T", control], ["S", candidate]] as const) {
    for (const [i, line] of built.files[`${arm}-train.jsonl`].trim().split("\n").entries()) {
      const messages = JSON.parse(line).messages;
      assert.deepEqual(JSON.parse(messages[1].content), { exercises: rows[i].context.exercises, sentence: rows[i].text });
      assert.deepEqual(JSON.parse(messages[2].content), control[i].label);
    }
  }
});
test("CPU checks reject wrong action bindings, invented units and unsupported records from missing-unit negatives", () => {
  const source = control.find(r => r.family === "contrast_missing_unit_positive" && r.label.intent === "record")!;
  const wrongAction = clone(source);
  assert.equal(wrongAction.label.intent, "record");
  if (wrongAction.label.intent === "record") {
    const before = wrongAction.label.exercise;
    wrongAction.label.exercise = wrongAction.context.exercises.find(n => n !== before)!;
  }
  assert.ok(trainingPolicyProblems(wrongAction).includes("exercise_binding"));
  const negative = control.find(r => r.family === "contrast_missing_unit_negative")!;
  for (const reason of ["unknown_exercise", "rpe_scope"] as const) {
    const bad = clone(negative); bad.label = { intent: "clarify", reason };
    assert.ok(trainingPolicyProblems(bad).includes("boundary_reason"));
  }
  const invented = clone(negative); invented.label = clone(source).label;
  assert.ok(trainingPolicyProblems(invented).includes("boundary_reason"));
  const swapped = clone(source);
  if (swapped.label.intent === "record") {
    const s = swapped.label.sets[0]; [s.weight, s.reps] = [s.reps, s.weight!];
  }
  assert.ok(trainingPolicyProblems(swapped).includes("weight_unit_binding"));
});
test("RPE scope guards distinguish each, last and unspecified scope without using reps or catalog defaults", () => {
  const last = control.find(r => r.family === "contrast_rpe_scope_positive" && r.template.includes(".last."))!;
  const leaked = clone(last);
  if (leaked.label.intent === "record") leaked.label.sets[0].rpe = leaked.label.sets.at(-1)!.rpe;
  assert.ok(trainingPolicyProblems(leaked).includes("rpe_scope_binding"));
  const unscoped = clone(last); unscoped.text = unscoped.text.replace(/最后一组|last set/i, "");
  assert.ok(trainingPolicyProblems(unscoped).includes("rpe_scope_missing"));
  const each = control.find(r => r.family === "contrast_rpe_scope_positive" && r.template.includes(".each."))!;
  const omitted = clone(each); if (omitted.label.intent === "record") omitted.label.sets[0].rpe = null;
  assert.ok(trainingPolicyProblems(omitted).includes("rpe_scope_binding"));
  const refusal = clone(each); refusal.label = { intent: "clarify", reason: "rpe_scope" };
  assert.ok(trainingPolicyProblems(refusal).includes("positive_refusal"));
});
