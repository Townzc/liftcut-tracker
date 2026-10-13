import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type { RunView } from "../../src/lib/agent/contracts";
const db = new Pool({ connectionString: process.env.P1_TEST_DATABASE_URL });
test.afterAll(async () => { await db.end(); });
const plan = { plan_name: "Browser synthetic plan", goal_type: "maintenance", summary: "Synthetic local fixture",
  weeks: [{ week_number: 1, days: [{ day_number: 1, title: "A", estimated_duration_minutes: 30,
    exercises: [{ name: "Squat", sets: 2, rep_range: "8", target_rpe: 6, rest_seconds: 90 }] }] }] };

async function preview(page: Page) {
  await page.goto("/login");
  await page.locator("#email").fill("p1-fixture@example.invalid");
  await page.locator("#password").fill("p1-fixture-password");
  await page.locator('button[type="submit"]').click();
  await page.waitForURL(/\/(?:onboarding)?$/);
  await page.goto("/plan/review");
  await page.getByRole("button", { name: "创建预览流程" }).click();
  await expect(page.getByText("请生成新的预览", { exact: true })).toBeVisible();
  await page.getByLabel("训练计划 JSON").fill(JSON.stringify(plan));
  await page.getByRole("button", { name: "生成不可变预览" }).click();
  await expect(page.getByText("等待你批准当前预览", { exact: true })).toBeVisible();
}
async function readRun(page: Page): Promise<RunView> {
  const id = await page.getByLabel("运行编号").inputValue();
  const response = await page.request.get(`/api/agent/runs/${id}`);
  expect(response.status()).toBe(200);
  return (await response.json()).value;
}
test("browser preview → approve → commit response lost → reload → same durable receipt", async ({ page }) => {
  await preview(page);
  const start = await readRun(page);
  expect(start.receipt).toBeNull();
  await expect(page.getByRole("button", { name: "执行 / 重试同一操作" })).toBeDisabled();
  await page.getByRole("button", { name: "批准此版本" }).click();
  await expect(page.getByText("已批准，尚未写入", { exact: true })).toBeVisible();
  await page.route("**/api/agent/runs/*/execute", async route => {
    const response = await route.fetch(); // The real Next API/PG transaction completes.
    expect(response.status()).toBe(200);
    await route.abort("connectionreset"); // Browser never receives the committed response.
  }, { times: 1 });
  await page.getByRole("button", { name: "执行 / 重试同一操作" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "操作未确认" })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "查询 / 恢复" }).click();
  await expect(page.getByText("计划已保存", { exact: true })).toBeVisible();
  const recovered = await readRun(page);
  expect(recovered.receipt).not.toBeNull();
  const count = await db.query("select count(*) from agent_private.receipts where run_id=$1", [start.id]);
  expect(count.rows[0].count).toBe("1");
  const rows = await db.query("select count(*) from public.training_plan_exercises where day_id like $1", [recovered.receipt!.planId + "%"]);
  expect(rows.rows[0].count).toBe("1");
  await page.screenshot({ path: "research/liftcut-agent/outputs/p1-browser-applied.png", fullPage: true });
  await page.getByRole("button", { name: "查看计划", exact: true }).click();
  await page.waitForURL("/plan");
  await expect(page.getByText("Browser synthetic plan", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Squat", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: "research/liftcut-agent/outputs/p1-browser-plan.png", fullPage: true });
});
test("browser revoke blocks late API execute; changing constraints invalidates approved version", async ({ page }) => {
  await preview(page);
  await page.getByRole("button", { name: "批准此版本" }).click();
  await expect(page.getByText("已批准，尚未写入", { exact: true })).toBeVisible();
  const approved = await readRun(page), p = approved.proposal!;
  await page.getByRole("button", { name: "撤销批准" }).click();
  await expect(page.getByText("批准已撤销，不能执行此预览", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "执行 / 重试同一操作" })).toBeDisabled();
  const response = await page.request.post(`/api/agent/runs/${approved.id}/execute`, {
    headers: { Origin: "http://localhost:3101", "Content-Type": "application/json" },
    data: { binding: { proposalId: p.proposalId, contentHash: p.contentHash, contextRevision: p.contextRevision },
      approvalId: approved.approvalId, idempotencyKey: randomUUID() },
  });
  expect(response.status()).toBe(409); expect((await response.json()).error).toBe("NOT_APPROVED");
  expect((await readRun(page)).receipt).toBeNull();
  await page.getByRole("button", { name: "更新约束（使旧批准失效）" }).click();
  await expect(page.getByText("请生成新的预览", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "批准此版本" })).toBeDisabled();
  await page.screenshot({ path: "research/liftcut-agent/outputs/p1-browser-revoked.png", fullPage: true });
});
test("API rejects missing session and cross-origin mutations", async ({ request }) => {
  const noSession = await request.post("/api/agent/runs", { headers: { Origin: "http://localhost:3101" }, data: {} });
  expect(noSession.status()).toBe(401);
  const cross = await request.post("/api/agent/runs", { headers: { Origin: "https://other.example" }, data: {} });
  expect(cross.status()).toBe(403);
});
