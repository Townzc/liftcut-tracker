import { test, expect } from "@playwright/test";

for (const [locale, heading] of [["zh-CN", "帮助与支持"], ["en", "Help & support"]]) {
  test(`public help preserves explicit ${locale} without sign-in or private links`, async ({ page }) => {
    const response = await page.goto(`/support?lang=${locale}&token=synthetic-do-not-forward`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page).toHaveTitle(`${heading} | LiftCut Tracker`);
    await expect(page.locator("article")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("navigation")).toHaveCount(1); // Language only, no authenticated shell.
    await expect(page.getByRole("link", { name: /townzc1@gmail\.com/ })).toHaveAttribute("href", "mailto:townzc1@gmail.com");
    expect(await page.locator("a").evaluateAll(links => links.map(link => link.getAttribute("href")))).toEqual([
      "/support?lang=zh-CN", "/support?lang=en", "mailto:townzc1@gmail.com",
    ]);
    await expect(page.locator("article")).not.toContainText("synthetic-do-not-forward");
    await page.screenshot({ path: `node_modules/.cache/support/support-${locale}.png`, fullPage: true });
    const next = locale === "en" ? "中文" : "English";
    await page.getByRole("link", { name: next, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/support\\?lang=${locale === "en" ? "zh-CN" : "en"}$`));
    await expect(page.getByRole("heading", { name: locale === "en" ? "帮助与支持" : "Help & support", exact: true })).toBeVisible();
    await expect(page).toHaveTitle(`${locale === "en" ? "帮助与支持" : "Help & support"} | LiftCut Tracker`);
  });
}

test("public exception is exact; protected and lookalike routes still require auth", async ({ request }) => {
  for (const path of ["/agent", "/settings", "/support-private"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    const target = new URL(response.headers().location, response.url());
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("redirectedFrom")).toBe(path);
  }
});

test("a synthetic signed-in session does not bootstrap records or prefetch Agent on support", async ({ page, context }) => {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000), id = "33333333-3333-4333-8333-333333333333";
  const session = (expires: number) => ({
    access_token: `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: id, exp: expires, aud: "authenticated" })}.c3ludGhldGlj`,
    refresh_token: "synthetic-support-refresh", expires_at: expires, expires_in: 3600, token_type: "bearer",
    user: { id, email: "support-fixture@example.invalid", aud: "authenticated", role: "authenticated",
      app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-10-26T00:00:00Z" },
  });
  // Cover the synthetic public build URL used in quality CI and loopback local builds.
  // Expiry forces an intercepted refresh, proving the browser actually consumed the fixture.
  await context.addCookies(["example", "127", "localhost"].map(project => ({
    name: `sb-${project}-auth-token`, value: `base64-${part(session(now - 60))}`,
    domain: "127.0.0.1", path: "/", sameSite: "Lax" as const,
  })));
  let refreshes = 0;
  const unexpected: string[] = [];
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      expect(route.request().postDataJSON().refresh_token).toBe("synthetic-support-refresh");
      refreshes++;
      await route.fulfill({ json: session(now + 3600) });
    } else if (url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/api/") || url.pathname === "/agent") {
      unexpected.push(url.pathname); await route.abort();
    } else if (url.origin !== "http://127.0.0.1:3109") {
      unexpected.push(url.pathname); await route.abort();
    } else await route.continue();
  });
  await page.goto("/support?lang=en");
  await expect(page.getByRole("heading", { name: "Help & support", exact: true })).toBeVisible();
  await expect.poll(() => refreshes).toBeGreaterThan(0);
  await page.waitForLoadState("networkidle");
  expect(unexpected).toEqual([]);
});
