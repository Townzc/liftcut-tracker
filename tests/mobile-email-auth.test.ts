import assert from "node:assert/strict";
import test from "node:test";
import { MOBILE_SIGNUP_TTL_MS, emailSignupStorageKey, mobileEmailAppLink, newEmailSignup, parseMobileEmailParams, prepareEmailSignupExchange, requireSignupIdentity } from "../packages/core/src/mobile-email-auth";

const attempt = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const code = "33333333-3333-4333-8333-333333333333", now = 100000000;
const callback = { attempt, code, lang: "en" as const };
const entries = Object.entries(callback);

test("mobile email query is closed, bounded and builds only the fixed app destination", () => {
  assert.deepEqual(parseMobileEmailParams(entries), callback);
  assert.equal(mobileEmailAppLink(callback), `liftcut://auth/callback?attempt=${attempt}&code=${code}&lang=en`);
  assert.equal(parseMobileEmailParams(entries.filter(([key]) => key !== "lang"))?.lang, "zh-CN");
  for (const bad of ["next", "access_token", "refresh_token", "token_hash", "error", "error_description", "__proto__"]) {
    assert.equal(parseMobileEmailParams([...entries, [bad, "ignored"]]), null);
  }
  for (const bad of ["", "<script>alert(1)</script>", "x".repeat(257), "code#access_token=secret"]) {
    assert.equal(parseMobileEmailParams([["attempt", attempt], ["code", bad]]), null);
  }
  for (const pair of entries) assert.equal(parseMobileEmailParams([...entries, pair]), null);
  assert.equal(parseMobileEmailParams([["code", code]]), null);
  assert.equal(parseMobileEmailParams([...entries.filter(([key]) => key !== "lang"), ["lang", "fr"]]), null);
});

test("pending signup survives serialization; claim binds email and the isolated PKCE namespace", () => {
  const pending = JSON.parse(JSON.stringify(newEmailSignup("  Person@local.test ", attempt, now)));
  const result = prepareEmailSignupExchange(pending, callback, null, now + 1);
  assert.equal(result.next.email, "person@local.test");
  assert.equal(result.storageKey, emailSignupStorageKey(attempt));
  assert.notEqual(result.storageKey, emailSignupStorageKey(other));
  assert.equal(pending.phase, "waiting"); // Caller must durably commit next before an exchange.
  assert.equal(result.next.phase, "exchanging");
  assert.equal(requireSignupIdentity(result.next, { email: "PERSON@local.test", email_confirmed_at: "2026-10-27" }).phase, "completed");
  assert.throws(() => requireSignupIdentity(result.next, { email: "other@local.test", email_confirmed_at: "2026-10-27" }), /identity/);
  assert.throws(() => requireSignupIdentity(result.next, { email: pending.email }), /identity/);
});

test("existing session, wrong attempt, replay, cancellation, expired and future pending requests fail closed", () => {
  const pending = newEmailSignup("person@local.test", attempt, now);
  assert.throws(() => prepareEmailSignupExchange(pending, callback, "already-signed-in-user", now), /already_signed_in/);
  assert.throws(() => prepareEmailSignupExchange(pending, { ...callback, attempt: other }, null, now), /not_pending/);
  for (const phase of ["exchanging", "cancelled", "completed"]) assert.throws(() => prepareEmailSignupExchange({ ...pending, phase }, callback, null, now), /not_pending/);
  for (const time of [now - 1, now + MOBILE_SIGNUP_TTL_MS, Number.NaN]) assert.throws(() => prepareEmailSignupExchange(pending, callback, null, time), /expired/);
  assert.throws(() => prepareEmailSignupExchange({ ...pending, password: "must-not-be-stored" }, callback, null, now));
  assert.throws(() => prepareEmailSignupExchange(null, callback, null, now));
});
