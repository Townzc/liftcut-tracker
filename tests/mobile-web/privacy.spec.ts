import { test, expect, type Page } from "@playwright/test";

async function setup(page: Page, locale: "zh-CN" | "en", signedIn: boolean) {
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "private-sentinel@local.test", aud: "authenticated" };
  const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: user.id, exp: 2200000000 })).toString("base64url")}.synthetic`;
  const session = { access_token: token, refresh_token: "private-refresh-sentinel", expires_at: 2200000000, expires_in: 3600, token_type: "bearer", user };
  await page.addInitScript(({ locale, session, signedIn }) => {
    localStorage.setItem("liftcut-locale", locale);
    if (signedIn) localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
  }, { locale, session, signedIn });
  await page.route(/^http:\/\/(127\.0\.0\.1:55440|localhost:3103)\//, async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const headers = { "access-control-allow-origin": "http://localhost:8099",
      "access-control-allow-headers": request.headers()["access-control-request-headers"] ?? "*" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    expect(request.method()).toBe("GET"); // Viewing either entry must not write account or training data.
    const body = path.endsWith("/user") ? user : path === "/api/account/deletion" ? { available: false }
      : path === "/api/workout-sessions" ? { days: [], session: null, previous: {} } : { conversations: [], next: null };
    return route.fulfill({ headers, contentType: "application/json", body: JSON.stringify(body) });
  });
  // Inspect the real Linking navigation without contacting the production site.
  await page.route("https://www.liftcuttracker.com/**", route => route.fulfill({ contentType: "text/html", body: "<title>Public page fixture</title>" }));
}

for (const locale of ["zh-CN", "en"] as const) for (const signedIn of [false, true]) {
  test(`${locale}: ${signedIn ? "settings" : "login"} opens localized privacy and support without private data`, async ({ page }) => {
    await setup(page, locale, signedIn);
    const screen = signedIn ? "/settings" : "/sign-in";
    const labels = locale === "zh-CN" ? { privacy: "隐私政策", support: "帮助与支持" } : { privacy: "Privacy policy", support: "Help & support" };
    await page.goto(screen);
    await expect(page.getByRole("link", { name: labels.privacy, exact: true })).toBeVisible();
    if (!signedIn) {
      await page.getByLabel(locale === "zh-CN" ? "邮箱" : "Email", { exact: true }).fill("private-sentinel@local.test");
      await page.getByLabel(locale === "zh-CN" ? "密码" : "Password", { exact: true }).fill("private-password-sentinel");
    }
    for (const destination of ["privacy", "support"] as const) {
      await page.getByRole("link", { name: labels[destination], exact: true }).click();
      await expect(page).toHaveURL(`https://www.liftcuttracker.com/${destination}?lang=${locale}`);
      await page.goto(screen);
    }
    await expect(page.getByRole("link", { name: labels.privacy, exact: true })).toBeVisible();
    await page.screenshot({ path: `node_modules/.cache/mobile-privacy-${signedIn ? "settings" : "login"}-${locale}.png` });
  });
}
