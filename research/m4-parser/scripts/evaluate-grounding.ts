import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { groundParseLabel, GROUNDING_VERSION } from "@liftcut/core/parse-label-grounding";
import { resolveLabel, resolveOutput, scoreParses, type EvalItem, type Scored } from "@liftcut/core/eval/parse-label-eval";
import { samePlain } from "@liftcut/core/plain-data";

// Post-hoc replay of existing model outputs. Never overwrites raw model scores.
// --gold file --pred file --out new-report.json
const arg = (key: string) => process.argv[process.argv.indexOf(key) + 1];
for (const key of ["--gold", "--pred", "--out"]) if (!process.argv.includes(key)) throw new Error(`Missing ${key}`);
const read = (file: string) => readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
const gold: EvalItem[] = read(arg("--gold")), predictions: { id: string; output: string }[] = read(arg("--pred"));
const byId = new Map(predictions.map(p => [p.id, p]));
if (new Set(gold.map(g => g.id)).size !== gold.length || byId.size !== predictions.length
  || gold.length !== predictions.length || gold.some(g => !byId.has(g.id))) throw new Error("Prediction IDs must exactly match gold, without duplicates");
const guarded: Scored[] = [], raw: Scored[] = [], unsafe: string[] = [];
const reasons: Record<string, number> = {};
let accepted = 0, rejectedCorrect = 0;
for (const item of gold) {
  const prediction = byId.get(item.id)!, original = resolveOutput(prediction.output, item.context);
  let value: unknown;
  try { value = JSON.parse(prediction.output); } catch { value = null; }
  const result = groundParseLabel(item.text, value, item.context.exercises.map(name => ({ name })));
  const pred = result.status === "grounded" ? resolveLabel(result.label, item.context) : { intent: "clarify" as const };
  const truth = resolveLabel(item.label, item.context);
  if (result.status === "grounded") { accepted++; if (!samePlain(pred, truth)) unsafe.push(item.id); }
  else {
    reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    if (truth.intent !== "clarify" && samePlain(original.resolved, truth)) rejectedCorrect++;
  }
  raw.push({ item, pred: original.resolved }); guarded.push({ item, pred });
}
const metrics = (rows: Scored[]) => { const { failures, ...scores } = scoreParses(rows); return { ...scores, failures: failures.slice(0, 20) }; };
const digest = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
const report = { version: GROUNDING_VERSION, mode: "post-hoc-system-replay", newModelCalls: 0,
  source: { goldSha256: digest(arg("--gold")), predictionsSha256: digest(arg("--pred")) },
  accepted, rejectedCorrect, unsafeAccepted: unsafe.length, unsafeIds: unsafe, reasons, raw: metrics(raw), guarded: metrics(guarded) };
writeFileSync(arg("--out"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ accepted, rejectedCorrect, unsafeAccepted: unsafe.length, rawExact: report.raw.exact,
  guardedExact: report.guarded.exact, invented: report.guarded.invented, total: gold.length }));
