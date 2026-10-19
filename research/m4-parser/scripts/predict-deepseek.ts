import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { SYSTEM_PROMPT, userMessage } from "../src/prompt";
import type { Item } from "../src/synth";

// Usage: predict-deepseek.ts --gold <items.jsonl> --out <predictions.jsonl> [--limit N] [--base-url URL]
// Cloud baseline: one request per sentence, temperature 0, JSON mode. The key is injected by the
// environment's network proxy, so none is read or sent here. Resumable: ids already in --out are skipped.
const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const goldPath = arg("--gold"), outPath = arg("--out");
if (!goldPath || !outPath) { console.error("--gold and --out are required"); process.exit(2); }
const baseUrl = arg("--base-url") ?? "https://api.deepseek.com", model = "deepseek-chat", limit = Number(arg("--limit") ?? Infinity);
const done = new Set(existsSync(outPath) ? readFileSync(outPath, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l).id) : []);
const items: Item[] = readFileSync(goldPath, "utf8").trim().split("\n").map(l => JSON.parse(l)).filter((i: Item) => !done.has(i.id)).slice(0, limit);

let tokens = 0, failures = 0;
async function ask(item: Item) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const start = performance.now();
    const response = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ model, temperature: 0, max_tokens: 400, response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content: userMessage(item) }] }) });
    const latencyMs = Math.round(performance.now() - start);
    if (response.status === 401 || response.status === 402) throw new Error(`DeepSeek refused the request (${response.status}): ${await response.text()}`);
    if (!response.ok) { if (attempt === 0) continue; failures++; return; } // One retry, then the item stays unanswered.
    const body = await response.json();
    tokens += body.usage?.total_tokens ?? 0;
    appendFileSync(outPath!, JSON.stringify({ id: item.id, model: body.model ?? model, output: body.choices?.[0]?.message?.content ?? "", latencyMs }) + "\n");
    return;
  }
}
const queue = [...items];
Promise.all(Array.from({ length: 4 }, async () => { for (let item = queue.shift(); item; item = queue.shift()) await ask(item); })).then(() => {
  console.log(JSON.stringify({ requested: items.length, failures, totalTokens: tokens }));
  if (failures) process.exitCode = 1;
}, error => { console.error(error.message); process.exitCode = 1; });
