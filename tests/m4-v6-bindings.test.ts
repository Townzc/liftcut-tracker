import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import type { EvalItem } from "@liftcut/core/eval/parse-label-eval";
import { auditBindings, bindingCategory } from "../research/m4-parser/scripts/audit-v6-bindings";
import { trainingInventory } from "../research/m4-parser/scripts/audit-v6-training";

const item: EvalItem = { id: "audit-synthetic", family: "audit", language: "en", text: "synthetic audit fixture",
  context: { exercises: ["Barbell bench press", "Dumbbell bench press"], selected: "Barbell bench press", done: 0, setCount: 4 },
  label: { intent: "record", exercise: "Barbell bench press", sets: [{ weight: 19.25, unit: "kg", reps: 6, rpe: null }] } };
const output = (exercise: string | null) => JSON.stringify({ ...item.label, exercise });
test("binding attribution separates wrong available actions from unavailable aliases", () => {
  assert.equal(bindingCategory(item, output("Dumbbell bench press")), "different_available_identity");
  assert.equal(bindingCategory(item, output("bench press")), "unavailable_same_identity");
  assert.equal(bindingCategory(item, output("Back squat")), "unavailable_other_identity");
  assert.equal(bindingCategory(item, output("unregistered fixture")), "unavailable_unknown_name");
  assert.equal(bindingCategory(item, output(null)), "resolved_equal");
});
test("binding audit preserves the frozen fence, schema, session and set-field semantics", () => {
  assert.equal(bindingCategory(item, `\`\`\`json\n${output("bench press")}\n\`\`\``), "unavailable_same_identity");
  assert.equal(bindingCategory(item, "not json"), null);
  assert.equal(bindingCategory(item, JSON.stringify({ intent: "record", exercise: "Squat", sets: [] })), null);
  const changed = JSON.parse(output("Dumbbell bench press")); changed.sets[0].reps = 9;
  assert.equal(bindingCategory(item, JSON.stringify(changed)), null);
  assert.equal(bindingCategory({ ...item, context: { ...item.context, selected: null } }, output(null)), "unresolved_implicit_exercise");
  assert.equal(bindingCategory({ ...item, context: { ...item.context, done: 4 } }, output("Dumbbell bench press")), "resolved_equal");
});
test("binding audit fails closed on an untrusted manifest or changed input bytes", () => {
  const root = mkdtempSync(join(tmpdir(), "m4-bindings-"));
  try {
    const manifest = JSON.stringify({ "dev-eval.gold.jsonl": "wrong" });
    writeFileSync(join(root, "sha256.json"), manifest);
    writeFileSync(join(root, "dev-eval.gold.jsonl"), "[]");
    assert.throws(() => auditBindings(root, "wrong"), /Manifest hash mismatch/);
    assert.throws(() => auditBindings(root, createHash("sha256").update(manifest).digest("hex")), /Input hash mismatch/);
  } finally {
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}m4-bindings-`));
    rmSync(root, { recursive: true, force: true });
  }
});
test("training inventory is bound to the reviewed v6 bytes and keeps prompt mismatch visible", () => {
  const report = trainingInventory();
  assert.equal(report.sameSystem, false);
  assert.deepEqual(report.trainingListedReasonTokens, []);
  assert.equal(report.evaluationListedReasonTokens.length, 10);
  assert.equal(report.arms.T.rows, 6400);
  assert.deepEqual(report.arms.T.clarificationReasons, report.arms.S.clarificationReasons);
  assert.deepEqual(report.arms.T.rpeScopeTargets, report.arms.S.rpeScopeTargets);
  assert.notDeepEqual(report.arms.T.bindingPositions, report.arms.S.bindingPositions);
  assert.equal(report.arms.T.policyErrors + report.arms.S.policyErrors, 0);
});
