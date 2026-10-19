import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { resolveOutput, resolveRuleResult, ruleContext, scoreParses, type EvalItem, type Scored } from "@liftcut/core/eval/parse-label-eval";
import { parseWorkoutLog } from "@liftcut/core/workout-log-parser";

// Usage: evaluate.ts --gold <items.jsonl> (--rules | --pred <predictions.jsonl>) [--out <metrics.json>]
// Predictions are one JSON object per line: {"id": "...", "output": "<raw model text>", "latencyMs": 123}.
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const lines = (path: string) => readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
const gold: EvalItem[] = lines(arg("--gold") ?? process.exit(2));
let rows: Scored[];
if (process.argv.includes("--rules")) {
  rows = gold.map(item => {
    const context = ruleContext(item.context), start = performance.now(), result = parseWorkoutLog(item.text, context);
    return { item, pred: resolveRuleResult(result), latencyMs: Math.round((performance.now() - start) * 1000) / 1000 };
  });
} else {
  const predictions = new Map<string, { output: string; latencyMs?: number }>(lines(arg("--pred") ?? process.exit(2)).map(p => [p.id, p]));
  rows = gold.map(item => {
    const p = predictions.get(item.id); // A missing answer counts as invalid output, never as a skip.
    const parsed = p ? resolveOutput(p.output, item.context) : { json: false, schema: false, resolved: null };
    return { item, pred: parsed.resolved, json: parsed.json, schema: parsed.schema, latencyMs: p?.latencyMs };
  });
}
const { failures, ...metrics } = scoreParses(rows);
const report = { gold: arg("--gold"), system: process.argv.includes("--rules") ? "rules-v1" : arg("--pred"), ...metrics, failures: failures.slice(0, 40) };
if (arg("--out")) writeFileSync(arg("--out")!, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ ...metrics, byFamily: undefined, byLanguage: undefined, failures: failures.length }));
