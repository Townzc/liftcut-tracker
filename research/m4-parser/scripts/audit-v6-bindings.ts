/** Post-result, saved-output attribution. Does not change labels, scores or training. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { identifyExercise } from "@liftcut/core/exercise-catalog";
import { parseLabelSchema } from "@liftcut/core/parse-label";
import { resolveLabel, resolveOutput, type EvalItem } from "@liftcut/core/eval/parse-label-eval";
import { samePlain } from "@liftcut/core/plain-data";

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export function bindingCategory(item: EvalItem, raw: string): string | null {
  let value: unknown;
  try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { return null; }
  const parsed = parseLabelSchema.safeParse(value);
  if (item.label.intent !== "record" || !parsed.success || parsed.data.intent !== "record") return null;
  const prediction = parsed.data, gold = item.label;
  if (!samePlain(prediction.sets, gold.sets) || prediction.exercise === gold.exercise) return null;
  const resolved = resolveLabel(prediction, item.context), target = resolveLabel(gold, item.context);
  if (samePlain(resolved, target)) return "resolved_equal";
  const name = prediction.exercise ?? item.context.selected;
  if (!name) return "unresolved_implicit_exercise";
  const targetName = gold.exercise ?? item.context.selected;
  const targetId = targetName ? identifyExercise(targetName)?.id : undefined;
  const predictedId = identifyExercise(name)?.id;
  const sameIdentity = targetId !== undefined && targetId === predictedId;
  if (!item.context.exercises.includes(name)) return sameIdentity ? "unavailable_same_identity"
    : predictedId ? "unavailable_other_identity" : "unavailable_unknown_name";
  if (resolved.intent !== "record") return "session_refused";
  return sameIdentity ? "available_same_identity" : "different_available_identity";
}

export function auditBindings(root: string, manifestSha: string) {
  const manifestBytes = readFileSync(join(root, "sha256.json"));
  if (sha(manifestBytes) !== manifestSha) throw new Error("Manifest hash mismatch");
  const manifest: Record<string, string> = JSON.parse(manifestBytes.toString("utf8"));
  const inputs: Record<string, string> = {};
  const read = (name: string) => {
    const bytes = readFileSync(join(root, name)), hash = sha(bytes);
    if (manifest[name] !== hash) throw new Error(`Input hash mismatch: ${name}`);
    inputs[name] = hash;
    return bytes.toString("utf8");
  };
  const gold = ["dev-eval", "challenge", "handwritten"].flatMap((set, i) => {
    const rows: EvalItem[] = read(`${set}.gold.jsonl`).trim().split("\n").map(s => JSON.parse(s));
    if (rows.length !== [740, 240, 60][i]) throw new Error("Gold partition mismatch");
    return rows.map(item => ({ set, item }));
  });
  const ids = new Set(gold.map(({ item }) => item.id));
  if (ids.size !== 1040) throw new Error("Duplicate gold ID");
  const arms = Object.fromEntries(["H", "T", "S", "S-HF", "S-F16"].map(arm => {
    const rows: { id: string; output: string }[] = read(`${arm}.jsonl`).trim().split("\n").map(s => JSON.parse(s));
    const predictions = new Map(rows.map(row => [row.id, row.output]));
    if (rows.length !== 1040 || predictions.size !== 1040 || [...predictions.keys()].some(id => !ids.has(id)))
      throw new Error("Incomplete or mismatched prediction stream");
    const partitions = Object.fromEntries(["dev-eval", "challenge", "handwritten"].map(set => {
      const buckets: Record<string, string[]> = {}, failures: string[] = [];
      for (const { item } of gold.filter(g => g.set === set)) {
        const raw = predictions.get(item.id)!;
        const category = bindingCategory(item, raw);
        if (category) (buckets[category] ??= []).push(item.id);
        if (!samePlain(resolveOutput(raw, item.context).resolved, resolveLabel(item.label, item.context))) failures.push(item.id);
      }
      // The original three arms must reconcile to their original server scores.
      if (["H", "T", "S"].includes(arm)) {
        const score = JSON.parse(read(`compare-${arm}-${set}.json`)).metrics.raw;
        if (!samePlain([...score.failureIds].sort(), [...failures].sort())) throw new Error("Frozen score mismatch");
      }
      return [set, { exact: gold.filter(g => g.set === set).length - failures.length,
        fieldsExactLiteralExerciseMismatch: Object.values(buckets).reduce((n, b) => n + b.length, 0),
        categories: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, { count: v.length, ids: v }])) }];
    }));
    return [arm, partitions];
  }));
  return { mode: "Post-result binding attribution; literal mismatch is not an actual write or a changed score",
    sourcesLfSha256: Object.fromEntries(["audit-v6-bindings.ts", "../../../packages/core/src/exercise-catalog.ts",
      "../../../packages/core/src/parse-label.ts", "../../../packages/core/src/eval/parse-label-eval.ts",
      "../../../packages/core/src/plain-data.ts"].map(path => [path,
      sha(readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n"))])),
    newModelCalls: 0, manifestSha256: manifestSha, inputsSha256: inputs, arms };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const option = (name: string) => {
    const i = process.argv.indexOf(name);
    if (i < 0 || !process.argv[i + 1]) throw new Error(`${name} required`);
    return process.argv[i + 1];
  };
  const report = auditBindings(option("--run-dir"), option("--manifest-sha"));
  writeFileSync(option("--out"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ arms: Object.keys(report.arms), newModelCalls: 0 }));
}
