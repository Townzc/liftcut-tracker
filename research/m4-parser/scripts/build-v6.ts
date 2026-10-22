import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildV4 } from "./build-v4";
import { repairAliases, trainingPolicyProblems, varyCatalogs } from "../src/training-policy-v6";
import { V2_SYSTEM } from "../src/contrastive-data";
import type { Item } from "../src/synth";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const jsonl = (rows: unknown[]) => rows.map(r => JSON.stringify(r)).join("\n") + "\n";
export function buildV6() {
  const old = buildV4(), original: Item[] = old.files["train.gold.jsonl"].trim().split("\n").map(s => JSON.parse(s));
  const control = repairAliases(original), candidate = varyCatalogs(control);
  const corrections = original.flatMap((r, i) => JSON.stringify(r.label) === JSON.stringify(control[i].label) ? []
    : [{ sourceId: r.id, id: control[i].id, from: r.label, to: control[i].label }]);
  if (corrections.length !== 40 || control.length !== 6400) throw new Error("Alias correction count drift");
  const files: Record<string, string> = Object.fromEntries(Object.entries(old.files).filter(([name]) => !name.startsWith("train")));
  for (const [arm, rows] of [["T", control], ["S", candidate]] as const) {
    for (const [i, row] of rows.entries()) {
      const problems = trainingPolicyProblems(row);
      if (problems.length) throw new Error(`${arm} ${row.id}: ${problems.join(", ")}`);
      if (row.text !== original[i].text || JSON.stringify(row.label) !== JSON.stringify(control[i].label)) throw new Error("Text or paired-label drift");
    }
    files[`${arm}-train.gold.jsonl`] = jsonl(rows);
    files[`${arm}-train.jsonl`] = jsonl(rows.map(r => ({ id: r.id, messages: [
      { role: "system", content: V2_SYSTEM }, { role: "user", content: JSON.stringify({ exercises: r.context.exercises, sentence: r.text }) },
      { role: "assistant", content: JSON.stringify(r.label) },
    ] })));
  }
  const count = (rows: Item[], key: (r: Item) => string) => rows.reduce<Record<string, number>>((a, r) => { const k = key(r); a[k] = (a[k] ?? 0) + 1; return a; }, {});
  const bindings = (rows: Item[]) => count(rows.filter(r => "exercise" in r.label && r.label.exercise !== null), r =>
    String(r.context.exercises.indexOf("exercise" in r.label ? r.label.exercise! : "")));
  return { files, manifest: { version: "v6-registry-catalog-1", gpuReady: false,
    provenance: "All 6400 sentence bytes stay identical to v4 training. Forty alias labels corrected from paired labels and registry in BOTH arms. S only varies training-derived catalog membership/order, preserving target labels. No evaluation/private text or derivatives generate rows.",
    sourceV4ManifestSha256: sha(JSON.stringify(old.manifest)), corrections, rowsPerArm: control.length,
    sourceTextSequenceSha256: sha(jsonl(original.map(r => r.text))),
    sharedTargetSequenceSha256: sha(jsonl(control.map(r => r.label))),
    catalogChanges: candidate.filter((r, i) => JSON.stringify(r.context.exercises) !== JSON.stringify(control[i].context.exercises)).length,
    policyErrors: 0, trainIntents: count(control, r => r.label.intent), targetPositions: { T: bindings(control), S: bindings(candidate) },
    files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, { sha256: sha(data), lines: data.trim().split("\n").length }])) } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL("../", import.meta.url)), built = buildV6(), path = `${root}data/v6-manifest.json`;
  if (process.argv.includes("--check")) {
    if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(built.manifest)) throw new Error("V6 manifest drift");
  } else {
    mkdirSync(`${root}data/generated/v6`, { recursive: true });
    for (const [name, text] of Object.entries(built.files)) writeFileSync(`${root}data/generated/v6/${name}`, text);
    writeFileSync(path, JSON.stringify(built.manifest, null, 2) + "\n");
  }
  console.log(JSON.stringify({ rowsPerArm: built.manifest.rowsPerArm, aliasCorrections: built.manifest.corrections.length,
    policyErrors: built.manifest.policyErrors, catalogChanges: built.manifest.catalogChanges }));
}
