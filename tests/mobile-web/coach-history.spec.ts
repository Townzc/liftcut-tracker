import { test, expect, type Route } from "@playwright/test";
import { Pool } from "pg";
import { relay, signIn, expectBearerOnly, type Sent } from "./helpers";
const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL });
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
test.afterAll(async () => { await db.end(); });

test("phone history retries after reload, recovers from cloud and clears account cache on logout", async ({ page }) => {
  page.setDefaultTimeout(15000);
  await db.query("delete from coach_request_usage where user_id=any($1::uuid[])", [[owner, other]]);
  await db.query("delete from coach_conversations where user_id=any($1::uuid[])", [[owner, other]]);
  const sent: Sent[] = [], cacheKey = `liftcut-chat-history:${owner}`;
  await relay(page, sent); await signIn(page); await page.getByRole("link", { name: "教练" }).click();
  await page.getByRole("button", { name: "同意并开启" }).click();
  const failSave = async (route: Route) => route.request().method() === "POST"
    ? route.fulfill({ status: 503, headers: { "access-control-allow-origin": "http://localhost:8099" }, body: "{}" }) : route.fallback();
  await page.route("**/api/coach/history", failSave);
  const input = page.getByLabel("发给训练助手"), turns = page.getByTestId("coach-turn"), status = page.getByTestId("coach-history-status");
  await input.fill("你好"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(turns).toHaveCount(1); await expect(turns.last()).toHaveAttribute("aria-busy", "false");
  await expect(status).toContainText("聊天同步暂不可用"); await input.fill("还没发送的草稿");
  await expect.poll(() => page.evaluate(k => JSON.parse(localStorage.getItem(k)!).chats[0].text, cacheKey)).toBe("还没发送的草稿");
  await page.reload(); await expect(input).toHaveValue("还没发送的草稿"); await expect(turns).toHaveCount(1);
  await expect(status).toContainText("聊天同步暂不可用");
  await page.unroute("**/api/coach/history", failSave); await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(status).toHaveText("对话已同步");
  expect((await db.query("select count(*)::int n from coach_turns where user_id=$1", [owner])).rows[0].n).toBe(1);
  // Remove only this synthetic local cache to prove the next selection reads the cloud copy.
  await page.evaluate(k => localStorage.removeItem(k), cacheKey); await page.reload(); await expect(turns).toHaveCount(0);
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  await page.getByTestId("coach-history-list").getByRole("button", { name: "你好", exact: true }).click();
  await expect(turns).toHaveCount(1); await page.screenshot({ path: "node_modules/.cache/mobile-web/coach-history-mobile.png" });
  await page.goBack(); await page.getByRole("link", { name: "设置" }).click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click(); await expect(page.getByText("登录 LiftCut", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(k => localStorage.getItem(k), cacheKey)).toBe(null);
  await page.getByLabel("邮箱").fill("offline-second@example.invalid"); await page.getByLabel("密码").fill("p1-fixture-password");
  await page.getByRole("button", { name: "登录", exact: true }).click(); await page.getByRole("link", { name: "教练" }).click();
  await page.getByRole("button", { name: "同意并开启" }).click(); await expect(turns).toHaveCount(0);
  const listed = page.waitForResponse(r => r.url().endsWith("/api/coach/history") && r.request().method() === "GET" && r.status() === 200);
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  await listed;
  await expect(page.getByTestId("coach-history-list").getByRole("button", { name: "你好", exact: true })).toHaveCount(0);
  expectBearerOnly(sent);
  await page.unrouteAll({ behavior: "wait" }); // Finish relays before Playwright disposes their responses.
});
