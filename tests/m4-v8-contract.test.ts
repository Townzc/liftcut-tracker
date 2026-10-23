import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildV7 } from "../research/m4-parser/scripts/build-v7";
import { buildV8, contractPrompt } from "../research/m4-parser/scripts/build-v8";
import { V8_CONTRACT_SYSTEM } from "../research/m4-parser/src/contract-v8";
import { CLARIFY_REASONS } from "@liftcut/core/parse-label";

test("v8 preserves every v7 byte and paired train/dev payload while sharing one contract", () => {
  const old = buildV7(), next = buildV8();
  assert.deepEqual(next.manifest, JSON.parse(readFileSync("research/m4-parser/data/v8-manifest.json", "utf8")));
  for (const [name, value] of Object.entries(old.files)) assert.equal(next.files[name as keyof typeof next.files], value, name);
  for (const split of ["train", "dev"]) {
    const a = next.files[`A-${split}.jsonl` as keyof typeof next.files].trim().split("\n").map(v => JSON.parse(v));
    const d = next.files[`D-${split}.jsonl` as keyof typeof next.files].trim().split("\n").map(v => JSON.parse(v));
    assert.equal(d.length, split === "train" ? 6400 : 740);
    d.forEach((row, i) => { assert.equal(row.id, a[i].id); assert.deepEqual(row.messages.slice(1), a[i].messages.slice(1));
      assert.equal(row.messages[0].content, V8_CONTRACT_SYSTEM); });
  }
  for (const reason of CLARIFY_REASONS) assert.ok(V8_CONTRACT_SYSTEM.includes(reason + "="));
  assert.equal(next.manifest.contractSystem, V8_CONTRACT_SYSTEM);
});

test("v8 refuses unexpected prompt, role and extra context before building training examples", () => {
  const row = JSON.parse(buildV7().files["S-train.jsonl"].split("\n")[0]);
  for (const mode of ["system", "answer-role", "context"]) {
    const value = structuredClone(row);
    if (mode === "system") value.messages[0].content = "different";
    else if (mode === "answer-role") value.messages[2].role = "tool";
    else value.messages[1].content = JSON.stringify({ ...JSON.parse(value.messages[1].content), selected: "Calf raise" });
    assert.throws(() => contractPrompt(value), /contract/);
  }
});
