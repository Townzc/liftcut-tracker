import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { workoutLogCorpus } from "@liftcut/core/eval/workout-log-corpus";
import { numbersIn } from "@liftcut/core/parse-label";
import { buildAll, readHandwritten } from "../research/m4-parser/scripts/build-data";
import { itemProblems, normalizeText, random, templates, zhNumber, enNumber, type Item } from "../research/m4-parser/src/synth";

const { files, manifest } = buildAll();
const split = (name: keyof typeof files): Item[] => files[name].trim().split("\n").map(line => JSON.parse(line));

test("the generator reproduces the committed manifest byte for byte", () => {
  assert.deepEqual(manifest, JSON.parse(readFileSync("research/m4-parser/data/manifest.json", "utf8")));
});

test("every generated item passes the schema and the sentence/label check; test uses only held-out templates", () => {
  const heldOut = new Set(templates.filter(t => t.heldOut).map(t => t.id));
  for (const name of ["train", "dev", "test"] as const) for (const item of split(name)) {
    assert.deepEqual(itemProblems(item), [], `${item.id} ${item.text}`);
    assert.equal(heldOut.has(item.template), name === "test", `${item.id} ${item.template}`);
  }
});

test("no evaluation sentence is in train: test, dev, the handwritten set and the 150-case corpus", () => {
  const train = new Set(split("train").map(i => normalizeText(i.text)));
  const evaluation = [...split("dev"), ...split("test"), ...readHandwritten()].map(i => i.text).concat(workoutLogCorpus.map(i => i.text));
  for (const text of evaluation) assert.equal(train.has(normalizeText(text)), false, text);
  assert.equal(new Set(split("test").map(i => normalizeText(i.text))).size, 500);
});

test("handwritten labels are valid and every number they claim is in the sentence", () => {
  const items = readHandwritten();
  assert.equal(items.length, 60);
  for (const item of items) {
    // Extra numbers are allowed here on purpose ("是 6 个不是 8 个"): the model must ignore them.
    assert.deepEqual(itemProblems(item).filter(p => !p.startsWith("extra:")), [], `${item.id} ${item.text}`);
  }
  assert.ok(items.some(i => i.label.intent === "correct" && itemProblems(i).length > 0));
});

test("spoken numbers rendered by the generator read back as the same value", () => {
  const rng = random(7);
  for (const n of [0, 2, 5, 10, 12, 20, 45, 60, 62.5, 100, 102.5, 105, 110, 120, 135, 200, 225, 250, 315, 405, 999, 1000, 1005, 2100, 3000])
    assert.deepEqual(numbersIn(zhNumber(n, rng)), [n], `${n} ${zhNumber(n, rng)}`);
  for (const n of [1, 8, 12, 19, 20, 21, 45, 60, 99]) assert.deepEqual(numbersIn(enNumber(n)), [n], enNumber(n));
});
