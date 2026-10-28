// Isolated process: server-only modules and synthetic fetches never use live settings.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { callAiProviderForJson, createAiClient } from "../../src/services/ai/client";

async function main() {
  const originalFetch = globalThis.fetch, seen: { url: string; redirect: RequestRedirect | undefined; body: string }[] = [];
  process.env.AI_PROVIDER = "openai_compatible";
  process.env.AI_BASE_URL = "https://changed.example.invalid/v1";
  process.env.AI_API_KEY = "changed-synthetic-key";
  process.env.AI_MODEL = "changed-model";
  const checked = { provider: "deepseek" as const, baseURL: "https://api.deepseek.com/v1", model: "checked-model", apiKey: "synthetic-key", timeoutMs: 1000 };
  globalThis.fetch = async (input, options) => {
    seen.push({ url: String(input), redirect: options?.redirect, body: String(options?.body) });
    return Response.json({ id: "fixture", choices: [{ message: { content: '{"safe":true}' }, finish_reason: "stop", index: 0 }] });
  };
  try {
    const reply = await callAiProviderForJson({ systemPrompt: "synthetic", userPrompt: "synthetic" }, checked);
    assert.deepEqual(reply.json, { safe: true });
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, "https://api.deepseek.com/v1/chat/completions");
    assert.equal(JSON.parse(seen[0].body).model, "checked-model");
    assert.equal(seen[0].redirect, "error");
  } finally { globalThis.fetch = originalFetch; }
  let requests = 0;
  const server = createServer((_request, response) => { requests++; response.writeHead(307, { Location: "/other-recipient" }); response.end(); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const client = createAiClient({ ...checked, baseURL: `http://127.0.0.1:${address.port}/v1` });
    await assert.rejects(client.chat.completions.create({ model: "synthetic", messages: [{ role: "user", content: "synthetic" }] }));
    assert.equal(requests, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
}
void main().catch(() => { console.error("Recipient client fixture failed"); process.exitCode = 1; });
