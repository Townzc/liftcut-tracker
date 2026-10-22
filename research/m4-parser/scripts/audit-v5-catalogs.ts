/** Rebuild original synthetic training bytes and audit catalog coverage, without inference. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildV4 } from "./build-v4";
import type { Item } from "../src/synth";

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`${name} required`);
  return process.argv[i + 1];
};
const root = arg("--run-dir"), output = arg("--out");
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const runHashes: Record<string, string> = JSON.parse(readFileSync(join(root, "sha256.json"), "utf8"));
const read = (name: string) => {
  const bytes = readFileSync(join(root, name));
  if (hash(bytes) !== runHashes[name]) throw new Error(`Saved input drift: ${name}`);
  return bytes.toString("utf8");
};
const actual = JSON.parse(read("data-manifests.json")).v4;
const built = buildV4();
for (const [name, text] of Object.entries(built.files)) {
  if (hash(text) !== actual.files[name]?.sha256) throw new Error(`Rebuilt data drift: ${name}`);
}
const parse = (text: string): Item[] => text.trim().split("\n").map(s => JSON.parse(s));
const train = parse(built.files["train.gold.jsonl"]);
const catalogKey = (r: Item, sorted = false) => JSON.stringify(sorted ? [...r.context.exercises].sort() : r.context.exercises);
const count = (rows: Item[], key: (r: Item) => string) => rows.reduce<Record<string, number>>((a, r) => {
  const k = key(r); a[k] = (a[k] ?? 0) + 1; return a;
}, {});
const trainExact = count(train, r => catalogKey(r)), trainMembers = count(train, r => catalogKey(r, true));
const visibleKeys = (text: string) => [...new Set(text.trim().split("\n").map(line => {
  const row = JSON.parse(line);
  const user = row.messages.find((m: { role: string }) => m.role === "user");
  return Object.keys(JSON.parse(user.content)).sort().join(",");
}))].sort();
const splits = Object.fromEntries(["dev-eval", "challenge", "handwritten"].map(split => {
  const rows = parse(read(`${split}.gold.jsonl`));
  const groups = count(rows, r => catalogKey(r));
  return [split, { total: rows.length, exactCatalogSeenInTrain: rows.filter(r => trainExact[catalogKey(r)]).length,
    catalogMembersSeenInTrain: rows.filter(r => trainMembers[catalogKey(r, true)]).length,
    catalogs: Object.entries(groups).map(([key, items]) => ({ exercises: JSON.parse(key), items,
      trainSameOrder: trainExact[key] ?? 0, trainSameMembers: trainMembers[JSON.stringify([...JSON.parse(key)].sort())] ?? 0 })) }];
}));
const report = { mode: "Post-result input coverage audit, not a model ablation or new training data", newModelCalls: 0,
  trainRows: train.length, trainGoldSha256: hash(built.files["train.gold.jsonl"]),
  trainSftSha256: hash(built.files["train.jsonl"]), savedDataManifestSha256: runHashes["data-manifests.json"],
  filesRegeneratedAndMatched: Object.keys(built.files).length,
  modelVisibleUserKeys: { train: visibleKeys(built.files["train.jsonl"]), evaluation: visibleKeys(read("all-eval.jsonl")) },
  splits,
  note: "An unseen exact catalog is not an unseen exercise or proof of cause. No training, evaluation labels, thresholds or private originals changed." };
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ trainRows: train.length, modelVisibleUserKeys: report.modelVisibleUserKeys,
  splits: Object.fromEntries(Object.entries(splits).map(([name, v]) => [name, { total: v.total,
    exactCatalogSeenInTrain: v.exactCatalogSeenInTrain, catalogMembersSeenInTrain: v.catalogMembersSeenInTrain }])) }));
