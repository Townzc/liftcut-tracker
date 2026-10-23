import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import type { EvalItem } from "@liftcut/core/eval/parse-label-eval";
import { auditResiduals, residuals } from "../research/m4-parser/scripts/audit-v8-residuals";

// Existing public diagnostic fixture vocabulary, never model-training inputs.
const row = (id: string, reason: "missing_unit" | "rpe_scope"): EvalItem => ({
  id, family: "diagnostic_" + reason, language: "en",
  text: reason === "missing_unit" ? "Calf raise 37, 11 reps" : "Calf raise 2 sets of 11 with 37kg, RPE 6.5",
  context: { exercises: ["Calf raise"], selected: "Calf raise", done: 0, setCount: 4 },
  label: { intent: "clarify", reason },
});
const record = (rpe: (number | null)[]) => JSON.stringify({ intent: "record", exercise: "Calf raise",
  sets: rpe.map(p => ({ weight: 37, unit: "kg", reps: 11, rpe: p })) });

test("saved-output attribution distinguishes all-set and last-only RPE guesses", () => {
  const gold = [row("all", "rpe_scope"), row("last", "rpe_scope")];
  const report = residuals(gold, [{ id: "all", output: record([6.5, 6.5]) },
    { id: "last", output: record([null, 6.5]) }], ["last", "all"]);
  assert.equal(report.partition.negative_rpe_scope.count, 2);
  assert.deepEqual(report.failedCases.map(c => c.rpeAssignment), ["every_set", "last_set_only"]);
  assert.equal(report.failedCases[1].issues.includes("effort_assigned_to_every_set"), false);
});

test("legal reason substitution may resolve equally; invalid vocabulary stays separately visible", () => {
  const gold = [row("legal", "missing_unit"), row("illegal", "missing_unit")];
  const predictions = [{ id: "legal", output: '{"intent":"clarify","reason":"rpe_scope"}' },
    { id: "illegal", output: '{"intent":"clarify","reason":"unlisted_reason"}' }];
  const report = residuals(gold, predictions, ["illegal"]);
  assert.equal(report.exact, 1);
  assert.deepEqual(report.illegalReasons, [{ id: "illegal", reason: "unlisted_reason" }]);
  assert.throws(() => residuals(gold, predictions, ["legal", "illegal"]), /Frozen failure IDs mismatch/);
});

test("review refuses missing, duplicate, alien predictions and duplicate gold", () => {
  const gold = [row("a", "missing_unit")];
  const p = { id: "a", output: '{"intent":"clarify","reason":"missing_unit"}' };
  for (const predictions of [[], [p, p], [{ ...p, id: "elsewhere" }]])
    assert.throws(() => residuals(gold, predictions, []), /Duplicate or mismatched IDs/);
  assert.throws(() => residuals([...gold, ...gold], [p], []), /Duplicate or mismatched IDs/);
});

test("audit requires trusted manifest and exact file bytes before any attribution", () => {
  const root = mkdtempSync(join(tmpdir(), "m4-v8-residuals-"));
  try {
    const content = '{"dev-eval.gold.jsonl":"wrong"}';
    writeFileSync(join(root, "sha256.json"), content);
    assert.throws(() => auditResiduals(root, "0".repeat(64)), /Manifest hash mismatch/);
    writeFileSync(join(root, "dev-eval.gold.jsonl"), "{}\n");
    assert.throws(() => auditResiduals(root, createHash("sha256").update(content).digest("hex")), /Input hash mismatch/);
  } finally {
    assert.equal(dirname(realpathSync(root)), realpathSync(tmpdir()));
    assert.match(basename(root), /^m4-v8-residuals-/);
    rmSync(root, { recursive: true, force: true });
  }
});
