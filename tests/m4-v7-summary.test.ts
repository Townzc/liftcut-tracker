import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildV2 } from "../research/m4-parser/scripts/build-v2";
import { compareSource } from "../research/m4-parser/scripts/compare-source";
import type { EvalItem } from "@liftcut/core/eval/parse-label-eval";

test("v7 separates resolved binding/fields and strict reasons while keeping frozen resolved scores", () => {
  const dir = mkdtempSync(join(tmpdir(), "m4-prompt-"));
  const challenge: EvalItem[] = buildV2().files["challenge.gold.jsonl"].trim().split("\n").map(s => JSON.parse(s));
  const splits = { "dev-eval": [{ ...challenge[0], id: "dev-fixture" }], challenge,
    handwritten: [{ ...challenge[0], id: "hand-fixture" }] };
  const save = (name: string, rows: unknown[]) => writeFileSync(join(dir, name), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
  for (const [split, rows] of Object.entries(splits)) save(`${split}.gold.jsonl`, rows);
  for (const arm of ["H", "T", "S"]) {
    const predictions = Object.values(splits).flat().map(g => {
      let label = structuredClone(g.label);
      if (label.intent === "clarify" && arm === "T") label = { intent: "clarify", reason: "out_of_range" };
      if (label.intent === "record" && arm === "S") {
        const before = label.exercise;
        label.exercise = g.context.exercises.find(n => n !== before)!;
      }
      return { id: g.id, output: JSON.stringify(label) };
    });
    save(`${arm}.jsonl`, predictions);
    for (const [split, rows] of Object.entries(splits)) writeFileSync(join(dir, `compare-${arm}-${split}.json`),
      JSON.stringify(compareSource(rows, predictions.filter(p => rows.some(g => g.id === p.id)))));
  }
  execFileSync(process.execPath, ["--import", "tsx", "research/m4-parser/scripts/summarize-v7.ts", "--out-dir", dir]);
  const result = JSON.parse(readFileSync(join(dir, "catalog-summary.json"), "utf8"));
  assert.equal(result.arms.H.focus.rpe_scope.correctReason, 15);
  assert.equal(result.arms.T.focus.rpe_scope.correctReason, 0);
  assert.equal(result.arms.T.invalidClarificationReasons, 0);
  assert.equal(result.arms.S.challengePositive.exact, 0);
  assert.equal(result.arms.S.fieldDiagnostics.recordGold, 122);
  assert.equal(result.arms.S.fieldDiagnostics.fieldsExactWrongExercise, 122);
  assert.equal(result.arms.S.fieldDiagnostics.fieldsExact, 122);
  assert.equal(result.arms.S.fieldDiagnostics.exerciseExact, 0);
  assert.equal(result.comparisons["H->T"].challenge.contrast_missing_unit_negative.bothCorrect, 15);
  assert.deepEqual(result.arms.H.bindingCategories, {});
  assert.equal(Object.values(result.arms.S.bindingCategories).reduce((n: number, v) => n + Number(v), 0), 122);
  assert.ok(result.arms.S.bindingCategories.different_available_identity > 0);
  assert.match(result.note, /only aligns train\/dev system text/);
  // Retain these byte fixtures in OS temp for failed-run inspection; no model calls.
});
