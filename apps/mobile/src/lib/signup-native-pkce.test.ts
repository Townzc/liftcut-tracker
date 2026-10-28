import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { signupAuthFactory, type EmailStorage } from "./email-signup-client";
import { prepareNativeSignupPkce, type NativeSignupCrypto } from "./signup-crypto";

const crypto: NativeSignupCrypto = { randomBytes: async () => new Uint8Array(randomBytes(32)),
  digest: async value => createHash("sha256").update(value).digest("hex") };
const redirect = "https://www.liftcuttracker.com/auth/mobile-callback", email = "native@local.test";
function memory() {
  const data = new Map<string, string>();
  const storage: EmailStorage = { getItem: async key => data.get(key) ?? null,
    setItem: async (key, value) => { data.set(key, value); }, removeItem: async key => { data.delete(key); } };
  return { data, storage };
}

test("native primitive adapter works without global WebCrypto and persists only a verifier", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "crypto")!, fetch = globalThis.fetch;
  const { data, storage } = memory(); let requests = 0;
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
  const client = signupAuthFactory("http://127.0.0.1:55460", "fixture-public-key", crypto)("native-test", storage);
  try {
    globalThis.fetch = async (input, init) => {
      requests++;
      const url = new URL(String(input)), body = JSON.parse(String(init?.body));
      assert.equal(url.pathname, "/auth/v1/signup"); assert.equal(url.searchParams.get("redirect_to"), redirect);
      assert.equal(body.code_challenge_method, "s256");
      const verifier = JSON.parse(data.get("native-test-code-verifier")!);
      assert.match(verifier, /^[a-f0-9]{64}$/);
      assert.equal(body.code_challenge, createHash("sha256").update(verifier).digest("base64url"));
      return Response.json({ id: "synthetic-id", email });
    };
    await client.send(email, "fixture-password", redirect);
    assert.equal(requests, 1); assert.deepEqual([...data.keys()], ["native-test-code-verifier"]);
  } finally { await client.close(); globalThis.fetch = fetch; Object.defineProperty(globalThis, "crypto", original); }
});

test("native primitive failures cannot produce a PKCE pair", async () => {
  for (const port of [
    { ...crypto, randomBytes: async () => { throw new Error("native_unavailable"); } },
    { ...crypto, randomBytes: async () => new Uint8Array(31) },
    { ...crypto, randomBytes: async () => new Uint8Array(32).fill(9) },
    { ...crypto, digest: async () => "00".repeat(32) },
    { ...crypto, digest: async () => { throw new Error("native_unavailable"); } },
  ]) await assert.rejects(prepareNativeSignupPkce(port), /signup_secure_crypto_unavailable/);
});

test("storage failure and cancellation before native signup send no request", async () => {
  const fetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("network_must_not_run"); };
  try {
    const failed = signupAuthFactory("http://127.0.0.1:55460", "fixture-public-key", crypto)("failed-store", {
      ...memory().storage, setItem: async () => { throw new Error("disk_full"); },
    });
    try { await assert.rejects(failed.send(email, "fixture-password", redirect), /disk_full/); } finally { await failed.close(); }
    let cancel: () => void = () => {};
    const cancelled = signupAuthFactory("http://127.0.0.1:55460", "fixture-public-key", { ...crypto,
      randomBytes: async () => { cancel(); return crypto.randomBytes(); },
    })("cancelled", memory().storage);
    cancel = () => cancelled.cancel();
    try { await assert.rejects(cancelled.send(email, "fixture-password", redirect), /signup_cancelled/); } finally { await cancelled.close(); }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = fetch; }
});

test("unexpected immediate signup session is refused and only that token is locally revoked", async () => {
  const fetch = globalThis.fetch, { data, storage } = memory(); const requests: string[] = [];
  const client = signupAuthFactory("http://127.0.0.1:55460", "fixture-public-key", crypto)("unexpected-session", storage);
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input)); requests.push(url.pathname);
      if (url.pathname.endsWith("/signup")) return Response.json({ access_token: "fixture-temporary-token", refresh_token: "must-not-persist" });
      assert.equal(url.pathname, "/auth/v1/logout"); assert.equal(url.searchParams.get("scope"), "local");
      assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-temporary-token");
      assert.equal(new Headers(init?.headers).get("apikey"), "fixture-public-key");
      return new Response(null, { status: 204 });
    };
    await assert.rejects(client.send(email, "fixture-password", redirect), /signup_confirmation_required/);
    await client.close();
    assert.deepEqual(requests, ["/auth/v1/signup", "/auth/v1/logout"]);
    assert.deepEqual([...data.keys()], ["unexpected-session-code-verifier"]);
  } finally { globalThis.fetch = fetch; }
});

test("native HTTP failures do not retry signup or claim confirmation", async () => {
  const fetch = globalThis.fetch;
  try {
    for (const status of [429, 500]) {
      let requests = 0;
      globalThis.fetch = async () => { requests++; return Response.json({ msg: "unavailable" }, { status }); };
      const client = signupAuthFactory("http://127.0.0.1:55460", "fixture-public-key", crypto)(`status-${status}`, memory().storage);
      try { await assert.rejects(client.send(email, "fixture-password", redirect), /signup_confirmation_required/); }
      finally { await client.close(); }
      assert.equal(requests, 1);
    }
  } finally { globalThis.fetch = fetch; }
});

test("real HTTP redirects cannot forward signup passwords, exchange codes or temporary tokens", async () => {
  let targetRequests = 0, phase = "native-password";
  const sourceRequests = new Map<string, number>();
  const target = createServer((_req, res) => { targetRequests++; res.writeHead(200, { "Content-Type": "application/json" }); res.end("{}"); });
  const listen = (server: Server) => new Promise<string>(resolve => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  const close = (server: Server) => new Promise<void>(resolve => server.close(() => resolve()));
  const destination = await listen(target);
  const source = createServer((req, res) => {
    sourceRequests.set(phase, (sourceRequests.get(phase) ?? 0) + 1);
    if (phase === "temporary-token" && req.url?.startsWith("/auth/v1/signup")) {
      res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ access_token: "fixture-temporary-token", refresh_token: "fixture-refresh" }));
    } else { res.writeHead(307, { Location: `${destination}/must-not-receive` }); res.end(); }
  });
  const origin = await listen(source), error = console.error, request = globalThis.fetch;
  try {
    console.error = () => {}; // Expected SDK fetch-rejection logging contains no test evidence.
    globalThis.fetch = async () => { throw new Error("global_transport_must_not_run"); };
    for (phase of ["native-password", "sdk-password", "exchange-code", "temporary-token"]) {
      const { data, storage } = memory(); data.set(`${phase}-code-verifier`, JSON.stringify("a".repeat(64)));
      const client = signupAuthFactory(origin, "fixture-public-key", phase === "sdk-password" ? undefined : crypto, request)(phase, storage);
      try {
        if (phase === "exchange-code") await assert.rejects(client.verify("fixture-code"));
        else await assert.rejects(client.send(email, "fixture-password", redirect));
      } finally { await client.close(); }
      assert.equal(sourceRequests.get(phase), phase === "temporary-token" ? 2 : 1, `original request reached source: ${phase}`);
      assert.equal(targetRequests, 0, phase);
    }
  } finally { console.error = error; globalThis.fetch = request; await close(source); await close(target); }
});
