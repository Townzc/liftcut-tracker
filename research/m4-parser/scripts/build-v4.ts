import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildV3 } from "./build-v3";
import { buildV2 } from "./build-v2";
import { boundaryPair, V4_TARGETS, V4_ENUM_SYSTEM } from "../src/contrastive-v4";
import { V2_SYSTEM } from "../src/contrastive-data";
import { itemProblems, normalizeText, type Item } from "../src/synth";

const parse = (s: string): Item[] => s.trim().split("\n").map(line => JSON.parse(line));
const jsonl = (rows: unknown[]) => rows.map(row => JSON.stringify(row)).join("\n") + "\n";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export function buildV4() {
  const v3 = buildV3(), v2 = buildV2(), old = parse(v3.files["train.gold.jsonl"]);
  const excluded = new Set([...Object.entries(v2.files), ...Object.entries(v3.files)]
    .filter(([name]) => name.endsWith("gold.jsonl")).flatMap(([, data]) => parse(data).map(row => normalizeText(row.text))));
  const count = Object.fromEntries(V4_TARGETS.map(r => [r, 0])), train: Item[] = [];
  for (let i = 0; i < old.length; i++) {
    const row = old[i], reason = row.id.startsWith("v3-") && V4_TARGETS.find(r => row.family === `contrast_${r}_positive`);
    if (!reason) { train.push(row); continue; }
    if (old[i + 1]?.id !== row.id.replace("-positive", "-negative")) throw new Error("Broken baseline pair");
    for (const fresh of boundaryPair(row, count[reason]++)) {
      const key = normalizeText(fresh.text);
      if (excluded.has(key) || itemProblems(fresh).length) throw new Error(`Invalid new row ${fresh.id}: ${itemProblems(fresh)}`);
      excluded.add(key); train.push(fresh);
    }
    i++;
  }
  if (train.length !== 6400 || Object.values(count).some(n => n !== 120)) throw new Error("Fixed replacement count drift");
  const files: Record<string, string> = { ...v3.files, "train.gold.jsonl": jsonl(train), "train.jsonl": jsonl(train.map(row => ({ id: row.id, messages: [
    { role: "system", content: V2_SYSTEM }, { role: "user", content: JSON.stringify({ exercises: row.context.exercises, sentence: row.text }) },
    { role: "assistant", content: JSON.stringify(row.label) },
  ] }))) };
  const fresh = train.filter(r => r.id.startsWith("v4-"));
  return { files, manifest: { version: "v4-boundary-data-1", gpuReady: false, trainingSystem: V2_SYSTEM, enumEvaluationSystem: V4_ENUM_SYSTEM,
    changedRows: fresh.length, unchangedRows: train.length - fresh.length, replacementPairs: count,
    provenance: "Re-render three v3 training label families only. No evaluation/private utterances, rewrites or teacher outputs are generation inputs. Other 5680 rows, order, dev/evaluation and SFT prompt unchanged.",
    baselineManifestSha256: sha(JSON.stringify(v3.manifest)), trainTemplates: [...new Set(fresh.map(r => r.template))].sort(),
    files: Object.fromEntries(Object.entries(files).map(([name, text]) => [name, { sha256: sha(text), lines: text.trim().split("\n").length }])) } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url)), { files, manifest } = buildV4(), target = `${root}data/v4-manifest.json`;
  if (process.argv.includes("--check")) {
    if (JSON.stringify(JSON.parse(readFileSync(target, "utf8"))) !== JSON.stringify(manifest)) throw new Error("V4 manifest drift");
  } else {
    mkdirSync(`${root}data/generated/v4`, { recursive: true });
    for (const [name, data] of Object.entries(files)) writeFileSync(`${root}data/generated/v4/${name}`, data);
    writeFileSync(target, JSON.stringify(manifest, null, 2) + "\n");
  }
  console.log(JSON.stringify({ changedRows: manifest.changedRows, unchangedRows: manifest.unchangedRows }));
}
