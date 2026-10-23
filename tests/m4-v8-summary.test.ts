import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildV2 } from "../research/m4-parser/scripts/build-v2";
import { compareSource } from "../research/m4-parser/scripts/compare-source";
import type { EvalItem } from "@liftcut/core/eval/parse-label-eval";

test("v8 factorial separates strict reasons from resolved exact and keeps all four cells", () => {
  const dir = mkdtempSync(join(tmpdir(), "m4-factorial-"));
  const challenge: EvalItem[] = buildV2().files["challenge.gold.jsonl"].trim().split("\n").map(s => JSON.parse(s));
  const splits = { "dev-eval": [{ ...challenge[0], id: "dev-fixture" }], challenge,
    handwritten: [{ ...challenge[0], id: "hand-fixture" }] };
  const save = (name: string, rows: unknown[]) => writeFileSync(join(dir, name), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
  for (const [split, rows] of Object.entries(splits)) save(`${split}.gold.jsonl`, rows);
  for (const arm of ["A", "B", "C", "D"]) {
    const predictions = Object.values(splits).flat().map(g => {
      let label = structuredClone(g.label);
      if (label.intent === "clarify" && arm === "B") label = { intent: "clarify", reason: "out_of_range" };
      if (label.intent === "record" && arm === "D") {
        const before = label.exercise;
        label.exercise = g.context.exercises.find(n => n !== before)!;
      }
      return { id: g.id, output: JSON.stringify(label) };
    });
    save(`${arm}.jsonl`, predictions);
    for (const [split, rows] of Object.entries(splits)) writeFileSync(join(dir, `compare-${arm}-${split}.json`),
      JSON.stringify(compareSource(rows, predictions.filter(p => rows.some(g => g.id === p.id)))));
  }
  execFileSync(process.execPath, ["--import", "tsx", "research/m4-parser/scripts/summarize-v8.ts", "--out-dir", dir, "--phase", "hf"]);
  const result = JSON.parse(readFileSync(join(dir, "hf-summary.json"), "utf8"));
  assert.equal(result.arms.A.focus.rpe_scope.correctReason, 15);
  assert.equal(result.arms.B.focus.rpe_scope.correctReason, 0);
  assert.equal(result.arms.B.invalidClarificationReasons, 0);
  assert.equal(result.arms.D.challengePositive.exact, 0);
  assert.equal(result.arms.D.fieldDiagnostics.recordGold, 122);
  assert.equal(result.arms.D.fieldDiagnostics.fieldsExactWrongExercise, 122);
  assert.equal(result.arms.D.fieldDiagnostics.fieldsExact, 122);
  assert.equal(result.arms.D.fieldDiagnostics.exerciseExact, 0);
  assert.equal(result.comparisons["A->B"].challenge.contrast_missing_unit_negative.bothCorrect, 15);
  assert.deepEqual(result.arms.A.bindingCategories, {});
  assert.equal(Object.values(result.arms.D.bindingCategories).reduce((n: number, v) => n + Number(v), 0), 122);
  assert.ok(result.arms.D.bindingCategories.different_available_identity > 0);
  assert.match(result.note, /sole candidate/);
  assert.equal(Object.keys(result.comparisons).length, 5);
  assert.deepEqual(result.arms.A, result.arms.C);
  // Retain these byte fixtures in OS temp for failed-run inspection; no model calls.
});
