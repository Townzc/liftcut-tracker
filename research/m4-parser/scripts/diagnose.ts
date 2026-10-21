import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CLARIFY_REASONS, parseLabelSchema } from "@liftcut/core/parse-label";
import { resolveLabel, resolveOutput, type EvalItem } from "@liftcut/core/eval/parse-label-eval";
import { samePlain } from "@liftcut/core/plain-data";
import { groundParseLabel } from "@liftcut/core/parse-label-grounding";

type Prediction = { id: string; output: string };
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Post-hoc explanation of saved outputs, never a replacement scorer or repair.
 * Counts are rows, can overlap, and are distinct from invented numeric fields.
 * Exactness uses the frozen scorer's resolved-session semantics; literal label
 * differences (including a different valid clarify reason) are separate.
 */
export function diagnose(gold: EvalItem[], predictions: Prediction[]) {
  const ids = new Set(gold.map(row => row.id)), byId = new Map(predictions.map(row => [row.id, row]));
  if (!gold.length || ids.size !== gold.length || byId.size !== predictions.length
      || [...gold, ...predictions].some(row => typeof row.id !== "string" || !row.id)
      || gold.length !== predictions.length || gold.some(row => !byId.has(row.id))) {
    throw new Error("Prediction IDs must exactly match nonempty gold, without duplicates");
  }
  const counts: Record<string, number> = {}, invalidReasons: Record<string, number> = {};
  const issues: Record<string, number> = {}, rows: { id: string; tags: string[] }[] = [];
  const add = (target: Record<string, number>, key: string) => { target[key] = (target[key] ?? 0) + 1; };
  let resolvedExact = 0, literalExact = 0;
  const oracleGuard = { actionable: 0, acceptedGold: 0, rejectedGold: 0 };
  for (const item of gold) {
    parseLabelSchema.parse(item.label);
    if (item.label.intent !== "clarify") {
      // Isolate acceptance of reference labels, not a model/rule baseline or
      // a general ceiling: another literal label may resolve equivalently.
      oracleGuard.actionable++;
      if (groundParseLabel(item.text, item.label, item.context.exercises.map(name => ({ name }))).status === "grounded") oracleGuard.acceptedGold++;
      else oracleGuard.rejectedGold++;
    }
    const raw = byId.get(item.id)!.output, parsed = resolveOutput(raw, item.context);
    const truth = resolveLabel(item.label, item.context), tags: string[] = [];
    let value: unknown;
    try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")); }
    catch { tags.push("invalid_json"); }
    if (parsed.json && !parsed.schema) tags.push("invalid_schema");
    const schema = parseLabelSchema.safeParse(value);
    if (parsed.json && !schema.success) {
      // One occurrence per issue path/code per row, even if a union repeats it.
      for (const issue of new Set(schema.error.issues.map(i => `${i.path.join(".") || "$"}:${i.code}`))) add(issues, issue);
    }
    if (samePlain(parsed.resolved, truth)) resolvedExact++;
    if (samePlain(value, item.label)) literalExact++;
    else tags.push("literal_label_differs");
    if (!samePlain(parsed.resolved, truth)) tags.push("resolved_answer_differs");
    if (object(value)) {
      if (value.intent === "clarify" && !CLARIFY_REASONS.some(reason => reason === value.reason)) {
        tags.push("unsupported_clarify_reason"); add(invalidReasons, JSON.stringify(value.reason) ?? "undefined");
      }
      if ((value.intent === "skip" || value.intent === "correct") && value.target == null) tags.push("missing_target");
      if (item.label.intent === "clarify" && ["record", "repeat", "correct", "skip", "end"].includes(String(value.intent))) tags.push("action_instead_of_clarify");
      if (item.label.intent !== "clarify" && value.intent === "clarify") tags.push("clarify_instead_of_action");
      if (item.label.intent === "record" && value.intent === "record" && Array.isArray(value.sets)) {
        if (value.sets.length > item.label.sets.length) tags.push("extra_sets");
        if (value.sets.length < item.label.sets.length) tags.push("missing_sets");
      }
      if ("exercise" in item.label && "exercise" in value && !samePlain(item.label.exercise, value.exercise)) {
        tags.push("literal_exercise_differs");
      }
    }
    for (const tag of tags) add(counts, tag);
    if (tags.length) rows.push({ id: item.id, tags });
  }
  return { mode: "post-hoc-saved-output-diagnosis", newModelCalls: 0, total: gold.length,
    resolvedExact, literalExact, counts, invalidReasons, schemaIssues: issues, oracleGuard, rows,
    note: "Overlapping row counts, not invented-field counts. Oracle feeds gold to the guard, not a model result. No corrected outputs or changed acceptance gates." };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (key: string) => {
    const index = process.argv.indexOf(key);
    if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${key}`);
    return process.argv[index + 1];
  };
  const gold = readFileSync(arg("--gold")), pred = readFileSync(arg("--pred"));
  const read = (bytes: Buffer) => bytes.toString("utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  const report = { source: { goldSha256: hash(gold), predictionsSha256: hash(pred) }, ...diagnose(read(gold), read(pred)) };
  writeFileSync(arg("--out"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ ...report, rows: undefined }));
}
