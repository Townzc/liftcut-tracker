import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { auditDecisions, decisionProblems } from "../research/m4-parser/scripts/audit-v7-decisions";
import type { EvalItem } from "@liftcut/core/eval/parse-label-eval";

// Independently authored diagnostic fixtures; not acceptance utterances or training data.
const item = (reason: "missing_unit" | "missing_reps" | "rpe_scope", text: string): EvalItem => ({
  id: "diagnostic", family: "diagnostic_" + reason, language: "en", text, label: { intent: "clarify", reason },
  context: { exercises: ["Calf raise"], selected: null, done: 0, setCount: 4 },
});
const record = (sets: unknown[]) => JSON.stringify({ intent: "record", exercise: "Calf raise", sets });

test("decision attribution separates a guessed unit from an unverified reps role", () => {
  const row = item("missing_unit", "Calf raise 37, 11 reps");
  assert.deepEqual(decisionProblems(row, record([{ weight: 37, unit: "lb", reps: 11, rpe: null }])),
    ["clarification_replaced_by_record", "unstated_unit_lb"]);
  assert.deepEqual(decisionProblems(row, record([37, 11].map(reps => ({ weight: null, unit: null, reps, rpe: null })))),
    ["clarification_replaced_by_record", "unverified_reps_role"]);
  assert.deepEqual(decisionProblems(row, JSON.stringify({ intent: "clarify", reason: "missing_unit" })), []);
});

test("RPE attribution counts overlapping scope issues without calling them invented numerals", () => {
  const row = item("rpe_scope", "Calf raise 2 sets of 11 with 37kg, RPE 6.5");
  const sets = [1, 2].map(() => ({ weight: 37, unit: "kg", reps: 11, rpe: 6.5 }));
  assert.deepEqual(decisionProblems(row, record(sets)), ["clarification_replaced_by_record",
    "effort_assigned_to_multiple_sets", "effort_assigned_to_every_set"]);
  assert.deepEqual(decisionProblems(row, JSON.stringify({ intent: "clarify", reason: "missing_unit" })), ["wrong_legal_reason"]);
  assert.deepEqual(decisionProblems(row, '{"intent":"clarify","reason":"unlisted_reason"}'),
    ["invalid_schema", "illegal_clarification_reason"]);
  assert.deepEqual(decisionProblems(row, "{"), ["invalid_json"]);
});

test("post-result audit refuses a wrong trusted manifest or changed source bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "m4-decisions-"));
  try {
    const content = '{"dev-eval.gold.jsonl":"wrong"}';
    writeFileSync(join(root, "sha256.json"), content);
    assert.throws(() => auditDecisions(root, "0".repeat(64)), /Manifest hash mismatch/);
    writeFileSync(join(root, "dev-eval.gold.jsonl"), "{}\n");
    assert.throws(() => auditDecisions(root, createHash("sha256").update(content).digest("hex")), /Input hash mismatch/);
  } finally {
    assert.equal(dirname(realpathSync(root)), realpathSync(tmpdir()));
    assert.match(basename(root), /^m4-decisions-/);
    rmSync(root, { recursive: true, force: true });
  }
});
