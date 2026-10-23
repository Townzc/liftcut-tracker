/** Retrospective counts from hash-bound saved outputs and original failure IDs. No rescoring or inference. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseLabelSchema } from "@liftcut/core/parse-label";
import type { EvalItem } from "@liftcut/core/eval/parse-label-eval";
import { bindingCategory } from "./audit-v6-bindings";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
type Source = { id: string; root: string; manifestSha: string; prediction: string; score: string; scoreSha: string; expectedExact: number };
export function historyAudit(sources: Source[]) {
  let commonGold = "";
  const states = new Map<string, Set<string>>(), goldRows = new Map<string, EvalItem[]>();
  const arms = sources.map(source => {
    const manifestBytes = readFileSync(join(source.root, "sha256.json"));
    if (sha(manifestBytes) !== source.manifestSha) throw new Error("Manifest hash mismatch");
    const manifest: Record<string, string> = JSON.parse(manifestBytes.toString("utf8"));
    const checked = (name: string) => {
      const bytes = readFileSync(join(source.root, name));
      if (sha(bytes) !== manifest[name]) throw new Error("Saved input hash mismatch");
      return bytes;
    };
    const goldBytes = checked("challenge.gold.jsonl"), predBytes = checked(source.prediction);
    const gold: EvalItem[] = goldBytes.toString("utf8").trim().split("\n").map(s => JSON.parse(s));
    const pred: { id: string; output: string }[] = predBytes.toString("utf8").trim().split("\n").map(s => JSON.parse(s));
    const byId = new Map(pred.map(p => [p.id, p.output]));
    const goldSha = sha(goldBytes);
    if (gold.length !== 240 || new Set(gold.map(g => g.id)).size !== 240 || byId.size !== pred.length ||
        gold.some(g => !byId.has(g.id)) || (commonGold && commonGold !== goldSha)) throw new Error("Challenge set drift");
    commonGold = goldSha;
    const scoreBytes = readFileSync(source.score);
    if (sha(scoreBytes) !== source.scoreSha) throw new Error("Frozen score hash mismatch");
    const score = JSON.parse(scoreBytes.toString("utf8"));
    if (score.source.goldSha256 !== goldSha || score.metrics.raw.total !== 240) throw new Error("Frozen scorer denominator drift");
    const failed = new Set<string>(score.metrics.raw.failureIds);
    if (240 - failed.size !== source.expectedExact || [...failed].some(id => !gold.some(g => g.id === id))) throw new Error("Historical score mismatch");
    states.set(source.id, failed); goldRows.set(source.id, gold);
    const focus: Record<string, { total: number; resolvedExact: number; strictReasonExact: number }> = {};
    const binding: Record<string, number> = {}; let illegalReasons = 0;
    for (const g of gold) {
      let raw: unknown; try { raw = JSON.parse(byId.get(g.id)!); } catch { raw = null; }
      const label = parseLabelSchema.safeParse(raw);
      if (g.label.intent === "clarify") {
        const f = focus[g.label.reason] ??= { total: 0, resolvedExact: 0, strictReasonExact: 0 }; f.total++;
        if (!failed.has(g.id)) f.resolvedExact++;
        if (label.success && label.data.intent === "clarify" && label.data.reason === g.label.reason) f.strictReasonExact++;
      }
      const r = raw as { intent?: string; reason?: string } | null;
      if (r?.intent === "clarify" && !label.success) illegalReasons++;
      const category = bindingCategory(g, byId.get(g.id)!);
      if (category) binding[category] = (binding[category] ?? 0) + 1;
    }
    return { id: source.id, exact: source.expectedExact, total: 240, focus, binding, illegalClarifySchemas: illegalReasons,
      hashes: { manifest: source.manifestSha, gold: goldSha, predictions: sha(predBytes), frozenScore: source.scoreSha } };
  });
  const pairs = [['v2-Q8','v3-Q8'],['v3-Q8','v4-D'],['v4-D','v5-S'],['v4-D','v6-T'],
    ['v6-T','v6-S'],['v6-T','v7-S'],['v2-Q8','v7-S']];
  const comparisons = Object.fromEntries(pairs.map(([a,b]) => {
    const old = states.get(a), next = states.get(b); if (!old || !next) throw new Error("Missing historical arm");
    const counts = { bothCorrect: 0, gained: 0, lost: 0, bothWrong: 0 }, families: Record<string, typeof counts> = {};
    const lostIds: string[] = [], gainedIds: string[] = [];
    for (const g of goldRows.get(a)!) {
      const key = !old.has(g.id) && !next.has(g.id) ? 'bothCorrect' : !old.has(g.id) ? 'lost' : !next.has(g.id) ? 'gained' : 'bothWrong';
      counts[key]++; (families[g.family] ??= { bothCorrect: 0, gained: 0, lost: 0, bothWrong: 0 })[key]++;
      if (key === 'lost') lostIds.push(g.id); if (key === 'gained') gainedIds.push(g.id);
    }
    return [`${a}->${b}`, { ...counts, families, lostIds, gainedIds }];
  }));
  return { mode: "Historical saved outputs and original resolved-score failure IDs; strict reasons are separate post-result diagnostics",
    sameChallengeBytes: true, challengeSha256: commonGold, newModelCalls: 0, trainingRowsAdded: 0, arms, comparisons,
    limitations: "Observed regression set, not unseen acceptance. Dev changed at v3, so dev totals across that boundary are not directly compared. Different interventions and one seed do not isolate every causal mechanism. No private originals or derivatives read." };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const option = (name: string) => { const i = process.argv.indexOf(name); if (i < 0 || !process.argv[i+1]) throw new Error(name + " required"); return process.argv[i+1]; };
  const result = historyAudit(JSON.parse(readFileSync(option('--sources'), 'utf8')));
  writeFileSync(option('--out'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ exact: result.arms.map(a => [a.id,a.exact]), sameChallengeBytes: true, newModelCalls: 0 }));
}
