import assert from "node:assert/strict";
import test from "node:test";
import { createHash, webcrypto } from "node:crypto";
import { signupAuthFactory } from "./email-signup-client";
import { requireSignupCrypto, requireSignupS256 } from "./signup-crypto";

test("missing secure RNG, SHA-256 or encoder refuses signup before any network request", async () => {
  const crypto = Object.getOwnPropertyDescriptor(globalThis, "crypto")!, encoder = Object.getOwnPropertyDescriptor(globalThis, "TextEncoder")!, fetch = globalThis.fetch;
  let requests = 0;
  try {
    globalThis.fetch = async () => { requests++; throw new Error("network_must_not_run"); };
    for (const missing of ["rng", "digest", "encoder"]) {
      Object.defineProperty(globalThis, "crypto", missing === "encoder" ? crypto : { configurable: true, value: missing === "rng" ? { subtle: { digest() {} } } : { getRandomValues() {} } });
      Object.defineProperty(globalThis, "TextEncoder", missing === "encoder" ? { configurable: true, value: undefined } : encoder);
      const client = signupAuthFactory("http://127.0.0.1:55460", "synthetic-local-only")("secure-crypto-test", {
        getItem: async () => null, setItem: async () => {}, removeItem: async () => {},
      });
      try { await assert.rejects(client.send("crypto@local.test", "password", "https://www.liftcuttracker.com/auth/mobile-callback"), /secure_crypto_unavailable/); }
      finally { await client.close(); }
    }
    assert.equal(requests, 0);
  } finally {
    Object.defineProperty(globalThis, "crypto", crypto); Object.defineProperty(globalThis, "TextEncoder", encoder); globalThis.fetch = fetch;
  }
});

test("broken callable crypto fails closed before the SDK sends a password", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto")!, fetch = globalThis.fetch;
  let requests = 0;
  const rng = webcrypto.getRandomValues.bind(webcrypto), sha256 = webcrypto.subtle.digest.bind(webcrypto.subtle);
  const variants = [
    { getRandomValues: () => { throw new Error("unavailable"); }, subtle: { digest: sha256 } },
    { getRandomValues: <T extends Uint8Array>(value: T) => value, subtle: { digest: sha256 } },
    { getRandomValues: <T extends Uint8Array>(value: T) => value.fill(7), subtle: { digest: sha256 } },
    { getRandomValues: rng, subtle: { digest: async () => { throw new Error("unavailable"); } } },
    { getRandomValues: rng, subtle: { digest: async () => new ArrayBuffer(31) } },
    { getRandomValues: rng, subtle: { digest: async () => new ArrayBuffer(32) } },
  ];
  try {
    globalThis.fetch = async () => { requests++; throw new Error("network_must_not_run"); };
    for (const value of variants) {
      Object.defineProperty(globalThis, "crypto", { configurable: true, value });
      const client = signupAuthFactory("http://127.0.0.1:55460", "synthetic-local-only")("broken-crypto-test", {
        getItem: async () => null, setItem: async () => {}, removeItem: async () => {},
      });
      try { await assert.rejects(client.send("crypto@local.test", "fixture-password", "https://www.liftcuttracker.com/auth/mobile-callback"), /secure_crypto_unavailable/); }
      finally { await client.close(); }
    }
    assert.equal(requests, 0);
  } finally { Object.defineProperty(globalThis, "crypto", original); globalThis.fetch = fetch; }
});

test("the actual pinned SDK sends only S256 matching its durably stored verifier", async () => {
  const fetch = globalThis.fetch, store = new Map<string, string>();
  let requests = 0;
  const key = "sdk-s256-test";
  const client = signupAuthFactory("http://127.0.0.1:55460", "synthetic-local-only")(key, {
    getItem: async name => store.get(name) ?? null,
    setItem: async (name, value) => { await new Promise(resolve => setTimeout(resolve, 5)); store.set(name, value); },
    removeItem: async name => { store.delete(name); },
  });
  try {
    globalThis.fetch = async (input, init) => {
      requests++;
      assert.equal(new URL(String(input)).pathname, "/auth/v1/signup");
      const body = JSON.parse(String(init?.body)), verifier = JSON.parse(store.get(`${key}-code-verifier`)!);
      assert.equal(body.code_challenge_method, "s256");
      assert.equal(body.code_challenge, createHash("sha256").update(verifier).digest("base64url"));
      assert.notEqual(body.code_challenge, verifier);
      return Response.json({ id: "97a3e9be-89a6-4d74-8b96-c68a7be3dc90", email: "crypto@local.test", identities: [] });
    };
    await client.send("crypto@local.test", "fixture-password", "https://www.liftcuttracker.com/auth/mobile-callback");
    assert.equal(requests, 1);
    assert.deepEqual([...store.keys()], [`${key}-code-verifier`]);
  } finally { await client.close(); globalThis.fetch = fetch; }
});

test("outbound guard refuses missing, malformed or changed verifier and downgraded challenges", async () => {
  const digest = await requireSignupCrypto(), verifier = "a".repeat(56);
  const body = { code_challenge_method: "s256", code_challenge: createHash("sha256").update(verifier).digest("base64url") };
  await requireSignupS256(JSON.stringify(body), JSON.stringify(verifier), digest);
  for (const stored of [null, "not-json", JSON.stringify({ verifier }), JSON.stringify("short"), JSON.stringify("b".repeat(56))]) {
    await assert.rejects(requireSignupS256(JSON.stringify(body), stored, digest), /signup_pkce_rejected/);
  }
  for (const invalid of [null, "invalid-json", JSON.stringify({ ...body, code_challenge_method: "plain" }), JSON.stringify({ ...body, code_challenge: verifier })]) {
    await assert.rejects(requireSignupS256(invalid, JSON.stringify(verifier), digest), /signup_pkce_rejected/);
  }
});

test("SDK downgrade after runtime probe cannot reach the network", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto")!, fetch = globalThis.fetch, warn = console.warn, error = console.error;
  const store = new Map<string, string>();
  let requests = 0;
  try {
    const rng = webcrypto.getRandomValues.bind(webcrypto);
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: {
      getRandomValues: rng, subtle: { digest: async (...args: Parameters<typeof webcrypto.subtle.digest>) => {
        const result = await webcrypto.subtle.digest(...args);
        // Simulate a runtime losing SHA-256 after the successful capability probe.
        Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues: rng } });
        return result;
      } },
    } });
    console.warn = () => {}; console.error = () => {};
    globalThis.fetch = async () => { requests++; throw new Error("network_must_not_run"); };
    const client = signupAuthFactory("http://127.0.0.1:55460", "synthetic-local-only")("downgrade-test", {
      getItem: async key => store.get(key) ?? null, setItem: async (key, value) => { store.set(key, value); }, removeItem: async key => { store.delete(key); },
    });
    try { await assert.rejects(client.send("crypto@local.test", "fixture-password", "https://www.liftcuttracker.com/auth/mobile-callback")); }
    finally { await client.close(); }
    assert.equal(requests, 0);
  } finally {
    Object.defineProperty(globalThis, "crypto", original); globalThis.fetch = fetch; console.warn = warn; console.error = error;
  }
});
