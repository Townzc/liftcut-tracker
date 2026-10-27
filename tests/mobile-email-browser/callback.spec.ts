import { test, expect } from "@playwright/test";
import { mobileEmailAppLink } from "../../packages/core/src/mobile-email-auth";

const attempt = "11111111-1111-4111-8111-111111111111", code = "33333333-3333-4333-8333-333333333333";
for (const lang of ["zh-CN", "en"] as const) {
  test(`raw ${lang} callback is manual, isolated and not cacheable`, async ({ page }, testInfo) => {
    const unexpected: string[] = [];
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== "http://127.0.0.1:3110" || (!url.pathname.startsWith("/auth/mobile-callback") && url.pathname !== "/favicon.ico")) {
        unexpected.push(url.pathname); await route.abort();
      } else await route.continue();
    });
    const response = await page.goto(`/auth/mobile-callback?attempt=${attempt}&code=${code}&lang=${lang}`);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response?.headers()["content-security-policy"]).toContain("default-src 'none'");
    expect(response?.headers()["set-cookie"]).toBeUndefined();
    await expect(page.locator("html")).toHaveAttribute("lang", lang);
    await expect(page.locator("script, form, meta[http-equiv=refresh]")).toHaveCount(0);
    await expect(page.getByRole("link")).toHaveCount(1);
    await expect(page.getByRole("link", { name: lang === "en" ? "Open LiftCut" : "打开 LiftCut", exact: true })).toHaveAttribute("href", mobileEmailAppLink({ attempt, code, lang }));
    await page.waitForLoadState("networkidle");
    expect(unexpected).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`mobile-callback-${lang}.png`), fullPage: true });
  });
}

test("real server refuses tokens, duplicate values, redirects and malformed input without reflection", async ({ request }) => {
  const valid = `/auth/mobile-callback?attempt=${attempt}&code=${code}`;
  for (const suffix of ["&next=https://example.invalid", "&access_token=private-sentinel", `&code=${code}`, "&error_description=private-sentinel", "&lang=fr"]) {
    const response = await request.get(valid + suffix, { maxRedirects: 0 });
    expect(response.status()).toBe(400);
    expect(await response.text()).not.toContain("private-sentinel");
    expect(await response.text()).not.toContain('href="liftcut:');
  }
  expect((await request.get("/auth/mobile-callback?code=%3Cscript%3Eprivate-sentinel%3C/script%3E")).status()).toBe(400);
  for (const path of ["/auth/mobile-callback-extra", "/auth/mobile-callback/nested", "/agent"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers().location, response.url()).pathname).toBe("/login");
  }
});
