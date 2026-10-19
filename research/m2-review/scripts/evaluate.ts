import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scoreReviews, type ReviewCase, type ReviewScore } from "@liftcut/core/eval/review-eval";
import { buildCases } from "../src/cases";

// Usage: evaluate.ts [--check]
// Replays every recorded answer in recordings/*.jsonl against the synthetic cases and scores two fixed
// bounds next to them. No model is called. --check fails when the committed summary differs, so a
// changed generator, scorer or recording cannot pass CI without its new results being committed.
const root = join(__dirname, ".."), summaryPath = join(root, "results/summary.json");
const cases = buildCases(), casesHash = createHash("sha256").update(JSON.stringify(cases)).digest("hex").slice(0, 16);
const newest = (c: ReviewCase) => c.sets.filter(s => s.date === c.sets[0].date);
// Bounds, not models: one never changes anything, the other always adds a set to the first exercise.
const bounds: Record<string, (c: ReviewCase) => unknown> = {
  "bound-always-nochange": c => ({ outcome: "nochange", why: "按计划继续", evidence: [newest(c)[0].id] }),
  "bound-always-add-set": c => { const name = c.plan.weeks[0].days[0].exercises[0].name;
    return { outcome: "changes", changes: [{ type: "adjust_sets", exercise: name, delta: 1, why: "加一组", evidence: newest(c).filter(s => s.exercise === name).map(s => s.id) }] }; },
};
const parse = (output: string) => { try { return JSON.parse(output); } catch { return output; } };
const systems: Record<string, ReviewScore & { source: string }> = {};
for (const [name, answer] of Object.entries(bounds))
  systems[name] = { source: "bound", ...scoreReviews(cases, new Map(cases.map(c => [c.id, answer(c)]))) };
const recordings = join(root, "recordings");
for (const file of existsSync(recordings) ? readdirSync(recordings).filter(f => f.endsWith(".jsonl")).sort() : []) {
  const rows = readFileSync(join(recordings, file), "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as { id: string; casesHash: string; output: string });
  if (rows.some(r => r.casesHash !== casesHash)) throw new Error(`${file} was recorded for other cases; record it again`);
  systems[file.replace(/\.jsonl$/, "")] = { source: "recording", ...scoreReviews(cases, new Map(rows.map(r => [r.id, parse(r.output)]))) };
}
const summary = { casesHash, cases: cases.length, kinds: [...new Set(cases.map(c => c.kind))], systems };
const text = JSON.stringify(summary, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (!existsSync(summaryPath) || readFileSync(summaryPath, "utf8") !== text) { console.error("results/summary.json is out of date: run npm run m2:review"); process.exit(1); }
  console.log(`summary matches (${Object.keys(systems).length} systems, ${cases.length} cases)`);
} else { writeFileSync(summaryPath, text); console.log(text); }
