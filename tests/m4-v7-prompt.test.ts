import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildV6 } from "../research/m4-parser/scripts/build-v6";
import { alignPrompt, buildV7 } from "../research/m4-parser/scripts/build-v7";
import { V4_ENUM_SYSTEM } from "../research/m4-parser/src/contrastive-v4";
import { CLARIFY_REASONS } from "@liftcut/core/parse-label";

test("v7 changes only train/dev system; every sentence/label/catalog/order and eval byte stays fixed", () => {
  const old = buildV6(), next = buildV7();
  assert.deepEqual(next.manifest, JSON.parse(readFileSync("research/m4-parser/data/v7-manifest.json", "utf8")));
  for (const [name, content] of Object.entries(old.files)) {
    if (!["S-train.jsonl", "S-train.gold.jsonl", "dev.jsonl"].includes(name)) assert.equal(next.files[name], content, name);
  }
  assert.equal(next.files["S-train.gold.jsonl"], old.files["T-train.gold.jsonl"]);
  for (const [before, after] of [["T-train.jsonl", "S-train.jsonl"], ["dev.jsonl", "dev.jsonl"]]) {
    const source = old.files[before].trim().split("\n").map(v => JSON.parse(v));
    const aligned = next.files[after].trim().split("\n").map(v => JSON.parse(v));
    assert.equal(aligned.length, source.length);
    aligned.forEach((row, i) => {
      assert.equal(row.id, source[i].id);
      assert.equal(row.messages[0].content, V4_ENUM_SYSTEM);
      assert.deepEqual(row.messages.slice(1), source[i].messages.slice(1));
    });
  }
  for (const reason of CLARIFY_REASONS) assert.ok(V4_ENUM_SYSTEM.includes(reason));
});

test("unreviewed prompt roles and user fields cannot enter the alignment builder", () => {
  const row = JSON.parse(buildV6().files["T-train.jsonl"].split("\n")[0]);
  const changed = structuredClone(row); changed.messages[0].content = "changed";
  assert.throws(() => alignPrompt(changed), /contract/);
  const user = JSON.parse(row.messages[1].content); user.history = [];
  row.messages[1].content = JSON.stringify(user);
  assert.throws(() => alignPrompt(row), /contract/);
});
