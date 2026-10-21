import assert from "node:assert/strict";
import test from "node:test";
import { compareSource } from "../research/m4-parser/scripts/compare-source";
import type { EvalItem } from "@liftcut/core/eval/parse-label-eval";

const item: EvalItem = { id: "synthetic", family: "record", language: "zh", text: "卧推今天60kg8个，感觉还行",
  context: { exercises: ["卧推"], selected: "卧推", done: 0, setCount: 3 },
  label: { intent: "record", exercise: "卧推", sets: [{ weight: 60, unit: "kg", reps: 8, rpe: null }] } };
test("source comparison keeps raw failures, rejects invented values and separates a source-only baseline", () => {
  const correct = compareSource([item], [{ id: item.id, output: JSON.stringify(item.label) }]);
  assert.equal(correct.metrics.guardV1.exact, 0);
  assert.equal(correct.metrics.guardV2.exact, 1);
  const wrong = compareSource([item], [{ id: item.id, output: JSON.stringify({ ...item.label,
    sets: [{ weight: 60, unit: "kg", reps: 8, rpe: 8 }] }) }]);
  assert.equal(wrong.metrics.raw.invented, 1);
  assert.equal(wrong.metrics.guardV2.exact, 0);
  assert.equal(wrong.metrics.guardV2.invented, 0);
  assert.deepEqual(wrong.metrics.sourceOnlyV2, correct.metrics.sourceOnlyV2);
  assert.equal(wrong.newModelCalls, 0);
});
test("missing, repeated and foreign prediction IDs cannot silently drop failures", () => {
  for (const predictions of [[], [{ id: "other", output: "{}" }], Array(2).fill({ id: item.id, output: "{}" })])
    assert.throws(() => compareSource([item], predictions), /unique IDs/);
  assert.throws(() => compareSource([], []), /unique IDs/);
  assert.throws(() => compareSource([item, item], [{ id: item.id, output: "{}" }]), /unique IDs/);
});
