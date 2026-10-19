import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import { REVIEW_SYSTEM, reviewMessage } from "@liftcut/core/review-prompt";
import { buildCases } from "../src/cases";

// Usage: record.ts --name <recording> [--base-url URL] [--model M]
// Records one answer per synthetic case with the live review prompt (temperature 0, JSON mode) into
// recordings/<name>.jsonl for CI replay. Costs one paid call per case; the key is injected by the
// environment's network proxy, so none is read or sent here. Resumable: recorded ids are skipped.
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const name = arg("--name");
if (!name || !/^[a-z0-9.-]+$/.test(name)) { console.error("--name <lowercase-recording-name> is required"); process.exit(2); }
const baseUrl = arg("--base-url") ?? "https://api.deepseek.com", model = arg("--model") ?? "deepseek-chat";
const out = join(__dirname, "../recordings", `${name}.jsonl`), cases = buildCases();
const casesHash = createHash("sha256").update(JSON.stringify(cases)).digest("hex").slice(0, 16);
const done = new Set(existsSync(out) ? readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l).id) : []);

async function main() {
  mkdirSync(dirname(out), { recursive: true });
  let failures = 0, tokens = 0;
  for (const c of cases.filter(x => !done.has(x.id))) {
    const start = performance.now();
    const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ model, temperature: 0, max_tokens: 800, response_format: { type: "json_object" },
        messages: [{ role: "system", content: REVIEW_SYSTEM }, { role: "user", content: reviewMessage(c.plan, c.sets, "zh", c.equipment) }] }) });
    if (response.status === 401 || response.status === 402) throw new Error(`The provider refused the request (${response.status}); nothing more is recorded`);
    if (!response.ok) { failures++; continue; } // Unanswered cases count as missed until recorded again.
    const body = await response.json();
    tokens += body.usage?.total_tokens ?? 0;
    appendFileSync(out, JSON.stringify({ id: c.id, casesHash, model: body.model ?? model, output: body.choices?.[0]?.message?.content ?? "", latencyMs: Math.round(performance.now() - start) }) + "\n");
  }
  console.log(JSON.stringify({ recorded: cases.length - done.size - failures, failures, totalTokens: tokens }));
  if (failures) process.exitCode = 1;
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
