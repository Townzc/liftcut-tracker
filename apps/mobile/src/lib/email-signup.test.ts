import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { emailSignupStorageKey, MOBILE_SIGNUP_TTL_MS, mobileEmailAppLink, type PendingEmailSignup } from "@liftcut/core/mobile-email-auth";
import { EmailSignupController, PENDING_EMAIL_SIGNUP } from "./email-signup";
import type { EmailStorage, SignupAuthFactory } from "./email-signup-client";

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
function setup() {
  const data = new Map<string, string>();
  const state = { owner: null as string | null, time: 1000, sends: 0, exchanges: 0, cancels: 0, failWrite: false,
    email: "test@local.test", confirmed: "2026-10-27", send: async () => {}, verify: async () => {}, close: async () => {} };
  const storage: EmailStorage = {
    getItem: async key => { await Promise.resolve(); return data.get(key) ?? null; },
    setItem: async (key, value) => { await Promise.resolve(); if (state.failWrite) throw new Error("disk_failed"); data.set(key, value); },
    removeItem: async key => { await Promise.resolve(); data.delete(key); },
  };
  const auth: SignupAuthFactory = (key, store) => ({
    async send() { state.sends++; await store.setItem(`${key}-code-verifier`, "synthetic-verifier");
      await store.setItem(key, "temporary-token"); await state.send(); },
    async verify() { state.exchanges++; assert.equal(JSON.parse(data.get(PENDING_EMAIL_SIGNUP)!).phase, "exchanging");
      assert.equal(await store.getItem(`${key}-code-verifier`), "synthetic-verifier"); await state.verify();
      return { email: state.email, email_confirmed_at: state.confirmed }; },
    cancel() { state.cancels++; }, async close() { await state.close(); },
  });
  const create = () => new EmailSignupController({ storage, auth, owner: async () => state.owner, uuid: randomUUID, now: () => state.time });
  const link = (pending: PendingEmailSignup) => mobileEmailAppLink({ attempt: pending.attempt, code: "a".repeat(32), lang: "en" });
  return { data, state, storage, create, link, controller: create() };
}

test("async persisted pending and verifier survive controller recreation; tokens and password do not", async () => {
  const h = setup(), pending = await h.controller.start(" Test@local.test ", "private-password", "en");
  assert.equal(pending.email, "test@local.test"); assert.equal(h.data.size, 2);
  assert.ok(!JSON.stringify([...h.data]).match(/private-password|temporary-token/));
  assert.deepEqual(await h.create().pending(), pending);
  assert.equal(await h.create().verify(h.link(pending)), pending.email);
  assert.equal(h.state.exchanges, 1); assert.equal(h.data.size, 0);
  await assert.rejects(h.create().verify(h.link(pending))); assert.equal(h.state.exchanges, 1);
});

test("duplicate warm callback shares one claim and cannot replay", async () => {
  const h = setup(), pending = await h.controller.start(h.state.email, "password", "en"), gate = deferred(), entered = deferred();
  h.state.verify = async () => { entered.resolve(); await gate.promise; };
  const first = h.controller.verify(h.link(pending)); await entered.promise;
  assert.equal(h.controller.verify(h.link(pending)), first); gate.resolve(); await first;
  await assert.rejects(h.controller.verify(h.link(pending))); assert.equal(h.state.exchanges, 1);
});

test("invalid URLs, different attempt and active accounts do not exchange or replace another account", async () => {
  const h = setup(), pending = await h.controller.start(h.state.email, "password", "en"), url = h.link(pending);
  for (const invalid of [url.replace("liftcut:", "https:"), url.replace("/callback", "/other"), `${url}#access_token=x`, `${url}&next=https://example.com`, url.replace(pending.attempt, randomUUID())]) await assert.rejects(h.controller.verify(invalid));
  h.state.owner = "another-account"; await assert.rejects(h.controller.verify(url));
  await assert.rejects(h.controller.start("other@local.test", "password", "en"));
  assert.equal(h.state.exchanges, 0); assert.equal(h.state.sends, 1); assert.equal(h.state.owner, "another-account");
  assert.equal(await h.controller.pending(), null); assert.equal(h.data.size, 0);
});

test("missing verifier, unconfirmed identity and wrong email fail closed and discard the claim", async () => {
  for (const variant of ["verifier", "confirmation", "email"]) {
    const h = setup(), pending = await h.controller.start(h.state.email, "password", "en");
    if (variant === "verifier") h.data.delete(`${emailSignupStorageKey(pending.attempt)}-code-verifier`);
    if (variant === "confirmation") h.state.confirmed = "";
    if (variant === "email") h.state.email = "other@local.test";
    await assert.rejects(h.controller.verify(h.link(pending))); assert.equal(h.data.size, 0);
    assert.equal(h.state.exchanges, variant === "verifier" ? 0 : 1);
  }
});

test("expired, future, malformed and interrupted pending state cannot resume", async () => {
  for (const variant of ["expired", "future", "malformed", "exchanging"]) {
    const h = setup(), pending = await h.controller.start(h.state.email, "password", "en");
    if (variant === "expired") h.state.time += MOBILE_SIGNUP_TTL_MS;
    if (variant === "future") h.state.time--;
    if (variant === "malformed") h.data.set(PENDING_EMAIL_SIGNUP, "{");
    if (variant === "exchanging") h.data.set(PENDING_EMAIL_SIGNUP, JSON.stringify({ ...pending, phase: "exchanging" }));
    await assert.rejects(h.create().verify(h.link(pending))); assert.equal(h.state.exchanges, 0);
    assert.equal(await h.create().pending(), null); assert.equal(h.data.has(PENDING_EMAIL_SIGNUP), false);
  }
});

test("cancel persists before slow send/exchange settles; late results cannot revive a cancelled attempt", async () => {
  for (const phase of ["send", "verify"] as const) {
    const h = setup(), entered = deferred(), release = deferred();
    let pending: PendingEmailSignup | undefined;
    if (phase === "verify") pending = await h.controller.start(h.state.email, "password", "en");
    h.state[phase] = async () => { entered.resolve(); await release.promise; };
    const operation = phase === "send" ? h.controller.start(h.state.email, "password", "en") : h.controller.verify(h.link(pending!));
    const rejected = assert.rejects(operation, /cancelled/); await entered.promise;
    await h.controller.cancel(); assert.equal(h.data.size, 0); assert.equal(await h.create().pending(), null);
    release.resolve(); await rejected; assert.equal(h.data.size, 0); assert.equal(h.state.cancels, 1);
  }
});

test("account change or expiry during verification/cleanup never reports success", async () => {
  for (const phase of ["verify", "close"] as const) for (const change of ["owner", "expiry"]) {
    const h = setup(), pending = await h.controller.start(h.state.email, "password", "en");
    h.state[phase] = async () => { if (change === "owner") h.state.owner = "other"; else h.state.time += MOBILE_SIGNUP_TTL_MS; };
    await assert.rejects(h.controller.verify(h.link(pending))); assert.equal(h.data.size, 0);
    if (change === "owner") assert.equal(h.state.owner, "other");
  }
});

test("durable claim failure prevents network exchange and failed initial persistence prevents signup", async () => {
  const h = setup(); h.state.failWrite = true;
  await assert.rejects(h.controller.start(h.state.email, "password", "en"), /disk_failed/); assert.equal(h.state.sends, 0);
  h.state.failWrite = false; const pending = await h.controller.start(h.state.email, "password", "en");
  h.state.failWrite = true; await assert.rejects(h.controller.verify(h.link(pending)), /disk_failed/);
  assert.equal(h.state.exchanges, 0); assert.equal(h.data.size, 0);
});

test("cancellation or account change during signup cleanup discards the pending registration", async () => {
  for (const action of ["cancel", "owner"]) {
    const h = setup(); h.state.close = async () => { if (action === "cancel") await h.controller.cancel(); else h.state.owner = "other"; };
    await assert.rejects(h.controller.start(h.state.email, "password", "en")); assert.equal(h.data.size, 0);
  }
});

test("a new request waits for the cancelled exchange; stale cleanup cannot erase its verifier", async () => {
  const h = setup(), pending = await h.controller.start(h.state.email, "password", "en"), entered = deferred(), release = deferred();
  h.state.verify = async () => { entered.resolve(); await release.promise; };
  const rejected = assert.rejects(h.controller.verify(h.link(pending))); await entered.promise; await h.controller.cancel();
  const next = h.controller.start(h.state.email, "new-password", "en"); release.resolve(); await rejected;
  const replacement = await next; assert.notEqual(replacement.attempt, pending.attempt);
  assert.deepEqual(await h.controller.pending(), replacement); assert.equal(h.data.size, 2);
});
