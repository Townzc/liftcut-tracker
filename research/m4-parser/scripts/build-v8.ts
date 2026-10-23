import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildV7 } from "./build-v7";
import { V4_ENUM_SYSTEM } from "../src/contrastive-v4";
import { V8_CONTRACT_SYSTEM } from "../src/contract-v8";

type Row = { id: string; messages: { role: string; content: string }[] };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const lines = (s: string): Row[] => s.trim().split("\n").map(s => JSON.parse(s));
const jsonl = (rows: unknown[]) => rows.map(r => JSON.stringify(r)).join("\n") + "\n";

export function contractPrompt(row: Row): Row {
  const m = row.messages;
  if (m.map(v => v.role).join() !== "system,user,assistant" || m[0].content !== V4_ENUM_SYSTEM ||
      Object.keys(JSON.parse(m[1].content)).sort().join() !== "exercises,sentence") throw new Error("Unexpected training contract");
  return { ...row, messages: [{ role: "system", content: V8_CONTRACT_SYSTEM }, ...m.slice(1)] };
}

/** No input parameter: preserve every existing sentence, target, catalog and row position. */
export function buildV8() {
  const old = buildV7();
  const files = { ...old.files,
    "A-train.jsonl": old.files["S-train.jsonl"], "A-dev.jsonl": old.files["dev.jsonl"],
    "D-train.gold.jsonl": old.files["S-train.gold.jsonl"],
    "D-train.jsonl": jsonl(lines(old.files["S-train.jsonl"]).map(contractPrompt)),
    "D-dev.jsonl": jsonl(lines(old.files["dev.jsonl"]).map(contractPrompt)) };
  return { files, manifest: { version: "v8-contract-factorial-1", gpuReady: false,
    provenance: "Only system instructions change. All 6400 v7 tuples and evaluation bytes fixed. No examples, private originals, paraphrases, numeric variants, outputs or derivatives added.",
    sourceV7ManifestSha256: sha(JSON.stringify(old.manifest)), rows: 6400,
    enumSystem: V4_ENUM_SYSTEM, contractSystem: V8_CONTRACT_SYSTEM,
    unchangedTupleSequenceSha256: sha(JSON.stringify(lines(files["A-train.jsonl"]).map(r => [r.id, ...r.messages.slice(1)]))),
    files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, { sha256: sha(content), lines: content.trim().split("\n").length }])) } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url)), built = buildV8(), path = `${root}data/v8-manifest.json`;
  if (process.argv.includes("--check")) {
    if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(built.manifest)) throw new Error("V8 manifest drift");
  } else {
    mkdirSync(`${root}data/generated/v8`, { recursive: true });
    for (const [name, text] of Object.entries(built.files)) writeFileSync(`${root}data/generated/v8/${name}`, text);
    writeFileSync(path, JSON.stringify(built.manifest, null, 2) + "\n");
  }
  console.log(JSON.stringify({ rows: built.manifest.rows, newExamples: 0, gpuReady: false }));
}
