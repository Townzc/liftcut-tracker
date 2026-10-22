import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildV6 } from "./build-v6";
import { V2_SYSTEM } from "../src/contrastive-data";
import { V4_ENUM_SYSTEM } from "../src/contrastive-v4";

type Row = { id: string; messages: { role: string; content: string }[] };
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const lines = (s: string): Row[] => s.trim().split("\n").map(s => JSON.parse(s));
const jsonl = (rows: unknown[]) => rows.map(r => JSON.stringify(r)).join("\n") + "\n";

/** Change only the system contract. No caller-supplied utterances or targets. */
export function alignPrompt(row: Row): Row {
  const m = row.messages, user = JSON.parse(m[1].content);
  if (m.map(v => v.role).join() !== "system,user,assistant" || m[0].content !== V2_SYSTEM ||
      Object.keys(user).sort().join() !== "exercises,sentence") throw new Error("Unexpected training contract");
  return { ...row, messages: [{ role: "system", content: V4_ENUM_SYSTEM }, ...m.slice(1)] };
}

export function buildV7() {
  const old = buildV6();
  const files: Record<string, string> = { ...old.files, "dev-control.jsonl": old.files["dev.jsonl"],
    "S-train.gold.jsonl": old.files["T-train.gold.jsonl"],
    "S-train.jsonl": jsonl(lines(old.files["T-train.jsonl"]).map(alignPrompt)),
    "dev.jsonl": jsonl(lines(old.files["dev.jsonl"]).map(alignPrompt)) };
  return { files, manifest: { version: "v7-prompt-alignment-1", gpuReady: false,
    provenance: "V6 T training sentences, labels, catalogs and order unchanged. Only S train/dev system uses the existing v4 inference enum. No new examples or private originals/derivatives. Inference inputs and all gold remain frozen.",
    sourceV6ManifestSha256: sha(JSON.stringify(old.manifest)), rows: 6400,
    controlSystem: V2_SYSTEM, alignedSystem: V4_ENUM_SYSTEM,
    unchangedTextSequenceSha256: old.manifest.sourceTextSequenceSha256,
    unchangedTargetSequenceSha256: old.manifest.sharedTargetSequenceSha256,
    files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, { sha256: sha(data), lines: data.trim().split("\n").length }])) } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url)), built = buildV7(), path = `${root}data/v7-manifest.json`;
  if (process.argv.includes("--check")) {
    if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(built.manifest)) throw new Error("V7 manifest drift");
  } else {
    mkdirSync(`${root}data/generated/v7`, { recursive: true });
    for (const [name, text] of Object.entries(built.files)) writeFileSync(`${root}data/generated/v7/${name}`, text);
    writeFileSync(path, JSON.stringify(built.manifest, null, 2) + "\n");
  }
  console.log(JSON.stringify({ rows: built.manifest.rows, newExamples: 0, gpuReady: false }));
}
