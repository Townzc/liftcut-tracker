import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLARIFY_REASONS, parseLabelSchema } from "@liftcut/core/parse-label";
import { resolveOutput, type EvalItem } from "@liftcut/core/eval/parse-label-eval";

const out = process.argv[process.argv.indexOf("--out-dir") + 1];
if (!process.argv.includes("--out-dir") || !out) throw new Error("--out-dir required");
const read = (name: string) => JSON.parse(readFileSync(join(out, name), "utf8"));
const lines = (name: string) => readFileSync(join(out, name), "utf8").trim().split("\n").map(s => JSON.parse(s));
const splits = ["dev-eval", "challenge", "handwritten"], names = ["A", "B", "C", "D"];
const targets = ["missing_unit", "rpe_scope", "unknown_exercise"];
const gold: EvalItem[] = splits.flatMap(s => lines(`${s}.gold.jsonl`));
const challenge: EvalItem[] = lines("challenge.gold.jsonl");
const summaries: Record<string, unknown> = {}, failed: Record<string, Set<string>> = {};
for (const arm of names) {
  const predictions: { id: string; output: string }[] = lines(`${arm}.jsonl`), byId = new Map(predictions.map(p => [p.id, p]));
  if (byId.size !== predictions.length || gold.length !== predictions.length || gold.some(g => !byId.has(g.id))) throw new Error("prediction IDs differ");
  const value = (item: EvalItem): unknown => { try { return JSON.parse(byId.get(item.id)!.output); } catch { return null; } };
  failed[arm] = new Set(splits.flatMap(s => read(`compare-${arm}-${s}.json`).metrics.raw.failureIds));
  let invalidClarificationReasons = 0, correctReason = 0, clarificationGold = 0, falseRefusals = 0;
  for (const item of gold) {
    const v = value(item) as { intent?: string; reason?: string } | null;
    if (v?.intent === "clarify" && !(CLARIFY_REASONS as readonly unknown[]).includes(v.reason)) invalidClarificationReasons++;
    if (item.label.intent === "clarify") {
      clarificationGold++;
      const parsed = parseLabelSchema.safeParse(v);
      if (parsed.success && parsed.data.intent === "clarify" && parsed.data.reason === item.label.reason) correctReason++;
    } else if (resolveOutput(byId.get(item.id)!.output, item.context).resolved?.intent === "clarify") falseRefusals++;
  }
  const focus = Object.fromEntries(targets.map(reason => {
    const negative = challenge.filter(g => g.family === `contrast_${reason}_negative`);
    const positive = challenge.filter(g => g.family === `contrast_${reason}_positive`);
    if (negative.length !== 15 || positive.length !== 15) throw new Error("focus denominator drift");
    return [reason, { negativeTotal: negative.length, correctReason: negative.filter(g => {
      const p = parseLabelSchema.safeParse(value(g));
      return p.success && p.data.intent === "clarify" && p.data.reason === reason;
    }).length, positiveTotal: positive.length, positiveExact: positive.filter(g => !failed[arm].has(g.id)).length }];
  }));
  const positive = challenge.filter(g => g.label.intent !== "clarify");
  summaries[arm] = { focus, invalidClarificationReasons, correctReason, clarificationGold, falseRefusals,
    challengePositive: { total: positive.length, exact: positive.filter(g => !failed[arm].has(g.id)).length } };
}
const comparisons = Object.fromEntries([["A", "B"], ["A", "C"], ["B", "D"], ["C", "D"]].map(([a, b]) => {
  return [`${a}->${b}`, Object.fromEntries(splits.map(split => {
    const groups: Record<string, { total: number; bothCorrect: number; gained: number; lost: number; bothWrong: number }> = {};
    for (const item of lines(`${split}.gold.jsonl`) as EvalItem[]) {
      const group = groups[item.family] ??= { total: 0, bothCorrect: 0, gained: 0, lost: 0, bothWrong: 0 };
      const old = !failed[a].has(item.id), next = !failed[b].has(item.id);
      group.total++; group[old && next ? "bothCorrect" : old ? "lost" : next ? "gained" : "bothWrong"]++;
    }
    return [split, groups];
  }))];
}));
writeFileSync(join(out, "factor-summary.json"), JSON.stringify({ arms: summaries, comparisons,
  note: "Original resolved scores unchanged; strict clarification reason accuracy is an additional gate. Observed inputs, not independent holdout." }, null, 2) + "\n", { flag: "wx" });
