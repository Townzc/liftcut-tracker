import assert from "node:assert/strict";
import { test } from "node:test";
import { recipientConsentValue } from "@liftcut/core/ai-recipient";
import { RecipientConsent, statusRecipient } from "./recipient-consent";

const recipient = { id: "a".repeat(64), name: "DeepSeek" as const, origin: "https://api.deepseek.com" as const, model: "fixture" };
const status = { available: true, recipient };
const later = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };

test("legacy consent requires an explicit new click; unknown/offline status never authorizes sending", async () => {
  let saved: string | null = "coach-model-v2";
  const store = new RecipientConsent({ read: async () => saved, write: async value => { saved = value; }, status: async () => status });
  await store.refresh(); assert.equal(store.token(), null);
  await store.change(true); assert.equal(store.token(), recipient.id);
  assert.equal(saved, recipientConsentValue(recipient));
  for (const input of [{ ...status, available: false }, { available: true }, { ...status, recipient: { ...recipient, origin: "https://other.example" } }])
    assert.equal(statusRecipient(input), null);
  const offline = new RecipientConsent({ read: async () => saved, write: async () => {}, status: async () => { throw Error("offline"); } });
  await offline.refresh(); assert.equal(offline.token(), null); assert.equal(offline.snapshot().failed, true);
});

test("failed storage never grants consent and failed revocation cannot restore it on refresh", async () => {
  let saved: string | null = null, fail = true;
  const store = new RecipientConsent({ read: async () => saved, write: async value => { if (fail) throw Error("storage"); saved = value; }, status: async () => status });
  await store.refresh(); await store.change(true); assert.equal(store.token(), null);
  fail = false; await store.change(true); assert.equal(store.token(), recipient.id);
  fail = true; await store.invalidate(); assert.equal(store.token(), null);
});

test("revocation supersedes a slow status read; a different policy and owner need fresh consent", async () => {
  const pending = later<unknown>(); let saved: string | null = recipientConsentValue(recipient);
  const store = new RecipientConsent({ read: async () => saved, write: async value => { saved = value; }, status: () => pending.promise });
  const refresh = store.refresh(); await store.change(false);
  pending.resolve(status); await refresh; assert.equal(store.token(), null);
  const changed = new RecipientConsent({ read: async () => recipientConsentValue(recipient), write: async () => {},
    status: async () => ({ ...status, recipient: { ...recipient, id: "b".repeat(64), model: "changed" } }) });
  await changed.refresh(); assert.equal(changed.token(), null);
  const otherOwner = new RecipientConsent({ read: async () => null, write: async () => {}, status: async () => status });
  await otherOwner.refresh(); assert.equal(otherOwner.token(), null);
});
