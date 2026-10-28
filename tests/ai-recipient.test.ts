import assert from "node:assert/strict";
import { test } from "node:test";
import { aiRecipientSchema, hasRecipientConsent, recipientConsentValue } from "@liftcut/core/ai-recipient";
import { coachRequestSchema } from "@liftcut/core/coach-contract";
import { resolveAiRecipient, recipientConsentError, recipientConsentResponse } from "../src/services/ai/recipient-policy";
import { coachFixture } from "./fixtures/coach-contract";

const config = { baseURL: "https://api.deepseek.com/v1", model: "deepseek-flash" };

test("recipient comes from the reviewed effective endpoint, never an SDK label", () => {
  const deepseek = resolveAiRecipient(config)!;
  assert.equal(deepseek.name, "DeepSeek");
  assert.equal(deepseek.origin, "https://api.deepseek.com");
  assert.equal(resolveAiRecipient({ ...config, baseURL: "https://api.openai.com/v1" })?.name, "OpenAI");
  assert.deepEqual(Object.keys(deepseek), ["id", "name", "origin", "model"]);
  assert.equal(JSON.stringify(deepseek).includes("/v1"), false);
  assert.equal(aiRecipientSchema.safeParse({ ...deepseek, name: "OpenAI" }).success, false);
});

test("unknown endpoints, URL credentials, paths and malformed models fail closed", () => {
  for (const baseURL of ["bad", "http://api.deepseek.com/v1", "https://relay.example/v1", "http://127.0.0.1:8000/v1",
    "https://api.deepseek.com.evil.example/v1", "https://api.deepseek.com:444/v1", "https://user:secret@api.deepseek.com/v1",
    "https://api.deepseek.com/v1?key=secret", "https://api.deepseek.com/v1#secret", "https://api.deepseek.com/relay"])
    assert.equal(resolveAiRecipient({ ...config, baseURL }), null, baseURL);
  for (const model of ["", "x".repeat(201), "a\nb"]) assert.equal(resolveAiRecipient({ ...config, model }), null);
  assert.equal(resolveAiRecipient(null), null);
});

test("consent is bound to endpoint, model and policy; stale/legacy consent never silently transfers", () => {
  const recipient = resolveAiRecipient(config)!;
  assert.deepEqual(resolveAiRecipient({ ...config, baseURL: `${config.baseURL}/` }), recipient);
  const changed = [resolveAiRecipient({ ...config, model: "new-model" })!,
    resolveAiRecipient({ ...config, baseURL: "https://api.openai.com/v1" })!,
    resolveAiRecipient({ ...config, baseURL: "https://api.deepseek.com" })!];
  assert.equal(hasRecipientConsent(recipientConsentValue(recipient), recipient), true);
  for (const value of [undefined, null, "coach-model-v2", recipient.id, {}, recipientConsentValue(changed[0])])
    assert.equal(hasRecipientConsent(value, recipient), false);
  for (const next of changed) {
    assert.notEqual(next.id, recipient.id);
    assert.equal(recipientConsentError(recipient.id, next), "AI_CONSENT_REQUIRED");
  }
  assert.equal(hasRecipientConsent(recipientConsentValue(recipient), null), false);
  assert.equal(recipientConsentError(recipient.id, recipient), null);
  assert.equal(recipientConsentError(undefined, recipient), "AI_CONSENT_REQUIRED");
  assert.equal(recipientConsentError(recipient.id, null), "AI_RECIPIENT_UNREVIEWED");
});

test("request transport remains backward compatible while accepting only bounded policy tokens", () => {
  const { request } = coachFixture(), recipient = resolveAiRecipient(config)!;
  assert.deepEqual(coachRequestSchema.parse(request), request);
  assert.equal(coachRequestSchema.parse({ ...request, recipient: recipient.id }).recipient, recipient.id);
  for (const value of [null, "", "a".repeat(63), "A".repeat(64), "https://api.deepseek.com", { id: recipient.id }])
    assert.equal(coachRequestSchema.safeParse({ ...request, recipient: value }).success, false);
});

test("route boundary returns actionable no-store renewal errors and never exposes private config", async () => {
  const full = { ...config, provider: "deepseek" as const, apiKey: "never-publish-this", timeoutMs: 1000 };
  const recipient = resolveAiRecipient(full)!;
  assert.equal(recipientConsentResponse(recipient.id, full), null);
  for (const token of [undefined, "a".repeat(64)]) {
    const response = recipientConsentResponse(token, full)!;
    assert.equal(response.status, 409);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    const body = await response.json();
    assert.equal(body.error, "AI_CONSENT_REQUIRED");
    assert.match(body.message, /Refresh or update/);
    assert.equal(JSON.stringify(body).includes(full.apiKey), false);
  }
  const blocked = recipientConsentResponse(recipient.id, { ...full, baseURL: "https://relay.example/private-path" })!;
  const body = await blocked.json();
  assert.equal(body.error, "AI_RECIPIENT_UNREVIEWED");
  assert.equal(JSON.stringify(body).includes("relay.example"), false);
});
