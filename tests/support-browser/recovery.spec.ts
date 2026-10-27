import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";

test("auth callbacks keep one-use codes out of referrers", async ({ request }) => {
  for (const path of ["/reset-password", "/auth/callback?error=access_denied&code=not-a-real-code"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
});

test.use({ serviceWorkers: "block" }); // Keep the SDK's synthetic transport observable by Playwright.
const key = "liftcut-password-recovery", owner = "11111111-1111-4111-8111-111111111111";
const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function session(method = "recovery", id = owner, timestamp = Math.floor(Date.now() / 1000)) {
  const now = Math.floor(Date.now() / 1000);
  return { access_token: `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: id, role: "authenticated", aud: "authenticated",
    iat: now, exp: now + 3600, session_id: "synthetic-session", amr: [{ method, timestamp }] })}.c2lnbmF0dXJl`,
    refresh_token: "synthetic-refresh", expires_in: 3600, expires_at: now + 3600, token_type: "bearer",
    user: { id, email: "recovery@example.invalid", aud: "authenticated", role: "authenticated", app_metadata: { provider: "email" },
      user_metadata: { recovery: true }, created_at: "2026-10-26T00:00:00Z" } };
}
async function fixture(context: BrowserContext, options: { method?: string; old?: boolean; staleAccount?: boolean } = {}) {
  let challenge = "", consumed = false, savedPassword = "old-password", updates = 0, exchanges = 0, logins = 0;
  const recovered = session(options.method, owner, options.old ? 1 : undefined), unexpected: string[] = [];
  if (options.staleAccount) await context.addCookies(["example", "127", "localhost"].map(project => ({
    name: `sb-${project}-auth-token`, value: `base64-${part(session("password", "22222222-2222-4222-8222-222222222222"))}`,
    domain: "127.0.0.1", path: "/", sameSite: "Lax" as const,
  })));
  await context.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), body = request.postDataJSON();
    if (url.pathname === "/auth/v1/recover") {
      expect(url.searchParams.get("redirect_to")).toBe("http://127.0.0.1:3109/reset-password");
      expect(body.code_challenge_method).toBe("s256"); challenge = body.code_challenge;
      await route.fulfill({ json: {} });
    } else if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "pkce") {
      exchanges++;
      const valid = !consumed && body.auth_code === "valid-code" && challenge &&
        createHash("sha256").update(body.code_verifier).digest("base64url") === challenge;
      consumed = true;
      await route.fulfill(valid ? { json: recovered } : { status: 400, json: { msg: "Invalid or expired code" } });
    } else if (url.pathname === "/auth/v1/user") {
      expect(request.headers().authorization).toBe(`Bearer ${recovered.access_token}`);
      if (request.method() === "PUT") { updates++; savedPassword = body.password; }
      await route.fulfill({ json: recovered.user });
    } else if (url.pathname === "/auth/v1/logout") await route.fulfill({ status: 204 });
    else if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "password") {
      expect(body.email).toBe("recovery@example.invalid"); expect(body.password).toBe(savedPassword); logins++;
      await route.fulfill({ json: session("password") });
    } else if (url.pathname === "/onboarding" && logins) await route.fulfill({ contentType: "text/html", body: "<h1>Signed in</h1>" });
    else if (url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/api/") || url.pathname === "/agent" ||
      url.origin !== "http://127.0.0.1:3109") { unexpected.push(url.pathname); await route.abort(); }
    else await route.continue();
  });
  return { get updates() { return updates; }, get exchanges() { return exchanges; }, get logins() { return logins; }, unexpected };
}
async function requestLink(page: Page) {
  await page.goto("/forgot-password");
  await page.locator("#email").fill("recovery@example.invalid");
  await page.locator("form button[type=submit]").click();
  await expect(page.getByText(/如果此账号存在|If this account exists/)).toBeVisible();
}

test("PKCE link in a new tab, reload, explicit update and new-password login use actual SDK requests", async ({ page, context }) => {
  const auth = await fixture(context, { staleAccount: true });
  await context.addInitScript(() => localStorage.setItem("liftcut-ui", JSON.stringify({ state: { language: "en", theme: "light" }, version: 0 })));
  await requestLink(page);
  const reset = await context.newPage();
  await reset.goto("/reset-password?code=valid-code");
  await expect(reset.getByLabel("New password", { exact: true })).toBeVisible();
  await expect(reset).toHaveURL(/\/reset-password$/);
  await expect(reset.getByText("recovery@example.invalid", { exact: true })).toBeVisible();
  expect(auth.updates).toBe(0); expect(auth.exchanges).toBe(1);
  await reset.reload();
  await reset.getByLabel("New password", { exact: true }).fill("new-password-123");
  await reset.getByLabel("Confirm password").fill("different-password");
  await reset.getByRole("button", { name: "Save new password" }).click();
  await expect(reset.getByText("Passwords do not match.")).toBeVisible(); expect(auth.updates).toBe(0);
  await reset.getByLabel("Confirm password").fill("new-password-123");
  await reset.getByRole("button", { name: "Save new password" }).click();
  await expect(reset.getByText("Password updated. Sign in again with your new password.")).toBeVisible();
  expect(auth.updates).toBe(1);
  expect(await reset.evaluate(k => sessionStorage.getItem(k), key)).toBeNull();
  await reset.getByRole("button", { name: "Sign in with new password" }).click();
  await reset.locator("#email").fill("recovery@example.invalid"); await reset.locator("#password").fill("new-password-123");
  await reset.locator("form button[type=submit]").click();
  await expect(reset.getByRole("heading", { name: "Signed in" })).toBeVisible(); expect(auth.logins).toBe(1);
  await reset.goto("/reset-password?code=valid-code");
  await expect(reset.locator("p[role=alert]")).toContainText("invalid");
  await reset.reload(); await expect(reset.locator("p[role=alert]")).toContainText("invalid");
  expect(auth.updates).toBe(1); expect(auth.unexpected).toEqual([]);
});

for (const scenario of ["missing", "flags", "expired", "password-method", "old-recovery"]) {
  test(`${scenario} cannot authorize a password update from an existing account`, async ({ page, context }) => {
    const auth = await fixture(context, { staleAccount: true, method: scenario === "password-method" ? "password" : undefined, old: scenario === "old-recovery" });
    if (!["missing", "flags"].includes(scenario)) await requestLink(page);
    const suffix = scenario === "missing" ? "" : scenario === "flags" ? "?type=recovery#access_token=fake" :
      scenario === "expired" ? "?code=expired-code" : "?code=valid-code";
    await page.goto(`/reset-password${suffix}`);
    await expect(page.locator("p[role=alert]")).toContainText("重置链接无效");
    await expect(page.locator("#new-password")).toHaveCount(0); await expect(page).toHaveURL(/\/reset-password$/);
    expect(auth.updates).toBe(0); expect(auth.unexpected).toEqual([]);
  });
}

test("failed exchange never falls back to an earlier valid recovery; callback errors drop secrets", async ({ page, context, request }) => {
  const auth = await fixture(context); await requestLink(page); await page.goto("/reset-password?code=valid-code");
  await expect(page.locator("#new-password")).toBeVisible();
  await page.goto("/reset-password?code=expired-code");
  await expect(page.locator("p[role=alert]")).toContainText("重置链接无效");
  expect(auth.updates).toBe(0); expect(await page.evaluate(k => sessionStorage.getItem(k), key)).toBeNull();
  const response = await request.get("/auth/callback?error=denied&code=secret&next=//evil.invalid", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(new URL(response.headers().location).pathname + new URL(response.headers().location).search).toBe("/login?error=oauth_cancelled");
});
