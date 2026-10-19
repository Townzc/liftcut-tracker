import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assistantMessage, SFT_SYSTEM_PROMPT, userMessage } from "../src/prompt";
import type { Item } from "../src/synth";

// Usage: export-sft.ts [--limit N]   (run build-data.ts first)
// Writes chat-format files for the Python trainer: sft/{train,dev}.jsonl with the answer,
// eval/{dev,test,handwritten}.jsonl without it. Answers never appear in the eval files.
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const i = process.argv.indexOf("--limit"), limit = i > 0 ? Number(process.argv[i + 1]) : Infinity;
const read = (path: string): Item[] => readFileSync(join(root, path), "utf8").trim().split("\n").map(line => JSON.parse(line)).slice(0, limit);
const prompt = (item: Item) => [{ role: "system", content: SFT_SYSTEM_PROMPT }, { role: "user", content: userMessage(item) }];
const write = (path: string, rows: unknown[]) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), rows.map(r => JSON.stringify(r)).join("\n") + "\n"); };
for (const split of ["train", "dev"]) write(`data/generated/sft/${split}.jsonl`, read(`data/generated/${split}.jsonl`)
  .map(item => ({ id: item.id, messages: [...prompt(item), { role: "assistant", content: assistantMessage(item) }] })));
const sets = { dev: "data/generated/dev.jsonl", test: "data/generated/test.jsonl", handwritten: "data/handwritten-test.jsonl" };
for (const [name, path] of Object.entries(sets)) {
  const items = read(path);
  write(`data/generated/eval/${name}.jsonl`, items.map(item => ({ id: item.id, messages: prompt(item) })));
  write(`data/generated/eval/${name}.gold.jsonl`, items); // The scorer's input, cut to the same limit.
}
console.log(JSON.stringify({ limit: Number.isFinite(limit) ? limit : null, sets: Object.keys(sets) }));
