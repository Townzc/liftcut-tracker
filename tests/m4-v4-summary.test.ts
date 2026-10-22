import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { buildV2 } from "../research/m4-parser/scripts/build-v2";
import { compareSource } from "../research/m4-parser/scripts/compare-source";
import type { EvalItem } from "@liftcut/core/eval/parse-label-eval";

test("factor report detects wrong legal reasons, invalid reasons and all-clarify false refusals", () => {
  const dir = mkdtempSync(join(tmpdir(), "m4-factor-"));
  try {
    const challenge: EvalItem[] = buildV2().files["challenge.gold.jsonl"].trim().split("\n").map(s => JSON.parse(s));
    const splits = { "dev-eval": [{ ...challenge[0], id: "dev-fixture" }], challenge,
      handwritten: [{ ...challenge[0], id: "hand-fixture" }] };
    const save = (name: string, rows: unknown[]) => writeFileSync(join(dir, name), rows.map(r => JSON.stringify(r)).join("\n") + "\n");
    for (const [split, rows] of Object.entries(splits)) save(`${split}.gold.jsonl`, rows);
    for (const arm of ["A", "B", "C", "D"]) {
      const predictions = Object.values(splits).flat().map(g => {
        let label: unknown = g.label;
        if (g.label.intent === "clarify" && arm === "B") label = { intent: "clarify", reason: "out_of_range" };
        if (g.label.intent === "clarify" && arm === "C") label = { intent: "clarify", reason: "guess" };
        if (g.label.intent !== "clarify" && arm === "D") label = { intent: "clarify", reason: "missing_unit" };
        return { id: g.id, output: JSON.stringify(label) };
      });
      save(`${arm}.jsonl`, predictions);
      for (const [split, rows] of Object.entries(splits)) writeFileSync(join(dir, `compare-${arm}-${split}.json`),
        JSON.stringify(compareSource(rows, predictions.filter(p => rows.some(g => g.id === p.id)))));
    }
    execFileSync(process.execPath, ["--import", "tsx", "research/m4-parser/scripts/summarize-v4.ts", "--out-dir", dir]);
    const result = JSON.parse(readFileSync(join(dir, "factor-summary.json"), "utf8"));
    assert.equal(result.arms.A.focus.rpe_scope.correctReason, 15);
    assert.equal(result.arms.B.focus.rpe_scope.correctReason, 0);
    assert.equal(result.arms.B.invalidClarificationReasons, 0); // Legal vocabulary alone is insufficient.
    assert.equal(result.arms.C.invalidClarificationReasons, 120);
    assert.equal(result.arms.D.challengePositive.exact, 0);
    assert.equal(result.arms.D.falseRefusals, 122);
    assert.equal(result.comparisons["A->B"].challenge.contrast_missing_unit_negative.bothCorrect, 15); // Original scoring unchanged.
    assert.equal(result.comparisons["C->D"].challenge.contrast_rpe_scope_negative.gained, 15);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
