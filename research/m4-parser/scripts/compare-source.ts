import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { groundParseLabel } from "@liftcut/core/parse-label-grounding";
import { groundParseLabelV2, parseSourceLabelV2 } from "@liftcut/core/parse-label-grounding-v2";
import { resolveLabel, resolveOutput, scoreParses, type EvalItem, type Scored } from "@liftcut/core/eval/parse-label-eval";
import { samePlain } from "@liftcut/core/plain-data";

/** Diagnostic replay only. Baseline is called with text + available names, never
 * gold or model output. Frozen v2 raw scores/gates are not replaced by this report. */
export function compareSource(gold: EvalItem[], predictions: { id: string; output: string }[]) {
  const ids = new Set(gold.map(g => g.id)), byId = new Map(predictions.map(p => [p.id, p]));
  if (!gold.length || ids.size !== gold.length || byId.size !== predictions.length
    || [...gold, ...predictions].some(r => typeof r.id !== "string" || !r.id)
    || gold.length !== predictions.length || gold.some(g => !byId.has(g.id))) throw new Error("Exact nonempty unique IDs required");
  const modes = ["raw", "guardV1", "guardV2", "sourceOnlyV2"] as const;
  const rows: Record<typeof modes[number], Scored[]> = { raw: [], guardV1: [], guardV2: [], sourceOnlyV2: [] };
  const accepted = { guardV1: 0, guardV2: 0, sourceOnlyV2: 0 };
  const unsafeIds: Record<keyof typeof accepted, string[]> = { guardV1: [], guardV2: [], sourceOnlyV2: [] };
  const changed: { id: string; v1: boolean; v2: boolean; baseline: boolean }[] = [];
  let actionable = 0;
  for (const item of gold) {
    const text = byId.get(item.id)!.output, original = resolveOutput(text, item.context);
    const exercises = item.context.exercises.map(name => ({ name }));
    const truth = resolveLabel(item.label, item.context);
    if (truth.intent !== "clarify") actionable++;
    const baseline = parseSourceLabelV2(item.text, exercises);
    let value: unknown;
    try { value = JSON.parse(text); } catch { value = null; }
    const v1 = groundParseLabel(item.text, value, exercises), v2 = groundParseLabelV2(item.text, value, exercises);
    rows.raw.push({ item, pred: original.resolved, json: original.json, schema: original.schema });
    const labels = { guardV1: v1.status === "grounded" ? v1.label : null,
      guardV2: v2.status === "grounded" ? v2.label : null, sourceOnlyV2: baseline };
    for (const mode of ["guardV1", "guardV2", "sourceOnlyV2"] as const) {
      const label = labels[mode], pred = label ? resolveLabel(label, item.context) : { intent: "clarify" as const };
      if (pred.intent !== "clarify") {
        accepted[mode]++;
        if (!samePlain(pred, truth)) unsafeIds[mode].push(item.id);
      }
      rows[mode].push({ item, pred });
    }
    if (!!labels.guardV1 !== !!labels.guardV2 || !!labels.guardV2 !== !!baseline)
      changed.push({ id: item.id, v1: !!labels.guardV1, v2: !!labels.guardV2, baseline: !!baseline });
  }
  const metrics = Object.fromEntries(modes.map(mode => {
    const { failures, ...scores } = scoreParses(rows[mode]);
    return [mode, { ...scores, failureIds: failures.map(f => f.id), ...(mode === "raw" ? {} : {
      actionable, accepted: accepted[mode], correctAccepted: accepted[mode] - unsafeIds[mode].length,
      unsafeAccepted: unsafeIds[mode].length, unsafeIds: unsafeIds[mode],
    }) }];
  }));
  return { mode: "post-hoc-source-version-replay", newModelCalls: 0, metrics, changed,
    limitation: "Previously observed inputs. Source-v2 is a deterministic grammar baseline; guarded model coverage is its subset, not evidence of model added value. No candidate gate changed." };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = (key: string) => { const i = process.argv.indexOf(key);
    if (i < 0 || !process.argv[i + 1]) throw new Error(`Missing ${key}`); return process.argv[i + 1]; };
  const gold = readFileSync(arg("--gold")), pred = readFileSync(arg("--pred"));
  const read = (data: Buffer) => data.toString("utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
  const report = { source: { goldSha256: sha(gold), predictionsSha256: sha(pred),
    guardV1Sha256: sha(readFileSync(new URL("../../../packages/core/src/parse-label-grounding.ts", import.meta.url))),
    guardV2Sha256: sha(readFileSync(new URL("../../../packages/core/src/parse-label-grounding-v2.ts", import.meta.url))) },
    ...compareSource(read(gold), read(pred)) };
  writeFileSync(arg("--out"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report.metrics).map(([k, v]) => [k,
    { exact: v.exact, total: v.total, invented: v.invented, accepted: v.accepted, unsafe: v.unsafeAccepted }]))));
}
