/** Post-result diagnostics of saved synthetic outputs, never training or rescoring. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLARIFY_REASONS, parseLabelSchema } from "@liftcut/core/parse-label";
import { resolveLabel, resolveOutput, type EvalItem } from "@liftcut/core/eval/parse-label-eval";
import { samePlain } from "@liftcut/core/plain-data";
import { bindingCategory } from "./audit-v6-bindings";
import { decisionProblems } from "./audit-v7-decisions";

type Prediction = { id: string; output: string };
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

export function residuals(gold: EvalItem[], predictions: Prediction[], originalFailures: string[]) {
  const goldIds = new Set(gold.map(r => r.id));
  const byId = new Map(predictions.map(r => [r.id, r.output]));
  if (goldIds.size !== gold.length || byId.size !== predictions.length || byId.size !== goldIds.size
    || [...byId.keys()].some(id => !goldIds.has(id))) throw new Error("Duplicate or mismatched IDs");
  const failures = gold.filter(item => !samePlain(resolveOutput(byId.get(item.id)!, item.context).resolved,
    resolveLabel(item.label, item.context))).map(item => item.id);
  if (!samePlain([...failures].sort(), [...originalFailures].sort())) throw new Error("Frozen failure IDs mismatch");

  const failed = new Set(failures);
  const partition: Record<string, string[]> = {};
  const shapes = { invalidJson: 0, missingIntent: 0, invalidSchema: 0 };
  const illegalReasons: { id: string; reason: unknown }[] = [];
  const failedCases = [];
  for (const item of gold) {
    const output = byId.get(item.id)!;
    let value: unknown;
    try { value = JSON.parse(output); } catch { shapes.invalidJson++; }
    const object = value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown> : null;
    if (value !== undefined && (!object || !("intent" in object))) shapes.missingIntent++;
    const parsed = parseLabelSchema.safeParse(value);
    if (!parsed.success) shapes.invalidSchema++;
    if (object?.intent === "clarify" && !(CLARIFY_REASONS as readonly unknown[]).includes(object.reason))
      illegalReasons.push({ id: item.id, reason: object.reason ?? null });
    if (!failed.has(item.id)) continue;
    const binding = bindingCategory(item, output);
    const category = binding === "different_available_identity" ? binding
      : item.label.intent === "clarify" ? "negative_" + item.label.reason : "other";
    (partition[category] ??= []).push(item.id);
    const label = parsed.success ? parsed.data : null;
    let rpeAssignment: string | null = null;
    if (item.label.intent === "clarify" && item.label.reason === "rpe_scope" && label?.intent === "record") {
      const indices = label.sets.flatMap((s, i) => s.rpe === null ? [] : [i]);
      rpeAssignment = indices.length === 0 ? "none" : indices.length === label.sets.length ? "every_set"
        : indices.length === 1 && indices[0] === label.sets.length - 1 ? "last_set_only" : "other_subset";
    }
    failedCases.push({ id: item.id, family: item.family, language: item.language, category, binding,
      issues: decisionProblems(item, output), rpeAssignment,
      expected: item.label, output });
  }
  return { total: gold.length, exact: gold.length - failures.length, failures: failures.length,
    partition: Object.fromEntries(Object.entries(partition).map(([k, ids]) => [k, { count: ids.length, ids }])),
    shapes, illegalReasons, failedCases };
}

export function auditResiduals(root: string, manifestSha: string) {
  const bytes = readFileSync(join(root, "sha256.json"));
  if (sha(bytes) !== manifestSha) throw new Error("Manifest hash mismatch");
  const manifest: Record<string, string> = JSON.parse(bytes.toString("utf8"));
  const inputs: Record<string, string> = {};
  const read = (name: string) => {
    const bytes = readFileSync(join(root, name)), hash = sha(bytes);
    if (manifest[name] !== hash) throw new Error(`Input hash mismatch: ${name}`);
    inputs[name] = hash;
    return bytes.toString("utf8");
  };
  const gold = ["dev-eval", "challenge", "handwritten"].map((split, index) => {
    const rows: EvalItem[] = read(`${split}.gold.jsonl`).trim().split("\n").map(s => JSON.parse(s));
    if (rows.length !== [740, 240, 60][index]) throw new Error("Gold partition mismatch");
    return { split, rows, ids: new Set(rows.map(r => r.id)) };
  });
  const allIds = new Set(gold.flatMap(s => [...s.ids]));
  if (allIds.size !== 1040) throw new Error("Duplicate gold ID");
  const arms = Object.fromEntries(["A", "B", "C", "D"].map(arm => {
    const predictions: Prediction[] = read(`${arm}.jsonl`).trim().split("\n").map(s => JSON.parse(s));
    if (predictions.length !== 1040 || new Set(predictions.map(p => p.id)).size !== 1040
      || predictions.some(p => !allIds.has(p.id))) throw new Error("Incomplete prediction stream");
    return [arm, Object.fromEntries(gold.map(({ split, rows, ids }) => {
      const original = JSON.parse(read(`compare-${arm}-${split}.json`)).metrics.raw;
      return [split, residuals(rows, predictions.filter(p => ids.has(p.id)), original.failureIds)];
    }))];
  }));
  return { mode: "Post-result residual attribution; original scores unchanged", newModelCalls: 0,
    manifestSha256: manifestSha, inputsSha256: inputs, arms,
    sourcesLfSha256: Object.fromEntries(["audit-v8-residuals.ts", "audit-v6-bindings.ts", "audit-v7-decisions.ts",
      "../../../packages/core/src/parse-label.ts", "../../../packages/core/src/eval/parse-label-eval.ts",
      "../../../packages/core/src/parse-label-roles.ts", "../../../packages/core/src/exercise-catalog.ts",
      "../../../packages/core/src/plain-data.ts"].map(p => [p, sha(readFileSync(new URL(p, import.meta.url), "utf8").replace(/\r\n/g, "\n"))])),
    limitations: "Observed synthetic development only. Categories are descriptive, not causes. Partition is exclusive; issue counts overlap. No private originals/derivatives, training, repaired predictions or actual writes." };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const option = (name: string) => {
    const i = process.argv.indexOf(name);
    if (i < 0 || !process.argv[i + 1]) throw new Error(`${name} required`);
    return process.argv[i + 1];
  };
  const report = auditResiduals(option("--run-dir"), option("--manifest-sha"));
  writeFileSync(option("--out"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ arms: Object.keys(report.arms), candidateFailures: report.arms.D.challenge.failures,
    partition: report.arms.D.challenge.partition, newModelCalls: 0 }));
}
