import { test, expect } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { emailSignupStorageKey, parseMobileEmailParams } from "../../packages/core/src/mobile-email-auth";
import { EmailSignupController } from "../../apps/mobile/src/lib/email-signup";
import { signupAuthFactory } from "../../apps/mobile/src/lib/email-signup-client";

for (const transport of ["sdk", "scoped-native-primitives"] as const) test(`local captured signup email, real PKCE and identity (${transport}); not native acceptance`, async ({ request, page }) => {
  test.skip(!process.env.LIFTCUT_LOCAL_AUTH_FIXTURE, "Requires an explicitly supplied isolated local GoTrue fixture.");
  const path = process.env.LIFTCUT_LOCAL_AUTH_FIXTURE!;
  const fixture = JSON.parse(await readFile(path, "utf8"));
  test.skip(fixture.autoConfirm === true, "This case requires email confirmation, not the auto-confirm rejection fixture.");
  expect(fixture.url).toBe("http://127.0.0.1:55460"); // Never run this on hosted Auth.
  const capture = join(dirname(path), "captured-mail"), before = new Set(await readdir(capture));
  const attempt = randomUUID(), email = `mobile-${attempt}@local.test`;
  const values = new Map<string, string>();
  const storage = (data: Map<string, string>) => ({ getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => { data.set(key, value); }, removeItem: async (key: string) => { data.delete(key); } });
  const client = (key: string, data: Map<string, string>) => createClient(fixture.url, fixture.anonKey, { auth: {
    storageKey: key, storage: storage(data), flowType: "pkce", detectSessionInUrl: false, persistSession: true, autoRefreshToken: false } });
  const key = emailSignupStorageKey(attempt);
  // The scoped path uses Node primitives here; this is not Expo/Hermes execution.
  const native = transport === "sdk" ? undefined : { randomBytes: async () => new Uint8Array(randomBytes(32)),
    digest: async (value: string) => createHash("sha256").update(value).digest("hex") };
  const controller = () => new EmailSignupController({ storage: storage(values), auth: signupAuthFactory(fixture.url, fixture.anonKey, native),
    owner: async () => null, uuid: () => attempt, redirectOrigin: "http://127.0.0.1:3110" });
  const admin = createClient(fixture.url, fixture.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  let id: string | undefined;
  try {
    await controller().start(email, `Test-${randomUUID()}`, "en");
    expect([...values.keys()].sort()).toEqual([`${key}-code-verifier`, "liftcut-pending-email-signup-v1"].sort());
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
    const verifier = values.get(`${key}-code-verifier`); expect(verifier).toBeTruthy();
    const wrong = client("wrong-fixture", new Map([["wrong-fixture-code-verifier", JSON.stringify("a".repeat(64))]]));
    expect((await wrong.auth.exchangeCodeForSession(callback!.code)).error).not.toBeNull(); await wrong.auth.dispose();
    expect((await controller().pending())?.email).toBe(email);
    expect(await controller().verify(appLink!)).toBe(email); expect(values.size).toBe(0);
    await expect(controller().verify(appLink!)).rejects.toThrow();
    const replay = client("replay-fixture", new Map([["replay-fixture-code-verifier", verifier!]]));
    expect((await replay.auth.exchangeCodeForSession(callback!.code)).error).not.toBeNull(); await replay.auth.dispose();
  } finally {
    // Only this test's random local fixture identity; no hosted database or account.
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }); expect(users.error).toBeNull();
    id = users.data.users.find(user => user.email === email)?.id;
    if (id) expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
    await admin.auth.dispose();
  }
});

test("local auto-confirm is refused and its temporary session revoked; not native acceptance", async () => {
  test.skip(!process.env.LIFTCUT_LOCAL_AUTH_FIXTURE, "Requires an isolated local GoTrue fixture.");
  const fixture = JSON.parse(await readFile(process.env.LIFTCUT_LOCAL_AUTH_FIXTURE!, "utf8"));
  expect(fixture.url).toBe("http://127.0.0.1:55460");
  test.skip(fixture.autoConfirm !== true, "Requires the separate auto-confirm misconfiguration fixture.");
  const email = `rejection-${randomUUID()}@local.test`, values = new Map<string, string>();
  const originalFetch = globalThis.fetch; let refresh: string | undefined;
  const admin = createClient(fixture.url, fixture.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    globalThis.fetch = async (input, init) => {
      const response = await originalFetch(input, init);
      if (new URL(String(input)).pathname === "/auth/v1/signup") refresh = (await response.clone().json()).refresh_token;
      return response;
    };
    const controller = new EmailSignupController({ owner: async () => null, uuid: randomUUID,
      storage: { getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); }, removeItem: async key => { values.delete(key); } },
      auth: signupAuthFactory(fixture.url, fixture.anonKey, { randomBytes: async () => new Uint8Array(randomBytes(32)),
        digest: async value => createHash("sha256").update(value).digest("hex") }), redirectOrigin: "http://127.0.0.1:3110" });
    await expect(controller.start(email, `Test-${randomUUID()}`, "en")).rejects.toThrow("signup_confirmation_required");
    expect(values.size).toBe(0); expect(refresh).toBeTruthy();
    expect((await admin.auth.refreshSession({ refresh_token: refresh! })).error).not.toBeNull();
  } finally {
    globalThis.fetch = originalFetch;
    const users = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }); expect(users.error).toBeNull();
    const id = users.data.users.find(user => user.email === email)?.id;
    if (id) expect((await admin.auth.admin.deleteUser(id)).error).toBeNull();
    await admin.auth.dispose();
  }
});
