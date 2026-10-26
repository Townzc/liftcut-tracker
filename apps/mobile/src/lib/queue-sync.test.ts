import assert from "node:assert/strict";
import { test } from "node:test";
import { startQueueSync } from "./queue-sync";

test("app lifetime retries on any screen, backs off while active, resumes foreground, and releases its listeners", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const calls: string[] = [];
  let listener: ((state: string) => void) | null = null;
  const lifecycle = { currentState: "active", addEventListener(_event: "change", cb: (state: string) => void) {
    listener = cb; return { remove() { listener = null; } };
  } };
  const change = (state: string) => { lifecycle.currentState = state; listener?.(state); };
  const stop = startQueueSync({ resume: async () => { calls.push("resume"); }, drain: async () => { calls.push("retry"); } },
    { drain: async () => { calls.push("personal"); return "synced" as const; } }, lifecycle);
  assert.deepEqual(calls, ["resume", "personal"]);
  calls.length = 0;
  t.mock.timers.tick(5000); assert.deepEqual(calls, ["retry", "personal"]);
  calls.length = 0;
  change("background"); t.mock.timers.tick(60000); assert.deepEqual(calls, []);
  change("active"); assert.deepEqual(calls, ["resume", "personal"]);
  change("active"); assert.equal(calls.length, 2); // Duplicate signals don't reset transport backoff.
  calls.length = 0;
  stop(); t.mock.timers.tick(60000); change("active");
  assert.deepEqual(calls, []); assert.equal(listener, null);
});

test("a cold start in the background waits; one queue's storage error cannot disable future retries", async t => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  let onChange: (state: string) => void = () => {}, writes = 0, personal = 0;
  const stop = startQueueSync({ resume: async () => { throw new Error("storage unavailable"); },
    drain: async () => { writes++; } }, { drain: async () => { personal++; return "synced" as const; } },
  { currentState: "background", addEventListener(_event, callback) { onChange = callback; return { remove() {} }; } });
  try {
    assert.equal(personal, 0); onChange("active");
    await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(5000);
    assert.equal(writes, 1); assert.equal(personal, 2);
  } finally { stop(); }
});
