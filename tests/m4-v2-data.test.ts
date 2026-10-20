import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { labelTextProblems, parseLabelSchema, unitsIn } from "@liftcut/core/parse-label";
import { buildV2 } from "../research/m4-parser/scripts/build-v2";
import { buildAll, readHandwritten } from "../research/m4-parser/scripts/build-data";
import { normalizeText, type Item } from "../research/m4-parser/src/synth";

const { files, manifest } = buildV2();
const rows = (name: string) => files[name].trim().split("\n").map(line => JSON.parse(line));
test("v2 is reproducible, preserves original labels, and keeps every evaluation text out of training", () => {
  assert.deepEqual(manifest, JSON.parse(readFileSync("research/m4-parser/data/v2-manifest.json", "utf8")));
  assert.deepEqual(manifest.counts, { train: 6400, dev: 740, challenge: 240 });
  const train: Item[] = rows("train.gold.jsonl"), old = buildAll();
  assert.equal(train.slice(0, 4000).map(i => JSON.stringify(i)).join("\n") + "\n", old.files.train);
  const held = [...rows("dev.gold.jsonl"), ...rows("challenge.gold.jsonl"), ...rows("old-test.gold.jsonl"), ...readHandwritten()];
  const texts = new Set(train.map(r => normalizeText(r.text)));
  assert.ok(held.every(r => !texts.has(normalizeText(r.text))));
  assert.ok(rows("challenge.gold.jsonl").every(r => r.template.includes("v2.held.")));
  assert.ok(train.every(r => !r.template.includes("v2.held.")));
});
test("contrastive positive labels are grounded in quantities; missing units and reps cannot be imputed", () => {
  for (const name of ["train", "dev", "challenge"]) for (const item of rows(`${name}.gold.jsonl`) as Item[]) {
    parseLabelSchema.parse(item.label);
    if (!item.id.startsWith("v2-")) continue;
    if (item.label.intent === "record") assert.deepEqual(labelTextProblems(item.text, item.label, item.context.exercises), [], item.id);
    if (item.family === "contrast_missing_unit_negative") assert.equal(unitsIn(item.text).size, 0, item.id);
    if (item.family.endsWith("negative")) assert.equal(item.label.intent, "clarify", item.id);
    assert.ok(!item.context.exercises.includes("未列出的新动作"));
  }
});
test("training targets equal labels; evaluation prompts exclude answers, selected targets and actuals", () => {
  for (const name of ["train", "dev", "challenge", "old-test", "handwritten", "dev-eval"]) {
    const gold = rows(`${name}.gold.jsonl`), input = rows(`${name}.jsonl`);
    assert.deepEqual(input.map(x => x.id), gold.map(x => x.id));
    input.forEach((row, index) => {
      const user = JSON.parse(row.messages[1].content);
      assert.deepEqual(Object.keys(user).sort(), ["exercises", "sentence"]);
      assert.deepEqual(user.exercises, gold[index].context.exercises);
      assert.equal(user.sentence, gold[index].text);
      if (name === "train" || name === "dev") assert.deepEqual(JSON.parse(row.messages[2].content), gold[index].label);
      else assert.equal(row.messages.length, 2);
    });
  }
});
