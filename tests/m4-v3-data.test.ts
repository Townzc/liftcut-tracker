import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildV3 } from "../research/m4-parser/scripts/build-v3";
import { buildAll } from "../research/m4-parser/scripts/build-data";
import { normalizeText, itemProblems, type Item } from "../research/m4-parser/src/synth";
import { parseLabelSchema, unitsIn } from "@liftcut/core/parse-label";

const built = buildV3(), read = (s: string): Item[] => s.trim().split("\n").map(line => JSON.parse(line));
const train = read(built.files["train.gold.jsonl"]), dev = read(built.files["dev.gold.jsonl"]);
test("v3 template pools, labels and hashes reproduce without changing legacy evidence", () => {
  assert.deepEqual(built.manifest, JSON.parse(readFileSync("research/m4-parser/data/v3-manifest.json", "utf8")));
  assert.equal(train.length, 6400); assert.equal(dev.length, 740);
  assert.deepEqual(train.slice(0, 4000), read(buildAll().files.train));
  assert.deepEqual(dev.slice(0, 500).map(row => ({ ...row, split: "test" })), read(buildAll().files.test));
  const templateIds = new Set(train.map(row => row.template)), texts = new Set(train.map(row => normalizeText(row.text)));
  assert.ok(dev.every(row => !templateIds.has(row.template) && !texts.has(normalizeText(row.text))));
  for (const rows of [train, dev]) {
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    assert.equal(new Set(rows.map(row => row.label.intent)).size, 6);
    for (const row of rows) { parseLabelSchema.parse(row.label); assert.deepEqual(itemProblems(row), [], row.id); }
  }
});
test("training and evaluation expose only names and sentence; targets stay exact and eval has no answers", () => {
  for (const split of ["train", "dev"] as const) {
    const rows = split === "train" ? train : dev;
    const sft = built.files[`${split}.jsonl`].trim().split("\n").map(line => JSON.parse(line));
    for (const [i, row] of rows.entries()) {
      assert.deepEqual(JSON.parse(sft[i].messages[1].content), { exercises: row.context.exercises, sentence: row.text });
      assert.deepEqual(JSON.parse(sft[i].messages[2].content), row.label);
    }
  }
  for (const row of built.files["dev-eval.jsonl"].trim().split("\n").map(line => JSON.parse(line)))
    assert.deepEqual(row.messages.map((m: { role: string }) => m.role), ["system", "user"]);
});
test("hard negatives cover missing units and both qualifier positions without filling bodyweight or RPE", () => {
  for (const row of train.filter(row => row.id.startsWith("v3-"))) {
    if (row.label.intent === "record") for (const s of row.label.sets) {
      if (row.label.exercise === "Pull-up" || row.label.exercise === "Push-up" || row.label.exercise === "引体向上" || row.label.exercise === "俯卧撑")
        assert.equal(s.weight, null);
      if (!row.text.includes("RPE")) assert.equal(s.rpe, null);
    }
    if (row.label.intent === "clarify" && row.label.reason === "missing_unit") assert.equal(unitsIn(row.text).size, 0);
  }
  for (const reason of ["plan_not_actual", "negation", "uncertain_quantity", "question"]) {
    const rows = train.filter(row => row.id.startsWith("v3-") && row.label.intent === "clarify" && row.label.reason === reason);
    const postposed = rows.filter(row => /(?:，仅为设想，还没有做|hypothetical; not performed|，实际上没有完成|, not actually completed|，这些数我不确定|, uncertain numbers|，这样安排合适吗？|, would this be suitable\?)$/.test(row.text));
    assert.equal(rows.length, 120); assert.equal(postposed.length, 60, reason);
  }
});
test("unitless correction pairs clarify instead of filling a selected or default unit", () => {
  for (const rows of [train, dev]) {
    const patches = rows.filter(row => row.id.startsWith("v3-") && row.label.intent === "correct");
    assert.ok(patches.length > 0);
    for (const row of patches) {
      const negative = rows.find(other => other.id === row.id.replace("-positive", "-negative"))!;
      assert.deepEqual(negative.label, { intent: "clarify", reason: "missing_unit" });
      assert.equal(unitsIn(negative.text).size, 0);
      assert.deepEqual(itemProblems(row), []);
    }
  }
});
