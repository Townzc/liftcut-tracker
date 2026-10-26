import { test, expect, type Request } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { relay, signIn, expectBearerOnly, type Sent } from "./helpers";
const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL });
const owner = "11111111-1111-4111-8111-111111111111", plan = randomUUID(), day = randomUUID(), exercise = randomUUID();
test.beforeAll(async () => {
  await db.query("insert into auth.users values($1) on conflict do nothing", [owner]);
  await db.query("update training_plans set is_active=false where user_id=$1", [owner]);
  await db.query("insert into training_plans(id,user_id,name,is_active) values($1,$2,'Mobile context fixture',true)", [plan, owner]);
  await db.query("insert into training_plan_weeks values($1,$2,1)", [plan + "w", plan]);
  await db.query("insert into training_plan_days(id,week_id,day_number,title) values($1,$2,1,'连续对话验收')", [day, plan + "w"]);
  await db.query("insert into training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'深蹲',1,'99',10)", [exercise, day]);
  await db.query("delete from coach_request_usage where user_id=$1", [owner]);
  await db.query("delete from coach_conversations where user_id=$1", [owner]);
});
test.afterAll(async () => {
  await db.query("delete from workout_sessions where training_plan_id=$1", [plan]);
  await db.query("delete from training_plans where id=$1", [plan]);
  await db.query("delete from coach_request_usage where user_id=$1", [owner]); await db.end();
});
// Same existing scripted-provider scenarios as the web, through Expo's browser export.
// Real bearer API/outbox/PostgreSQL; neither model-intelligence nor native-device evidence.
test("mobile review: confirmed focus beyond six turns, correction, inheritance, void, redo and exact retry", async ({ page }) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(15000);
  const sent: Sent[] = [], approvals: Request[] = [], chats: { conversationId: string; history: unknown[] }[] = [];
  await relay(page, sent);
  page.on("request", r => {
    if (r.url().includes("/api/workout-commands?action=review") && r.method() === "POST") approvals.push(r);
    if (r.url().endsWith("/api/ai/coach") && r.method() === "POST") chats.push(r.postDataJSON());
  });
  await signIn(page); await page.getByRole("button", { name: "开始训练" }).click();
  await expect(page.getByText("进行中的训练 · 连续对话验收")).toBeVisible();
  await expect(page.getByTestId("outbox-status")).toHaveText("已同步");
  await page.getByRole("link", { name: "教练" }).click(); await page.getByRole("button", { name: "同意并开启" }).click();
  const turns = page.getByTestId("coach-turn"), input = page.getByLabel("发给训练助手");
  const rows = async () => (await db.query(`select l.id,l.revision,l.status,l.reps,l.weight_kg::float as weight from set_logs l
    join workout_sessions s on s.id=l.session_id where s.training_plan_id=$1 order by set_index`, [plan])).rows;
  const send = async (text: string) => {
    // Compress human pauses only for this synthetic owner; quota enforcement has its own DB tests.
    await db.query("delete from coach_request_usage where user_id=$1", [owner]);
    const n = await turns.count(); await input.fill(text); await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(turns).toHaveCount(n + 1); await expect(turns.last()).toHaveAttribute("aria-busy", "false");
  };
  const confirm = async () => {
    await turns.last().getByRole("button", { name: "确认记录", exact: true }).click();
    await expect(turns.last()).toContainText("已保存，服务端记录已确认");
  };
  await send("深蹲42公斤，9次 [context-record]"); expect(await rows()).toEqual([]); await confirm();
  const first = (await rows())[0], retry = approvals.at(-1)!;
  const retried = await page.request.post(retry.url(), { headers: retry.headers(), data: retry.postData()! });
  expect(retried.status()).toBe(200); expect(await rows()).toHaveLength(1);
  expect((await db.query("select count(*)::int n from workout_session_events where set_log_id=$1", [first.id])).rows[0].n).toBe(1);
  for (let i = 0; i < 8; i++) await send("你好");
  await expect(page.getByTestId("coach-history-status")).toHaveText("对话已同步");
  await input.fill("尚未发送的训练草稿");
  await page.goBack(); await page.waitForURL(/\/$/);
  await page.getByRole("link", { name: "设置" }).click(); await page.waitForURL(/\/settings$/);
  await page.goBack(); await page.waitForURL(/\/$/); await page.getByRole("link", { name: "教练" }).click();
  await expect(input).toHaveValue("尚未发送的训练草稿"); await page.reload();
  await expect(input).toHaveValue("尚未发送的训练草稿"); await expect(turns).toHaveCount(9);
  await expect(turns.first()).toContainText("聊天文字不代表写入回执");
  await expect(page.getByRole("button", { name: "确认记录", exact: true })).toHaveCount(0);
  await send("刚才那组不对，5次 [context-correct]"); expect((await rows())[0].reps).toBe(9);
  await expect(turns.last()).toContainText("42 公斤 × 9 次");
  await turns.last().getByRole("button", { name: "确认记录", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: "node_modules/.cache/mobile-web/coach-context-review-mobile.png" }); await confirm();
  expect((await rows())[0]).toMatchObject({ id: first.id, reps: 5, revision: 2 });
  await send("深蹲重量不变，又做了9次 [context-inherit]"); await confirm();
  expect((await rows())[1]).toMatchObject({ weight: 42, reps: 9 });
  await send("刚才那组不算，重新做 [context-void]"); await expect(turns.last()).toContainText("作废"); await confirm();
  await send("深蹲42公斤，9次 [context-redo]"); await confirm();
  expect((await rows()).map(s => s.status)).toEqual(["done", "voided", "done"]);
  await send("深蹲42公斤，9次 [context-record]");
  await expect(page.getByTestId("coach-history-status")).toHaveText("对话已同步"); await page.reload();
  await expect(turns).toHaveCount(14); await expect(page.getByRole("button", { name: "确认记录", exact: true })).toHaveCount(0);
  expect(await rows()).toHaveLength(3); await send("你好");
  await expect(page.getByRole("button", { name: "确认记录", exact: true })).toHaveCount(0); expect(await rows()).toHaveLength(3);
  expect(new Set(chats.map(x => x.conversationId)).size).toBe(1); expect(chats[0].conversationId).toMatch(/^[a-f0-9-]{36}$/);
  expect(chats.every(x => x.history.length <= 12)).toBe(true);
  await page.screenshot({ path: "node_modules/.cache/mobile-web/coach-context-mobile.png", fullPage: true });
  expectBearerOnly(sent);
  // The same cloud history is selectable after starting a new thread. Deletion only removes prose.
  await expect(page.getByTestId("coach-history-status")).toHaveText("对话已同步");
  await page.getByRole("button", { name: "新对话", exact: true }).click(); await expect(turns).toHaveCount(0);
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  await page.getByTestId("coach-history-list").getByRole("button", { name: "深蹲42公斤，9次 [context-record]", exact: true }).click();
  await expect(turns).toHaveCount(15); await expect(page.getByRole("button", { name: "确认记录", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "历史对话", exact: true }).click();
  await page.getByTestId("coach-history-list").getByRole("button", { name: "删除对话", exact: true }).click();
  await page.getByRole("button", { name: "取消", exact: true }).click(); await expect(turns).toHaveCount(15);
  await page.getByTestId("coach-history-list").getByRole("button", { name: "删除对话", exact: true }).click();
  await page.getByRole("button", { name: "确认删除对话", exact: true }).click(); await expect(turns).toHaveCount(0);
  expect(await rows()).toHaveLength(3); expect((await rows()).map(s => s.status)).toEqual(["done", "voided", "done"]);
});
