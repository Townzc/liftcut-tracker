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

test("an existing account is kept and no email code is exchanged", async ({ page }) => {
  const owner = "11111111-1111-4111-8111-111111111111";
  const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: owner, exp: 2200000000 })).toString("base64url")}.synthetic`;
  const session = { access_token: token, refresh_token: "synthetic-refresh", expires_at: 2200000000, expires_in: 3600, token_type: "bearer",
    user: { id: owner, email: "existing@local.test", aud: "authenticated" } };
  await page.addInitScript(session => { localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); localStorage.setItem("liftcut-locale", "en"); }, session);
  let authRequests = 0;
  await page.route("http://127.0.0.1:55438/**", async route => { authRequests++; await route.fulfill({ status: 401, json: {} }); });
  await page.goto(`/auth/callback?attempt=${owner}&code=${"a".repeat(32)}`);
  await expect(page.getByText(/An account is already signed in/)).toBeVisible();
  expect(authRequests).toBe(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sb-127-auth-token")!).user.id)).toBe(owner);
});

test("pending deletion cannot be bypassed through registration or the public email return", async ({ page }) => {
  const record = { owner: "11111111-1111-4111-8111-111111111111", requestId: "22222222-2222-4222-8222-222222222222",
    email: "pending@local.test", receipt: "synthetic-pending-receipt".repeat(2), stage: "pending" };
  await page.addInitScript(record => { localStorage.setItem(`liftcut-deletion-v1:${record.owner}`, JSON.stringify(record)); localStorage.setItem("liftcut-locale", "en"); }, record);
  await page.route("http://127.0.0.1:3109/**", async route => { expect(route.request().method()).toBe("GET"); await route.fulfill({ json: { available: true } }); });
  let authRequests = 0;
  await page.route("http://127.0.0.1:55438/**", async route => { authRequests++; await route.fulfill({ status: 401, json: {} }); });
  for (const path of ["/register", `/auth/callback?attempt=${record.owner}&code=${"a".repeat(32)}`]) {
    await page.goto(path); await expect(page).toHaveURL(/\/delete-account$/);
    await expect(page.getByRole("button", { name: "Create account", exact: true })).toHaveCount(0);
  }
  expect(authRequests).toBe(0);
  expect(await page.evaluate(owner => JSON.parse(localStorage.getItem(`liftcut-deletion-v1:${owner}`)!).receipt, record.owner)).toBe(record.receipt);
});

for (const path of ["/sign-in", `/auth/callback?attempt=11111111-1111-4111-8111-111111111111&code=${"a".repeat(32)}`]) test(`slow deletion storage retains cold launch ${path.split("?")[0]}`, async ({ page }) => {
  type ReadGate = { __deletionGate: Promise<void>; __releaseDeletion: () => void; __deletionReadReached: boolean };
  await page.addInitScript(() => {
    localStorage.setItem("liftcut-locale", "en");
    const state = window as typeof window & ReadGate;
    state.__deletionReadReached = false; state.__deletionGate = new Promise(resolve => { state.__releaseDeletion = resolve; });
  });
  // Fault injection in the test response only: defer the real adapter's getAllKeys.
  // This exercises shipped navigation/controller code without a production timing flag.
  await page.route(/\/__common-[^/]+\.js$/, async route => {
    const response = await route.fetch(), body = await response.text(), marker = "await this.io.store.getAllKeys()";
    expect(body.split(marker)).toHaveLength(2);
    await route.fulfill({ response, body: body.replace(marker, "await (globalThis.__deletionReadReached=true,globalThis.__deletionGate.then(()=>this.io.store.getAllKeys()))") });
  });
  await page.goto(path);
  await expect.poll(() => page.evaluate(() => (window as typeof window & ReadGate).__deletionReadReached)).toBe(true);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(path);
  await expect(page.getByText("Delete account", { exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as typeof window & ReadGate).__releaseDeletion());
  await expect(page.getByRole("heading", { name: path === "/sign-in" ? "Sign in to LiftCut" : "Confirm email", exact: true })).toBeVisible();
  expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(path);
});
