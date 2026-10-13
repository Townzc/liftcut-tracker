import assert from "node:assert/strict";
import { test } from "node:test";
import { boundedJson, sameOrigin, errorResponse } from "../../src/services/agent/http";
import { planToolPort } from "../../src/services/agent/tool-port";
import type { AgentStore } from "../../src/services/agent/store";

test("cookie mutation gate rejects cross-origin, missing origin and simple form posts", () => {
  const request = (headers: Record<string,string>) => new Request("http://localhost:3000/api/agent/runs", { method: "POST", headers });
  assert.equal(sameOrigin(request({ origin: "http://localhost:3000", "content-type": "application/json" })), true);
  assert.equal(sameOrigin(request({ origin: "https://other.example", "content-type": "application/json" })), false);
  assert.equal(sameOrigin(request({ "content-type": "application/json" })), false);
  assert.equal(sameOrigin(request({ origin: "http://localhost:3000", "content-type": "text/plain" })), false);
});
test("chunked body limit is enforced without trusting Content-Length", async () => {
  const req = new Request("http://localhost:3000", { method: "POST", body: "x".repeat(256 * 1024 + 1) });
  await assert.rejects(boundedJson(req), /REQUEST_TOO_LARGE/);
});
test("transport errors never report success and do not leak SQL/connection secrets", async () => {
  const response = errorResponse(new Error("postgres://secret; COMMIT connection lost"));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, error: "OUTCOME_UNKNOWN", retryable: true });
});
test("model capability port cannot approve, revoke, create a run or impersonate another user", async () => {
  const calls: unknown[] = [];
  const store = { get: (...args: unknown[]) => { calls.push(args); } } as unknown as AgentStore;
  const port = planToolPort(store, "verified-owner", "fixed-run");
  assert.deepEqual(Object.keys(port), ["read", "propose", "execute"]);
  await port.read(); assert.deepEqual(calls, [["verified-owner", "fixed-run"]]);
  assert.equal(Object.isFrozen(port), true);
});
