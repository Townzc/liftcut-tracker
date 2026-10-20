import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildAll, readHandwritten } from "./build-data";
import { normalizeText, type Item } from "../src/synth";
import { contrastive, V2_SYSTEM, AUGMENT } from "../src/contrastive-data";
import { parseLabelSchema } from "@liftcut/core/parse-label";
import { workoutLogCorpus } from "@liftcut/core/eval/workout-log-corpus";

const root = fileURLToPath(new URL("../", import.meta.url));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export function buildV2() {
  const old = buildAll(), parse = (s: string): Item[] => s.trim().split("\n").map(line => JSON.parse(line));
  const prior = Object.values(old.files).flatMap(parse);
  const exclude = new Set([...prior, ...readHandwritten(), ...workoutLogCorpus].map(x => normalizeText(x.text)));
  const fresh = { test: contrastive("test", exclude, normalizeText), dev: contrastive("dev", exclude, normalizeText), train: contrastive("train", exclude, normalizeText) };
  const sets = { train: [...parse(old.files.train), ...fresh.train], dev: [...parse(old.files.dev), ...fresh.dev], challenge: fresh.test };
  const files: Record<string, string> = {};
  for (const [split, items] of Object.entries(sets)) {
    for (const item of items) parseLabelSchema.parse(item.label);
    files[`${split}.gold.jsonl`] = items.map(i => JSON.stringify(i)).join("\n") + "\n";
    files[`${split}.jsonl`] = items.map(item => JSON.stringify({ id: item.id, messages: [
      { role: "system", content: V2_SYSTEM }, { role: "user", content: JSON.stringify({ exercises: item.context.exercises, sentence: item.text }) },
      ...(split === "train" || split === "dev" ? [{ role: "assistant", content: JSON.stringify(item.label) }] : []),
    ] })).join("\n") + "\n";
  }
  // Old evaluation stays diagnostic; its wording/labels never enter new training.
  for (const [name, items] of Object.entries({ "old-test": parse(old.files.test), handwritten: readHandwritten(), "dev-eval": sets.dev })) {
    files[`${name}.gold.jsonl`] = items.map(i => JSON.stringify(i)).join("\n") + "\n";
    files[`${name}.jsonl`] = items.map(i => JSON.stringify({ id: i.id, messages: [{ role: "system", content: V2_SYSTEM },
      { role: "user", content: JSON.stringify({ exercises: i.context.exercises, sentence: i.text }) }] })).join("\n") + "\n";
  }
  return { files, manifest: { version: 2, originalManifestSha256: sha(JSON.stringify(old.manifest)), system: V2_SYSTEM,
    augmentation: AUGMENT, counts: Object.fromEntries(Object.entries(sets).map(([k, v]) => [k, v.length])),
    provenance: "label-first synthetic contrastive pairs; no teacher, real data or unseen-human validation",
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { sha256: sha(v), lines: v.trim().split("\n").length }])) } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { files, manifest } = buildV2(), path = `${root}data/v2-manifest.json`;
  if (process.argv.includes("--check")) {
    if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(manifest)) throw new Error("V2 manifest mismatch");
  } else {
    mkdirSync(`${root}data/generated/v2`, { recursive: true });
    for (const [name, contents] of Object.entries(files)) writeFileSync(`${root}data/generated/v2/${name}`, contents);
    writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
  }
  console.log(JSON.stringify(manifest.counts));
}
