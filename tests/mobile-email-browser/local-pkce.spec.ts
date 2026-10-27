import { test, expect } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { emailSignupStorageKey, newEmailSignup, parseMobileEmailParams, prepareEmailSignupExchange, requireSignupIdentity } from "../../packages/core/src/mobile-email-auth";

test("local captured signup email, real PKCE and verified identity; not native acceptance", async ({ request, page }) => {
  test.skip(!process.env.LIFTCUT_LOCAL_AUTH_FIXTURE, "Requires an explicitly supplied isolated local GoTrue fixture.");
  const path = process.env.LIFTCUT_LOCAL_AUTH_FIXTURE!;
  const fixture = JSON.parse(await readFile(path, "utf8"));
  expect(fixture.url).toBe("http://127.0.0.1:55460"); // Never run this on hosted Auth.
  const capture = join(dirname(path), "captured-mail"), before = new Set(await readdir(capture));
  const attempt = randomUUID(), email = `mobile-${attempt}@local.test`, pending = newEmailSignup(email, attempt, Date.now());
  const values = new Map<string, string>();
  const storage = (data: Map<string, string>) => ({ getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } });
  const client = (key: string, data: Map<string, string>) => createClient(fixture.url, fixture.anonKey, { auth: {
    storageKey: key, storage: storage(data), flowType: "pkce", detectSessionInUrl: false, persistSession: true, autoRefreshToken: false } });
  const key = emailSignupStorageKey(attempt), signup = client(key, values);
  const admin = createClient(fixture.url, fixture.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let id: string | undefined;
  try {
    const result = await signup.auth.signUp({ email, password: `Test-${randomUUID()}`, options: {
      emailRedirectTo: `http://127.0.0.1:3110/auth/mobile-callback?attempt=${attempt}&lang=en` } });
    expect(result.error).toBeNull(); id = result.data.user?.id; expect(id).toBeTruthy();
    expect(result.data.session).toBeNull();
    let verify = "";
    await expect.poll(async () => {
      for (const name of await readdir(capture)) {
        if (before.has(name)) continue;
        const raw = await readFile(join(capture, name), "utf8");
        if (!raw.includes(email)) continue;
        const mail = raw.replace(/=\r?\n/g, "").replace(/=([A-Fa-f0-9]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        verify = (mail.match(/https?:\/\/[^\s<>"']+/g) ?? []).find(url => url.includes("/verify?"))?.replaceAll("&amp;", "&") ?? "";
      }
      return !!verify;
    }).toBe(true);
    expect(new URL(verify).origin).toBe(fixture.url);
    const confirmed = await request.get(verify, { maxRedirects: 0 }); expect(confirmed.status()).toBe(303);
    const callbackUrl = new URL(confirmed.headers().location);
    expect(callbackUrl.origin).toBe("http://127.0.0.1:3110"); expect(callbackUrl.pathname).toBe("/auth/mobile-callback");
    const callback = parseMobileEmailParams([...callbackUrl.searchParams]); expect(callback).not.toBeNull();
    await page.goto(callbackUrl.href);
    const appLink = await page.getByRole("link", { name: "Open LiftCut", exact: true }).getAttribute("href");
    expect(new URL(appLink!).protocol).toBe("liftcut:");
    // Recreate the adapter from serialized pending state and saved verifier, as after a JS restart.
    const restored = JSON.parse(JSON.stringify(pending));
    const exchange = prepareEmailSignupExchange(restored, callback!, null, Date.now());
    const verifier = values.get(`${key}-code-verifier`); expect(verifier).toBeTruthy();
    const wrong = client("wrong-fixture", new Map([["wrong-fixture-code-verifier", JSON.stringify("a".repeat(64))]]));
    expect((await wrong.auth.exchangeCodeForSession(exchange.code)).error).not.toBeNull();
    const resumed = client(exchange.storageKey, new Map(values));
    const signed = await resumed.auth.exchangeCodeForSession(exchange.code); expect(signed.error).toBeNull();
    const identity = await resumed.auth.getUser(); expect(identity.error).toBeNull(); expect(identity.data.user?.id).toBe(id);
    expect(requireSignupIdentity(exchange.next, identity.data.user!).phase).toBe("completed");
    const replay = client("replay-fixture", new Map([["replay-fixture-code-verifier", verifier!]]));
    expect((await replay.auth.exchangeCodeForSession(exchange.code)).error).not.toBeNull();
  } finally {
    if (id) expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
  }
});
