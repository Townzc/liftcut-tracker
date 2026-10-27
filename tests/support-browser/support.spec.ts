import { test, expect } from "@playwright/test";

for (const route of ["support", "privacy"]) {
for (const [locale, heading] of route === "support" ? [["zh-CN", "帮助与支持"], ["en", "Help & support"]] : [["zh-CN", "隐私政策"], ["en", "Privacy policy"]]) {
  test(`public ${route} preserves explicit ${locale} without sign-in or private links`, async ({ page }, testInfo) => {
    const response = await page.goto(`/${route}?lang=${locale}&token=synthetic-do-not-forward`);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    await expect(page).toHaveTitle(`${heading} | LiftCut Tracker`);
    await expect(page.locator("article")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("navigation")).toHaveCount(1); // Language only, no authenticated shell.
    await expect(page.getByRole("link", { name: /townzc1@gmail\.com/ })).toHaveAttribute("href", "mailto:townzc1@gmail.com");
    expect(await page.locator("a").evaluateAll(links => links.map(link => link.getAttribute("href")))).toEqual([
      `/${route}?lang=zh-CN`, `/${route}?lang=en`, "mailto:townzc1@gmail.com", ...(route === "privacy" ? [`/support?lang=${locale}`] : []),
    ]);
    await expect(page.locator("article")).not.toContainText("synthetic-do-not-forward");
    if (route === "privacy") {
      await expect(page.locator("article")).toContainText(locale === "en" ? "not a data retention period" : "不是数据保存期限");
      await expect(page.locator("article")).toContainText(locale === "en" ? "may be stored before you confirm" : "可能在你确认前保存");
      await expect(page.locator("article")).toContainText(locale === "en" ? "When the entry is available" : "入口可用时");
      await expect(page.locator("article")).toContainText(locale === "en" ? "then explicitly check and confirm permanent deletion" : "再明确勾选并确认永久删除");
      await expect(page.locator("article")).toContainText(locale === "en" ? "Legacy drafts that cannot reliably be attributed" : "无法可靠归属账号的旧版草稿");
      await expect(page.locator("article li")).toHaveCount(9);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${route}-${locale}.png`), fullPage: true });
    const next = locale === "en" ? "中文" : "English";
    await page.getByRole("link", { name: next, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/${route}\\?lang=${locale === "en" ? "zh-CN" : "en"}$`));
    const nextHeading = route === "support" ? (locale === "en" ? "帮助与支持" : "Help & support") : (locale === "en" ? "隐私政策" : "Privacy policy");
    await expect(page.getByRole("heading", { name: nextHeading, exact: true })).toBeVisible();
    await expect(page).toHaveTitle(`${nextHeading} | LiftCut Tracker`);
  });
}
}

test("public exception is exact; protected and lookalike routes still require auth", async ({ request }) => {
  for (const path of ["/agent", "/settings", "/support-private", "/privacy-private", "/privacy/nested"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    const target = new URL(response.headers().location, response.url());
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("redirectedFrom")).toBe(path);
  }
});

for (const routeName of ["support", "privacy"]) {
test(`a synthetic signed-in session does not bootstrap records or prefetch Agent on ${routeName}`, async ({ page, context }) => {
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
  await page.goto(`/${routeName}?lang=en`);
  await expect(page.getByRole("heading", { name: routeName === "support" ? "Help & support" : "Privacy policy", exact: true })).toBeVisible();
  await expect.poll(() => refreshes).toBeGreaterThan(0);
  await page.waitForLoadState("networkidle");
  expect(unexpected).toEqual([]);
});
}

for (const locale of ["zh-CN", "en"]) {
test(`privacy links on auth and guest settings preserve ${locale}`, async ({ page, context }) => {
  await page.addInitScript(language => {
    localStorage.setItem("liftcut-ui", JSON.stringify({ state: { language, theme: "light" }, version: 0 }));
  }, locale);
  for (const path of ["/login", "/register"]) {
    await page.goto(`${path}?token=synthetic-do-not-forward`);
    await expect(page.getByRole("link", { name: locale === "en" ? "Privacy policy" : "隐私政策", exact: true })).toHaveAttribute("href", `/privacy?lang=${locale}`);
  }
  await context.addCookies([{ name: "liftcut_guest", value: "1", domain: "127.0.0.1", path: "/" }]);
  await page.addInitScript(() => localStorage.setItem("liftcut-guest-mode", "true"));
  await page.goto("/settings");
  const link = page.getByRole("link", { name: locale === "en" ? "Privacy policy" : "隐私政策", exact: true });
  await expect(link).toHaveAttribute("href", `/privacy?lang=${locale}`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/privacy\\?lang=${locale}$`));
});
}
