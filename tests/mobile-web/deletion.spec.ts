import { test, expect, type Page } from "@playwright/test";
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const user = { id: owner, email: "synthetic@local.test", aud: "authenticated", created_at: "2026-10-27T00:00:00Z" };
const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: owner, exp: 2200000000 })).toString("base64url")}.synthetic`;
const session = { access_token: token, refresh_token: "synthetic-refresh", expires_at: 2200000000, expires_in: 3600, token_type: "bearer", user };
const optIn = process.env.MOBILE_DELETION_OPT_IN === "true";
const priorId = "33333333-3333-4333-8333-333333333333", receipt = "synthetic-local-deletion-receipt".repeat(2);
async function setup(page: Page, available: boolean, prior?: "preparing" | "pending") {
  let ordinary = 0, posts = 0, deletes = 0, reauth = 0, requestId = prior ? priorId : "", finish = false;
  await page.addInitScript(({ session, other, prior, priorId, receipt }) => {
    if (!localStorage.getItem("seeded")) {
      localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); localStorage.setItem("liftcut-locale", "zh-CN");
      localStorage.setItem(`liftcut-chat-history:${other}`, "B untouched"); localStorage.setItem("liftcut-guest-fact-v1:workspace:test", "guest");
      localStorage.setItem("seeded", "1");
      // Existing durable intent from an earlier explicitly confirmed deletion.
      if (prior) localStorage.setItem(`liftcut-deletion-v1:${session.user.id}`, JSON.stringify({ owner: session.user.id,
        email: session.user.email, requestId: priorId, receipt: prior === "pending" ? receipt : null, stage: prior }));
    }
  }, { session, other, prior, priorId, receipt });
  await page.route(/^http:\/\/(127\.0\.0\.1:55440|localhost:3103)\//, async route => {
    const r = route.request(), method = r.method(), path = new URL(r.url()).pathname;
    const headers = { "access-control-allow-origin": "http://localhost:8099", "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
      "access-control-allow-headers": r.headers()["access-control-request-headers"] ?? "*" };
    const reply = (body: unknown, status = 200) => route.fulfill({ status, headers, contentType: "application/json", body: JSON.stringify(body) });
    if (method === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path.endsWith("/token")) { reauth++; return reply(session); }
    if (path.endsWith("/user")) return reply(user);
    if (path.endsWith("/logout")) return route.fulfill({ status: 204, headers });
    if (path === "/api/account/deletion") {
      if (method === "GET") return reply({ available });
      if (method === "POST") { posts++; const body = r.postDataJSON(); expect(body.confirmed).toBe(true);
        expect(r.headers()["x-workout-owner"]).toBe(owner); if (prior) expect(body.requestId).toBe(priorId); requestId = body.requestId;
        return reply({ status: "pending", requestId, receipt }, 202); }
      deletes++; expect(r.headers()["x-workout-owner"]).toBe(owner); expect(r.postDataJSON().receipt).toBe(receipt);
      return finish ? reply({ status: "deleted", requestId }) : reply({ error: "pending" }, 409);
    }
    ordinary++;
    return path === "/api/workout-sessions" ? reply({ days: [], session: null, previous: {} }) : reply({ conversations: [], next: null });
  });
  return { count: () => ({ ordinary, posts, deletes, reauth }), finish: () => { finish = true; } };
}
test("phone hides disabled deletion and its public page never offers a destructive action", async ({ page }) => {
  await setup(page, false); await page.goto("/settings");
  await expect(page.getByText(user.email, { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /删除账号/ })).toHaveCount(0);
  await page.goto("/delete-account"); await expect(page.getByText(/账号删除暂未启用/)).toBeVisible();
  await expect(page.getByRole("button", { name: "确认并永久删除" })).toHaveCount(0);
});
test("phone requires confirmation, preserves unknown deletion across reload, fences ordinary work and cleans only A", async ({ page }) => {
  test.skip(!optIn, "New deletion is exercised only in the explicit opt-in fixture build");
  const f = await setup(page, true); await page.goto("/settings"); await page.getByRole("link", { name: /删除账号/ }).click();
  await expect(page.getByText(user.email, { exact: true }).filter({ visible: true })).toBeVisible();
  const remove = page.getByRole("button", { name: "确认并永久删除" }); await expect(remove).toBeDisabled();
  await page.getByLabel("当前账号密码").fill("synthetic password"); await expect(remove).toBeDisabled();
  await page.getByRole("checkbox").click(); await page.screenshot({ path: "node_modules/.cache/mobile-deletion-zh.png" });
  await remove.click(); await expect(page.getByText(/结果尚未确认/)).toBeVisible();
  expect(f.count().posts).toBe(1); expect(f.count().deletes).toBe(1);
  const before = f.count().ordinary;
  await page.goto("/coach"); await expect(page).toHaveURL(/\/delete-account$/);
  await page.reload(); await expect(page.getByText(/删除处理中或结果待核实/)).toBeVisible(); expect(f.count().ordinary).toBe(before);
  f.finish(); await page.getByRole("button", { name: "重试核实并完成清理" }).click();
  await expect(page.getByText("账号已删除，本机该账号数据已清理.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("sb-127-auth-token"))).toBe(null);
  expect(await page.evaluate(o => localStorage.getItem(`liftcut-chat-history:${o}`), other)).toBe("B untouched");
  expect(await page.evaluate(() => localStorage.getItem("liftcut-guest-fact-v1:workspace:test"))).toBe("guest");
  expect(await page.evaluate(() => localStorage.getItem("liftcut-locale"))).toBe("zh-CN");
  await page.evaluate(() => localStorage.setItem("liftcut-locale", "en")); await page.reload();
  await expect(page.getByText("Delete account", { exact: true })).toBeVisible();
  await expect(page.getByText(/In-app account deletion is not enabled in this build/)).toHaveCount(0);
  await page.screenshot({ path: "node_modules/.cache/mobile-deletion-en.png" });
});

test("server enabled cannot expose or start a new deletion in the default-off build, including direct navigation", async ({ page }) => {
  test.skip(optIn, "Default-off build gate scenario");
  const f = await setup(page, true); await page.goto("/settings");
  await expect(page.getByText(user.email, { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /删除账号/ })).toHaveCount(0);
  await page.goto("/delete-account");
  await expect(page.getByText(/此版本暂未开放应用内账号删除/)).toBeVisible();
  await expect(page.getByLabel("当前账号密码")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "确认并永久删除" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "在网页继续" })).toBeVisible();
  expect(f.count()).toMatchObject({ posts: 0, deletes: 0, reauth: 0 });
  await page.screenshot({ path: "node_modules/.cache/mobile-deletion-build-off.png" });
});

for (const stage of ["preparing", "pending"] as const) test(`prior ${stage} deletion can recover even in the default-off build`, async ({ page }) => {
  const f = await setup(page, true, stage); await page.goto("/coach");
  await expect(page).toHaveURL(/\/delete-account$/);
  await expect(page.getByText(/删除处理中或结果待核实/)).toBeVisible();
  expect(f.count()).toMatchObject({ ordinary: 0, posts: 0, deletes: 0, reauth: 0 });
  f.finish();
  if (stage === "preparing") {
    const remove = page.getByRole("button", { name: "确认并永久删除" }); await expect(remove).toBeDisabled();
    await page.getByLabel("当前账号密码").fill("synthetic password"); await expect(remove).toBeDisabled();
    await page.getByRole("checkbox").click(); await remove.click();
  } else await page.getByRole("button", { name: "重试核实并完成清理" }).click();
  await expect(page.getByText("账号已删除，本机该账号数据已清理.")).toBeVisible();
  expect(f.count()).toMatchObject({ posts: stage === "preparing" ? 1 : 0, deletes: 1, reauth: stage === "preparing" ? 1 : 0 });
  expect(await page.evaluate(id => localStorage.getItem(`liftcut-deletion-v1:${id}`), owner)).toBe(null);
  expect(await page.evaluate(id => localStorage.getItem(`liftcut-chat-history:${id}`), other)).toBe("B untouched");
});
