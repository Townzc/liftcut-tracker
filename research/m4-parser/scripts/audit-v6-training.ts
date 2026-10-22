/** Training-only inventory. Never reads evaluation utterances or model predictions. */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CLARIFY_REASONS } from "@liftcut/core/parse-label";
import { samePlain } from "@liftcut/core/plain-data";
import { buildV6 } from "./build-v6";
import { V2_SYSTEM } from "../src/contrastive-data";
import { V4_ENUM_SYSTEM } from "../src/contrastive-v4";
import { trainingPolicyProblems } from "../src/training-policy-v6";
import type { Item } from "../src/synth";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const tally = (keys: string[]) => keys.reduce<Record<string, number>>((out, key) => {
  out[key] = (out[key] ?? 0) + 1; return out;
}, {});
export function trainingInventory() {
  const built = buildV6();
  const protocol = JSON.parse(readFileSync(new URL("../train/protocol-v6.json", import.meta.url), "utf8"));
  const manifestText = readFileSync(new URL("../data/v6-manifest.json", import.meta.url), "utf8");
  if (!samePlain(built.manifest, JSON.parse(manifestText))) throw new Error("Training manifest drift");
  const arms = Object.fromEntries(["T", "S"].map(arm => {
    const text = built.files[`${arm}-train.jsonl`], gold = built.files[`${arm}-train.gold.jsonl`];
    if (sha(text) !== protocol.trainingInputAudit[`${arm}-train`].sha256) throw new Error("Training bytes drift");
    const rows: Item[] = gold.trim().split("\n").map(s => JSON.parse(s));
    const messages = text.trim().split("\n").map(s => JSON.parse(s));
    if (messages.some(r => r.messages[0].content !== V2_SYSTEM)) throw new Error("Training system drift");
    const errors = rows.flatMap(r => trainingPolicyProblems(r));
    if (errors.length) throw new Error(`Training policy errors: ${errors.join(",")}`);
    const clarify = rows.filter(r => r.label.intent === "clarify");
    const rpe = rows.filter(r => r.label.intent === "record" && r.label.sets.length > 1 && r.label.sets.some(s => s.rpe !== null));
    return [arm, { rows: rows.length, inputSha256: sha(text), goldSha256: sha(gold), policyErrors: errors.length,
      intents: tally(rows.map(r => r.label.intent)),
      clarificationReasons: tally(clarify.map(r => r.label.intent === "clarify" ? r.label.reason : "unreachable")),
      rpeMultipleSetRecords: rpe.length,
      rpeScopeTargets: tally(rpe.map(r => {
        if (r.label.intent !== "record") throw new Error("Unexpected scope label");
        if (r.label.sets.every(s => s.rpe !== null)) return "each";
        return r.label.sets.slice(0, -1).every(s => s.rpe === null) && r.label.sets.at(-1)!.rpe !== null ? "last" : "other";
      })),
      rpeTemplates: tally(rows.filter(r => r.family.includes("rpe_scope")).map(r => r.template)),
      bindingPositions: tally(rows.filter(r => "exercise" in r.label && r.label.exercise !== null)
        .map(r => String(r.context.exercises.indexOf("exercise" in r.label ? r.label.exercise! : "")))),
    }];
  }));
  return { mode: "Training-only structural audit; no quality estimate, new data or changed prompt", newModelCalls: 0,
    sourcesLfSha256: Object.fromEntries(["audit-v6-training.ts", "build-v6.ts", "../src/training-policy-v6.ts"].map(path =>
      [path, sha(readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n"))])),
    manifestLfSha256: sha(manifestText.replace(/\r\n/g, "\n")),
    trainingSystemSha256: sha(V2_SYSTEM), evaluationSystemSha256: sha(V4_ENUM_SYSTEM),
    sameSystem: String(V2_SYSTEM) === String(V4_ENUM_SYSTEM),
    trainingListedReasonTokens: CLARIFY_REASONS.filter(r => new RegExp(`\\b${r}\\b`).test(V2_SYSTEM)),
    evaluationListedReasonTokens: CLARIFY_REASONS.filter(r => new RegExp(`\\b${r}\\b`).test(V4_ENUM_SYSTEM)),
    arms, limitations: "Prompt mismatch was intentional in v4, not a proven cause. Regeneration checks frozen bytes; no private originals/derivatives or evaluator examples are training inputs." };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--out");
  if (i < 0 || !process.argv[i + 1]) throw new Error("--out required");
  const report = trainingInventory();
  writeFileSync(process.argv[i + 1], JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ rowsPerArm: report.arms.T.rows, policyErrors: report.arms.T.policyErrors + report.arms.S.policyErrors,
    sameSystem: report.sameSystem, newModelCalls: 0 }));
}
