import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildAll, readHandwritten } from "./build-data";
import { buildV2 } from "./build-v2";
import { normalizeText, itemProblems, type Item } from "../src/synth";
import { V2_SYSTEM } from "../src/contrastive-data";
import { contrastiveV3, V3_POOLS } from "../src/contrastive-v3";
import { workoutLogCorpus } from "@liftcut/core/eval/workout-log-corpus";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const parse = (text: string): Item[] => text.trim().split("\n").map(line => JSON.parse(line));
const jsonl = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join("\n") + "\n";
const templates = (rows: Item[]) => [...new Set(rows.map(row => row.template))].sort();
export function buildV3() {
  const legacy = buildAll(), v2 = buildV2();
  const historicalEval = [...parse(legacy.files.dev), ...parse(legacy.files.test), ...parse(v2.files["dev.gold.jsonl"]),
    ...parse(v2.files["challenge.gold.jsonl"]), ...readHandwritten(), ...workoutLogCorpus];
  const oldTrain = parse(legacy.files.train);
  const excluded = new Set([...historicalEval, ...parse(v2.files["train.gold.jsonl"])].map(row => normalizeText(row.text)));
  const freshDev = contrastiveV3("dev", excluded), freshTrain = contrastiveV3("train", excluded);
  const sets = { train: [...oldTrain, ...freshTrain], dev: [...parse(legacy.files.test).map(row => ({ ...row, split: "dev" as const })), ...freshDev] };
  const trainTemplates = templates(sets.train), devTemplates = templates(sets.dev);
  if (trainTemplates.some(id => devTemplates.includes(id))) throw new Error("Train/dev template overlap");
  const trainTexts = new Set(sets.train.map(row => normalizeText(row.text)));
  if (historicalEval.some(row => trainTexts.has(normalizeText(row.text))) || sets.dev.some(row => trainTexts.has(normalizeText(row.text))))
    throw new Error("Evaluation text entered training");
  const files: Record<string, string> = {};
  for (const [split, rows] of Object.entries(sets)) {
    for (const row of rows) if (itemProblems(row).length) throw new Error(`Inconsistent ${row.id}: ${itemProblems(row)}`);
    files[`${split}.gold.jsonl`] = jsonl(rows);
    const messages = (row: Item) => [{ role: "system", content: V2_SYSTEM },
      { role: "user", content: JSON.stringify({ exercises: row.context.exercises, sentence: row.text }) }];
    files[`${split}.jsonl`] = jsonl(rows.map(row => ({ id: row.id, messages: [...messages(row), { role: "assistant", content: JSON.stringify(row.label) }] })));
    if (split === "dev") files["dev-eval.jsonl"] = jsonl(rows.map(row => ({ id: row.id, messages: messages(row) })));
  }
  const counts = (rows: Item[], key: (row: Item) => string) => rows.reduce<Record<string, number>>((out, row) => {
    const k = key(row); out[k] = (out[k] ?? 0) + 1; return out;
  }, {});
  return { files, manifest: { version: "v3-development-preparation", gpuReady: false, system: V2_SYSTEM, pools: V3_POOLS,
    provenance: "Original 4000 training rows plus new label-first contrastive frames. Previously observed old test explicitly becomes development only; no independent test is created.",
    templateOverlap: 0, historicalEvalInTraining: 0, trainTemplates, devTemplates,
    splits: Object.fromEntries(Object.entries(sets).map(([name, rows]) => [name, { items: rows.length,
      intents: counts(rows, row => row.label.intent), languages: counts(rows, row => row.language) }])),
    files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, { sha256: sha(data), lines: data.trim().split("\n").length }])) } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url)), { files, manifest } = buildV3();
  const manifestPath = `${root}data/v3-manifest.json`;
  if (process.argv.includes("--check")) {
    if (JSON.stringify(JSON.parse(readFileSync(manifestPath, "utf8"))) !== JSON.stringify(manifest)) throw new Error("V3 manifest mismatch");
  } else {
    mkdirSync(`${root}data/generated/v3`, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(`${root}data/generated/v3/${name}`, text);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
  console.log(JSON.stringify(manifest.splits));
}
