import { test, expect, type BrowserContext } from "@playwright/test";
test.use({ serviceWorkers: "block" });
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const session = (method = "oauth", noEmail = false) => ({ access_token: `${part({ alg: "HS256" })}.${part({ sub: owner, role: "authenticated", exp: 2200000000,
  amr: [{ method, timestamp: Math.floor(Date.now() / 1000) }] })}.synthetic`, refresh_token: "synthetic-refresh", expires_in: 3600, expires_at: 2200000000,
  token_type: "bearer", user: { id: owner, email: noEmail ? undefined : "deletion@local.test", aud: "authenticated", app_metadata: { provider: "email" }, created_at: "2026-10-27T00:00:00Z" } });
async function fixture(context: BrowserContext, stale = false, noEmail = false) {
  const original = session("oauth", noEmail), fresh = session("password", noEmail), unexpected: string[] = [];
  let posts = 0, deletes = 0, requestId = "", finish = stale;
  await context.addCookies([{ name: "sb-127-auth-token", value: `base64-${part(original)}`, domain: "127.0.0.1", path: "/", sameSite: "Lax" }]);
  await context.addInitScript(({ owner, other }) => {
    if (!localStorage.getItem("deletion-seeded")) {
      localStorage.setItem(`liftcut-chat-history:${owner}`, "A history"); localStorage.setItem(`liftcut-chat-history:${other}`, "B history");
      localStorage.setItem("liftcut-guest-fact-v1:test", "guest"); localStorage.setItem("liftcut-ui", JSON.stringify({ state: { language: "zh-CN", theme: "light" }, version: 0 }));
      localStorage.setItem("deletion-seeded", "1");
    }
  }, { owner, other });
  await context.route("**/*", async route => {
    const r = route.request(), url = new URL(r.url());
    if (url.pathname === "/api/account/deletion") {
      if (r.method() === "GET") return route.fulfill({ json: { available: true } });
      expect(r.headers()["x-workout-owner"]).toBe(owner); const body = r.postDataJSON();
      if (r.method() === "POST") {
        posts++; expect(body.confirmed).toBe(true); requestId = body.requestId;
        if (stale && r.headers().authorization === `Bearer ${original.access_token}`) return route.fulfill({ status: 401, json: { error: "reauthenticate" } });
        return route.fulfill({ status: 202, json: { status: "pending", requestId, receipt: "synthetic-browser-receipt-for-this-owner".repeat(2) } });
      }
      deletes++; expect(r.headers().authorization).toBeUndefined();
      return route.fulfill(finish ? { json: { status: "deleted", requestId } } : { status: 409, json: { error: "pending" } });
    }
    if (url.pathname === "/auth/v1/token") return route.fulfill({ json: fresh });
    if (url.pathname === "/auth/v1/user") return route.fulfill({ json: fresh.user });
    if (url.pathname === "/auth/v1/logout") return route.fulfill({ status: 204 });
    if (url.pathname.startsWith("/rest/v1/") || url.pathname.startsWith("/api/") || url.pathname === "/agent") { unexpected.push(url.pathname); return route.abort(); }
    return route.continue();
  });
  return { counts: () => ({ posts, deletes }), finish: () => { finish = true; }, unexpected };
}
test("production-default deletion stays disabled and only its exact page is public", async ({ page, request }) => {
  expect(await (await request.get("/api/account/deletion")).json()).toEqual({ available: false });
  const response = await request.get("/delete-account"); expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect((await request.get("/delete-account/extra", { maxRedirects: 0 })).headers().location).toContain("/login");
  await page.goto("/delete-account"); await expect(page.getByText(/暂未启用|not enabled/)).toBeVisible();
  await expect(page.getByRole("button", { name: /确认并永久删除|Confirm permanent deletion/ })).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem("liftcut-ui", JSON.stringify({ state: { language: "en", theme: "light" }, version: 0 })));
  await page.reload(); await expect(page.getByRole("heading", { name: "Delete account", exact: true })).toBeVisible();
  await page.screenshot({ path: "node_modules/.cache/support/deletion-en.png" });
});
test("explicit password confirmation, lost delete reply, reload and precise owner cleanup use the shared controller", async ({ page, context }) => {
  const f = await fixture(context); await page.goto("/delete-account");
  await expect(page.getByText("deletion@local.test", { exact: true })).toBeVisible();
  const button = page.getByRole("button", { name: "确认并永久删除" }); await expect(button).toBeDisabled();
  await page.getByLabel("当前账号密码").fill("synthetic password"); await expect(button).toBeDisabled();
  await page.getByRole("checkbox").check(); await expect(button).toBeEnabled(); await page.screenshot({ path: "node_modules/.cache/support/deletion-zh.png" }); await button.click();
  await expect(page.locator("p[role=alert]")).toContainText("结果尚未确认"); expect(f.counts()).toEqual({ posts: 1, deletes: 1 });
  expect((await context.cookies()).some(c => c.name === "sb-127-auth-token")).toBe(true);
  await page.reload(); await expect(page.getByText(/删除处理中或结果待核实/)).toBeVisible();
  f.finish(); await page.getByRole("button", { name: "重试核实并完成清理" }).click();
  await expect(page.getByText("账号已删除，本机该账号数据已清理.")).toBeVisible();
  expect(await page.evaluate(owner => localStorage.getItem(`liftcut-chat-history:${owner}`), owner)).toBeNull();
  expect(await page.evaluate(other => localStorage.getItem(`liftcut-chat-history:${other}`), other)).toBe("B history");
  expect(await page.evaluate(() => localStorage.getItem("liftcut-guest-fact-v1:test"))).toBe("guest"); expect(f.unexpected).toEqual([]);
});
test("stale current session is refused; signing in again returns to deletion and still needs explicit confirmation", async ({ page, context }) => {
  const f = await fixture(context, true); await page.goto("/delete-account");
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "使用刚重新登录的会话确认" }).click();
  await expect(page.locator("p[role=alert]")).toContainText("重新验证"); expect(f.counts().deletes).toBe(0);
  await page.getByRole("button", { name: "重新登录并返回" }).click(); await expect(page).toHaveURL(/\/login\?returnTo=delete-account$/);
  await page.locator("#email").fill("deletion@local.test"); await page.locator("#password").fill("synthetic password"); await page.locator("form button[type=submit]").click();
  await expect(page).toHaveURL(/\/delete-account$/); await expect(page.getByRole("checkbox")).not.toBeChecked(); expect(f.counts().deletes).toBe(0);
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "使用刚重新登录的会话确认" }).click();
  await expect(page.getByText("账号已删除，本机该账号数据已清理.")).toBeVisible(); expect(f.unexpected).toEqual([]);
});
test("OAuth without email displays the real owner ID and confirms a fresh session without fabricating an email", async ({ page, context }) => {
  const f = await fixture(context, false, true); f.finish(); await page.goto("/delete-account");
  await expect(page.getByText(`账号 ID: ${owner}`, { exact: true })).toBeVisible();
  await expect(page.getByLabel("当前账号密码")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "使用刚重新登录的会话确认" })).toBeDisabled();
  await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "使用刚重新登录的会话确认" }).click();
  await expect(page.getByText("账号已删除，本机该账号数据已清理.")).toBeVisible(); expect(f.counts().posts).toBe(1);
});
