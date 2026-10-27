import assert from "node:assert/strict";
import test from "node:test";
import { signupAuthFactory } from "./email-signup-client";

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
