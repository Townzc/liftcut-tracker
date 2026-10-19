import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { workoutLogCorpus } from "@liftcut/core/eval/workout-log-corpus";
import { generate, normalizeText, templates, type Item } from "../src/synth";

// Usage: build-data.ts            write data/generated/*.jsonl and data/manifest.json
//        build-data.ts --check    regenerate in memory and fail unless the hashes match the manifest
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SPLITS = { test: { seed: 3, total: 500 }, dev: { seed: 2, total: 500 }, train: { seed: 1, total: 4000 } } as const;

export function readHandwritten(): Item[] {
  return readFileSync(join(root, "data/handwritten-test.jsonl"), "utf8").trim().split("\n").map(line => JSON.parse(line));
}
const count = (items: Item[], key: (i: Item) => string) => Object.fromEntries(Object.entries(items.reduce<Record<string, number>>((m, i) =>
  ({ ...m, [key(i)]: (m[key(i)] ?? 0) + 1 }), {})).sort());
const jsonl = (items: Item[]) => items.map(i => JSON.stringify(i)).join("\n") + "\n";

/** Eval texts first, so train can exclude every sentence any evaluation set contains. */
export function buildAll() {
  const evalOnly = new Set([...readHandwritten().map(i => i.text), ...workoutLogCorpus.map(i => i.text)].map(normalizeText));
  const stats = { test: { attempts: 0, duplicates: 0 }, dev: { attempts: 0, duplicates: 0 }, train: { attempts: 0, duplicates: 0 } };
  const test = generate("test", SPLITS.test.total, SPLITS.test.seed, evalOnly, stats.test);
  const dev = generate("dev", SPLITS.dev.total, SPLITS.dev.seed, new Set([...evalOnly, ...test.map(i => normalizeText(i.text))]), stats.dev);
  const train = generate("train", SPLITS.train.total, SPLITS.train.seed,
    new Set([...evalOnly, ...test.map(i => normalizeText(i.text)), ...dev.map(i => normalizeText(i.text))]), stats.train);
  const files = { train: jsonl(train), dev: jsonl(dev), test: jsonl(test) };
  const manifest = {
    version: 1, generator: "research/m4-parser/src/synth.ts", seeds: Object.fromEntries(Object.entries(SPLITS).map(([k, v]) => [k, v.seed])),
    templates: { train_and_dev: templates.filter(t => !t.heldOut).length, test_only: templates.filter(t => t.heldOut).length },
    excludedFromTrain: { handwrittenAndCorpusTexts: evalOnly.size },
    splits: Object.fromEntries(Object.entries({ train, dev, test }).map(([name, items]) => [name, {
      items: items.length, rendered: stats[name as keyof typeof stats].attempts, droppedAsDuplicateOrEvalText: stats[name as keyof typeof stats].duplicates,
      inconsistentLabels: 0, sha256: createHash("sha256").update(files[name as keyof typeof files]).digest("hex"),
      intents: count(items, i => i.label.intent), languages: count(items, i => i.language), families: count(items, i => i.family) }])),
  };
  return { files, manifest };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { files, manifest } = buildAll(), manifestPath = join(root, "data/manifest.json");
  if (process.argv.includes("--check")) {
    const saved = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (JSON.stringify(saved) !== JSON.stringify(manifest)) { console.error("generated data no longer matches data/manifest.json"); process.exit(1); }
    console.log("generated data matches data/manifest.json");
  } else {
    mkdirSync(join(root, "data/generated"), { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(root, `data/generated/${name}.jsonl`), text);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    console.log(JSON.stringify(Object.fromEntries(Object.entries(manifest.splits).map(([k, v]) => [k, v.items]))));
  }
}
