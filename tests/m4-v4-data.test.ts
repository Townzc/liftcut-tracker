import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildV4 } from "../research/m4-parser/scripts/build-v4";
import { buildV3 } from "../research/m4-parser/scripts/build-v3";
import { CLARIFY_REASONS, parseLabelSchema, unitsIn } from "@liftcut/core/parse-label";
import { itemProblems, normalizeText, type Item } from "../research/m4-parser/src/synth";
import { V2_SYSTEM } from "../research/m4-parser/src/contrastive-data";
import { V4_ENUM_SYSTEM } from "../research/m4-parser/src/contrastive-v4";

const v4 = buildV4(), v3 = buildV3(), read = (s: string): Item[] => s.trim().split("\n").map(line => JSON.parse(line));
const train = read(v4.files["train.gold.jsonl"]), old = read(v3.files["train.gold.jsonl"]);
const fresh = train.filter(r => r.id.startsWith("v4-"));
test("v4 changes precisely 720 boundary rows; other rows, positions and development bytes stay frozen", () => {
  assert.deepEqual(v4.manifest, JSON.parse(readFileSync("research/m4-parser/data/v4-manifest.json", "utf8")));
  assert.equal(train.length, 6400); assert.equal(fresh.length, 720);
  let untouched = 0;
  train.forEach((row, i) => { if (!row.id.startsWith("v4-")) { assert.deepEqual(row, old[i]); untouched++; }
    parseLabelSchema.parse(row.label); assert.deepEqual(itemProblems(row), [], row.id); });
  assert.equal(untouched, 5680);
  for (const [name, data] of Object.entries(v3.files)) if (!name.startsWith("train")) assert.equal(v4.files[name], data);
  const seen = new Set(old.map(r => normalizeText(r.text)));
  for (const row of fresh) { assert.ok(!seen.has(normalizeText(row.text))); seen.add(normalizeText(row.text)); }
});
test("implicit and explicit unit omissions pair with actual stated loads, including corrections", () => {
  const negatives = fresh.filter(r => r.family === "contrast_missing_unit_negative");
  assert.equal(negatives.length, 120); assert.equal(negatives.filter(r => r.template.includes(".implicit.")).length, 60);
  let patches = 0;
  for (const row of negatives) {
    assert.equal(unitsIn(row.text).size, 0); assert.deepEqual(row.label, { intent: "clarify", reason: "missing_unit" });
    const positive = fresh.find(r => r.id === row.id.replace(/negative$/, "positive"))!;
    assert.equal(unitsIn(positive.text).size, 1);
    if (positive.label.intent === "correct") { patches++; assert.deepEqual(Object.keys(positive.label.changes).sort(), ["unit", "weight"]); }
    if (row.template.includes(".implicit.")) assert.doesNotMatch(row.text, /单位|unit/i);
  }
  assert.equal(patches, 40);
});
test("RPE scopes balance each/last at three positions and retain other sets as null", () => {
  const positives = fresh.filter(r => r.family === "contrast_rpe_scope_positive"), cells: Record<string, number> = {};
  for (const row of positives) {
    assert.equal(row.label.intent, "record"); if (row.label.intent !== "record") continue;
    const last = row.template.includes(".last."), position = row.template.match(/position-(\d)/)![1], key = `${last}:${position}`;
    cells[key] = (cells[key] ?? 0) + 1;
    const sets = row.label.sets;
    assert.ok(sets.length >= 2);
    if (last) assert.ok(sets.slice(0, -1).every(s => s.rpe === null));
    else assert.ok(sets.every(s => s.rpe === sets[0].rpe && s.rpe !== null));
    const negative = fresh.find(r => r.id === row.id.replace(/positive$/, "negative"))!;
    assert.deepEqual(negative.label, { intent: "clarify", reason: "rpe_scope" });
    assert.doesNotMatch(negative.text, /(?:每组|最后一组|each set|last set)\s*RPE/i);
  }
  assert.equal(Object.keys(cells).length, 6); assert.ok(Object.values(cells).every(n => n === 20));
});
test("missing exercise names are not only explicit absence cues; inference vocabulary factor never changes SFT", () => {
  const negatives = fresh.filter(r => r.family === "contrast_unknown_exercise_negative");
  for (const mode of ["absent-name", "ambiguous-name", "explicit-absence"])
    assert.equal(negatives.filter(r => r.template.includes(mode)).length, 40);
  for (const reason of CLARIFY_REASONS) assert.ok(V4_ENUM_SYSTEM.includes(reason));
  assert.ok(V4_ENUM_SYSTEM.startsWith(V2_SYSTEM));
  for (const [i, line] of v4.files["train.jsonl"].trim().split("\n").entries()) {
    const row = JSON.parse(line); assert.equal(row.messages[0].content, V2_SYSTEM);
    assert.deepEqual(JSON.parse(row.messages[1].content), { exercises: train[i].context.exercises, sentence: train[i].text });
    assert.deepEqual(JSON.parse(row.messages[2].content), train[i].label);
  }
});
