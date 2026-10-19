import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError } from "./api";
import { askCoach } from "./coach";

const auth = { access_token: "a.b.c", user: { id: "owner-1" } }, id = "5f0c7f4e-8a51-4d4e-9d7e-0c2f5b0b9a11";
const input = { id, text: "深蹲做了几组？", history: [], locale: "zh" as const, timezone: "Asia/Shanghai" };
const line = (event: unknown) => JSON.stringify(event) + "\n";
const result = (extra: object = {}) => line({ type: "result", result: { requestId: id, message: "你好", model: "m", provider: "p", sources: [], ...extra } });
/** Serves the bytes in the given pieces; the last one waits for `hold` when given. */
function server(pieces: Uint8Array[], status = 200, hold?: Promise<void>) {
  const log = { init: undefined as RequestInit | undefined };
  const fetcher = (async (_url: string, init: RequestInit) => {
    log.init = init;
    if (status !== 200) return new Response(JSON.stringify({ error: "RATE_LIMITED" }), { status });
    let i = 0;
    return new Response(new ReadableStream<Uint8Array>({ async pull(c) {
      if (i === pieces.length - 1) await hold;
      const next = pieces[i++]; if (next) c.enqueue(next); else c.close();
    } }));
  }) as typeof fetch;
  return { log, fetcher };
}
const bytes = (...parts: string[]) => parts.map(p => new TextEncoder().encode(p));

test("the reply grows as chunks arrive, a split character survives, and only the validated result is returned", async () => {
  const wire = new TextEncoder().encode(line({ type: "status", stage: "connecting" }) + line({ type: "text", text: "你" }) + line({ type: "text", text: "好" }) + result());
  const cut = wire.indexOf(0xe4) + 1; // Inside the three bytes of 你.
  // The result is held back until the first text is shown (or 2 s pass, which fails the check below).
  let release = () => {}, released = false;
  const hold = new Promise<void>(resolve => { release = () => { released = true; resolve(); }; setTimeout(release, 2000); });
  const { log, fetcher } = server([wire.slice(0, cut), wire.slice(cut, wire.length - 20), wire.slice(wire.length - 20)], 200, hold);
  const seen: [string, boolean][] = [];
  const reply = await askCoach(auth, input, text => { seen.push([text, released]); release(); }, undefined, fetcher);
  assert.equal(reply.message, "你好");
  assert.deepEqual(seen, [["你", false], ["你好", true]]); // The first text arrives while the end is still held back.
  const headers = log.init!.headers as Record<string, string>, body = JSON.parse(log.init!.body as string);
  assert.equal(headers.Authorization, "Bearer a.b.c"); assert.equal(headers.Accept, "application/x-ndjson");
  assert.deepEqual([body.consent, body.id, body.text], ["coach-model-v1", id, input.text]);
});

test("a truncated, failed or foreign stream never becomes a reply", async () => {
  await assert.rejects(askCoach(auth, input, () => {}, undefined, server(bytes(line({ type: "text", text: "半句" }))).fetcher), /STREAM_INCOMPLETE/);
  await assert.rejects(askCoach(auth, input, () => {}, undefined, server(bytes(line({ type: "error", error: "MODEL_TIMEOUT" }))).fetcher), /MODEL_TIMEOUT/);
  await assert.rejects(askCoach(auth, input, () => {}, undefined, server(bytes(result({ requestId: "other" }))).fetcher), /STREAM_INVALID/);
  await assert.rejects(askCoach(auth, input, () => {}, undefined, server(bytes(result({ proposal: { kind: "workout", hash: "h" } }))).fetcher)); // No operation to queue.
  await assert.rejects(askCoach(auth, input, () => {}, undefined, server([], 429).fetcher), (e: unknown) => e instanceof ApiError && e.code === "RATE_LIMITED");
});
