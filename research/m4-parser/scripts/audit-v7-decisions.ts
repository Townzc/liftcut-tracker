/** Saved-output diagnostics only. No generation, training input, score or guard changes. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CLARIFY_REASONS, parseLabelSchema } from "@liftcut/core/parse-label";
import { labelRoleProblems } from "@liftcut/core/parse-label-roles";
import type { EvalItem } from "@liftcut/core/eval/parse-label-eval";

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");

export function decisionProblems(item: EvalItem, raw: string): string[] {
  let value: unknown;
  try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); }
  catch { return ["invalid_json"]; }
  const parsed = parseLabelSchema.safeParse(value);
  if (!parsed.success) {
    const v = value as { intent?: unknown; reason?: unknown } | null;
    return ["invalid_schema", ...(v?.intent === "clarify" && !(CLARIFY_REASONS as readonly unknown[]).includes(v.reason)
      ? ["illegal_clarification_reason"] : [])];
  }
  if (item.label.intent !== "clarify") return parsed.data.intent === "clarify" ? ["false_refusal"] : [];
  const label = parsed.data, expected = item.label.reason;
  if (label.intent === "clarify") return label.reason === expected ? [] : ["wrong_legal_reason"];
  const problems = ["clarification_replaced_by_" + label.intent];
  const values = label.intent === "record" ? label.sets : label.intent === "correct" ? [label.changes] : [];
  if (expected === "missing_unit") {
    for (const unit of ["kg", "lb"] as const) if (values.some(v => v.unit === unit)) problems.push("unstated_unit_" + unit);
    // Necessary source-role evidence only; this is not a general semantic parser.
    if (labelRoleProblems(item.text, value, item.context.exercises).some(p => p.endsWith(".reps_role")))
      problems.push("unverified_reps_role");
  }
  if (expected === "missing_reps" && values.some(v => v.reps != null)) problems.push("unstated_reps");
  if (expected === "rpe_scope" && label.intent === "record") {
    const withRpe = label.sets.filter(s => s.rpe !== null).length;
    if (withRpe > 1) problems.push("effort_assigned_to_multiple_sets");
    if (withRpe > 1 && withRpe === label.sets.length) problems.push("effort_assigned_to_every_set");
  }
  return problems;
}

export function auditDecisions(root: string, manifestSha: string) {
  const bytes = readFileSync(join(root, "sha256.json"));
  if (sha(bytes) !== manifestSha) throw new Error("Manifest hash mismatch");
  const manifest: Record<string, string> = JSON.parse(bytes.toString("utf8")), inputs: Record<string, string> = {};
  const read = (name: string) => {
    const content = readFileSync(join(root, name)), hash = sha(content);
    if (manifest[name] !== hash) throw new Error(`Input hash mismatch: ${name}`);
    inputs[name] = hash;
    return content.toString("utf8").trim().split("\n").map(s => JSON.parse(s));
  };
  const splits = ["dev-eval", "challenge", "handwritten"];
  const gold = splits.map((split, i) => {
    const rows: EvalItem[] = read(`${split}.gold.jsonl`);
    if (rows.length !== [740, 240, 60][i]) throw new Error("Gold partition mismatch");
    return { split, rows };
  });
  const ids = new Set(gold.flatMap(s => s.rows.map(r => r.id)));
  if (ids.size !== 1040) throw new Error("Duplicate gold ID");
  const arms = Object.fromEntries(["H", "T", "S", "S-HF", "S-F16"].map(arm => {
    const rows: { id: string; output: string }[] = read(`${arm}.jsonl`), byId = new Map(rows.map(r => [r.id, r.output]));
    if (rows.length !== 1040 || byId.size !== 1040 || [...byId.keys()].some(id => !ids.has(id))) throw new Error("Incomplete stream");
    return [arm, Object.fromEntries(gold.map(({ split, rows }) => {
      const families: Record<string, { total: number; issues: Record<string, { count: number; ids: string[] }> }> = {};
      for (const item of rows) {
        const family = families[item.family] ??= { total: 0, issues: {} }; family.total++;
        for (const issue of decisionProblems(item, byId.get(item.id)!)) {
          const bucket = family.issues[issue] ??= { count: 0, ids: [] }; bucket.count++; bucket.ids.push(item.id);
        }
      }
      return [split, families];
    }))];
  }));
  return { mode: "Post-result decision attribution; overlapping counts are not summed into accuracy or actual writes",
    newModelCalls: 0, manifestSha256: manifestSha, inputsSha256: inputs, arms,
    sourcesLfSha256: Object.fromEntries(["audit-v7-decisions.ts", "../../../packages/core/src/parse-label.ts",
      "../../../packages/core/src/parse-label-roles.ts"].map(path => [path, sha(readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n"))])),
    limitations: "Uses frozen synthetic gold for descriptive attribution. Numeric roles are a necessary bounded check, not proof of semantic correctness. No private acceptance text or training is read." };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const option = (name: string) => { const i = process.argv.indexOf(name); if (i < 0 || !process.argv[i + 1]) throw new Error(`${name} required`); return process.argv[i + 1]; };
  const report = auditDecisions(option("--run-dir"), option("--manifest-sha"));
  writeFileSync(option("--out"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ arms: Object.keys(report.arms), newModelCalls: 0 }));
}
