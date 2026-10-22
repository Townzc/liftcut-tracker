/** Post-result attribution from complete saved synthetic outputs; no model calls. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLARIFY_REASONS, parseLabelSchema } from "@liftcut/core/parse-label";
import type { EvalItem } from "@liftcut/core/eval/parse-label-eval";

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} required`);
  return process.argv[index + 1];
};
const root = option("--run-dir"), output = option("--out");
const manifest: Record<string, string> = JSON.parse(readFileSync(join(root, "sha256.json"), "utf8"));
const inputs: Record<string, string> = {};
const read = (name: string) => {
  const bytes = readFileSync(join(root, name));
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (manifest[name] !== sha) throw new Error(`Input hash mismatch: ${name}`);
  inputs[name] = sha;
  return bytes.toString("utf8");
};
const gold: EvalItem[] = read("challenge.gold.jsonl").trim().split("\n").map(s => JSON.parse(s));
type Prediction = { id: string; output: string };
const predictions: Record<string, Map<string, Prediction>> = {};
const failed: Record<string, Set<string>> = {};
for (const arm of ["T", "S"]) {
  const rows: Prediction[] = read(`${arm}.jsonl`).trim().split("\n").map(s => JSON.parse(s));
  predictions[arm] = new Map(rows.map(r => [r.id, r]));
  if (rows.length !== 1040 || predictions[arm].size !== 1040) throw new Error("Incomplete stream");
  const score = JSON.parse(read(`compare-${arm}-challenge.json`)).metrics.raw;
  failed[arm] = new Set<string>(score.failureIds);
  if (score.total !== gold.length || score.exact !== gold.length - failed[arm].size) throw new Error("Score mismatch");
}
if (gold.length !== 240 || new Set(gold.map(g => g.id)).size !== 240) throw new Error("Challenge mismatch");
const goldIds = new Set(gold.map(g => g.id));
if (Object.values(failed).some(ids => [...ids].some(id => !goldIds.has(id)))) throw new Error("Unknown failure ID");
const decode = (arm: string, id: string) => {
  const row = predictions[arm].get(id);
  if (!row) throw new Error("Missing prediction");
  try { return JSON.parse(row.output); } catch { return null; }
};
const lost = gold.filter(g => !failed.T.has(g.id) && failed.S.has(g.id));
const gained = gold.filter(g => failed.T.has(g.id) && !failed.S.has(g.id));
const exerciseOnly: string[] = [], unitFilled: string[] = [], multipleSets: string[] = [];
const reasonRepair: string[] = [], otherGains: string[] = [], unclassifiedLosses: string[] = [];
const exerciseConfusions: Record<string, number> = {};
for (const g of lost) {
  const parsed = parseLabelSchema.safeParse(decode("S", g.id));
  const p = parsed.success ? parsed.data : null;
  if (g.label.intent === "record" && p?.intent === "record" && p.exercise !== g.label.exercise
    && JSON.stringify(p.sets) === JSON.stringify(g.label.sets)) {
    exerciseOnly.push(g.id);
    const key = `${g.label.exercise} -> ${p.exercise}`;
    exerciseConfusions[key] = (exerciseConfusions[key] ?? 0) + 1;
  } else if (g.label.intent === "clarify" && g.label.reason === "missing_unit" && p?.intent === "record") {
    if (p.sets.length === 1 && p.sets[0].unit !== null) unitFilled.push(g.id);
    else if (p.sets.length > 1 && p.sets.every(s => s.unit === null && s.weight === null)) multipleSets.push(g.id);
    else unclassifiedLosses.push(g.id);
  } else unclassifiedLosses.push(g.id);
}
for (const g of gained) {
  const old = decode("T", g.id), parsed = parseLabelSchema.safeParse(decode("S", g.id));
  if (g.label.intent === "clarify" && old?.intent === "clarify"
    && !(CLARIFY_REASONS as readonly unknown[]).includes(old.reason)
    && parsed.success && parsed.data.intent === "clarify" && parsed.data.reason === g.label.reason) reasonRepair.push(g.id);
  else otherGains.push(g.id);
}
const report = { mode: "Post-result attribution; not a training intervention or new acceptance gate", newModelCalls: 0,
  inputsSha256: inputs, challengeTotal: gold.length,
  gained: gained.length, lost: lost.length, exerciseOnly, exerciseConfusions,
  missingUnitFilled: unitFilled, missingUnitExpandedToUnweightedSets: multipleSets,
  invalidReasonRepaired: reasonRepair, otherGains, unclassifiedLosses };
writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(report));
