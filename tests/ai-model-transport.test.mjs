import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fixtureFetch } from "./product-browser/model-transport.mjs";

test("fixture transport maps only the reviewed synthetic model request and preserves request data", async () => {
  const seen = [], transport = fixtureFetch(async (input, options) => {
    seen.push({ url: input instanceof Request ? input.url : input, options, body: input instanceof Request ? await input.text() : options.body });
    return new Response("ok");
  });
  const body = JSON.stringify({ messages: [{ role: "user", content: "synthetic" }] });
  await transport("https://api.deepseek.com/v1/chat/completions", { method: "POST", body });
  await transport(new Request("https://api.deepseek.com/v1/chat/completions", { method: "POST", body }));
  await transport("http://127.0.0.1:55440/auth/v1/user", { headers: { authorization: "synthetic" } });
  assert.deepEqual(seen.slice(0, 2).map(row => row.url), Array(2).fill("http://127.0.0.1:59999/v1/chat/completions"));
  assert.deepEqual(seen.slice(0, 2).map(row => row.body), [body, body]);
  assert.ok(seen.every(row => row.options.redirect === "error"));
  assert.equal(seen[2].options.headers.authorization, "synthetic");
  for (const url of ["https://api.deepseek.com/v1/other", "https://api.deepseek.com/v1/chat/completions?key=x",
    "https://api.openai.com/v1/chat/completions", "https://example.com", "http://127.0.0.1:59998", "http://u:p@127.0.0.1:55440"])
    await assert.rejects(transport(url), /Unexpected fixture request/);
  assert.equal(seen.length, 3);
  assert.throws(() => fixtureFetch(fetch, "443"), /Invalid fixture port/);
});

test("fixture auth redirects are refused before a second HTTP request", async () => {
  let requests = 0;
  const server = createServer((_request, response) => { requests++; response.writeHead(302, { Location: "https://example.invalid" }); response.end(); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = String(server.address().port);
    await assert.rejects(fixtureFetch(fetch, port)(`http://127.0.0.1:${port}/auth/v1/user`));
    assert.equal(requests, 1);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
