import { test, expect } from "@playwright/test";

for (const locale of ["zh-CN", "en"] as const) test(`${locale} registration restores pending state and cancels; HTTP callback cannot become an app callback`, async ({ page }) => {
  const zh = locale === "zh-CN", email = "signup-ui@local.test", password = "Synthetic-password-29";
  await page.addInitScript(locale => localStorage.setItem("liftcut-locale", locale), locale);
  let requests = 0;
  await page.route("http://127.0.0.1:55438/**", async route => {
    const request = route.request(), headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
    if (request.method() === "OPTIONS") { await route.fulfill({ status: 204, headers }); return; }
    requests++;
    expect(new URL(request.url()).pathname).toBe("/auth/v1/signup");
    const body = request.postDataJSON(); expect(body.email).toBe(email); expect(body.code_challenge_method).toBe("s256");
    expect(body.code_challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const redirect = new URL(new URL(request.url()).searchParams.get("redirect_to")!);
    expect(redirect.origin).toBe("https://www.liftcuttracker.com"); expect(redirect.pathname).toBe("/auth/mobile-callback");
    await route.fulfill({ headers, json: { id: "e224c67a-3990-4411-931f-85a2e257994f", email, aud: "authenticated", created_at: new Date().toISOString(), identities: [] } });
  });
  await page.goto("/sign-in");
  await page.getByRole("button", { name: zh ? "创建账号" : "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: zh ? "创建账号" : "Create account", exact: true })).toBeVisible();
  // Expo keeps the preceding sign-in screen mounted but hidden in its stack.
  await page.getByLabel(zh ? "邮箱" : "Email", { exact: true }).filter({ visible: true }).fill(email);
  await page.getByLabel(zh ? "密码" : "Password", { exact: true }).filter({ visible: true }).fill(password);
  await page.getByRole("button", { name: zh ? "发送确认邮件" : "Send confirmation email", exact: true }).click();
  await expect(page.getByText(zh ? /已向 signup-ui@local.test 请求确认邮件/ : /Confirmation was requested for signup-ui@local.test/)).toBeVisible();
  const pending = await page.evaluate(() => JSON.parse(localStorage.getItem("liftcut-pending-email-signup-v1")!));
  const stored = await page.evaluate(() => JSON.stringify(localStorage)); expect(stored).not.toContain(password); expect(stored).not.toContain("access_token");
  await page.reload();
  await expect(page.getByText(zh ? /已向 signup-ui@local.test 请求确认邮件/ : /Confirmation was requested for signup-ui@local.test/)).toBeVisible();
  await page.screenshot({ path: test.info().outputPath(`signup-pending-${locale}.png`) });
  await page.getByRole("button", { name: zh ? "返回登录" : "Return to sign-in", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes("email-signup")))).toEqual([]);
  await page.goto(`/auth/callback?attempt=${pending.attempt}&code=${"a".repeat(32)}`);
  await expect(page.getByText(zh ? /链接无效、已使用/ : /This link is invalid, used/)).toBeVisible();
  expect(requests).toBe(1); // A browser URL never gets reconstructed into a trusted custom scheme.
});
