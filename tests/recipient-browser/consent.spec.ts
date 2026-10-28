import { test, expect, type Page } from "@playwright/test";
import type { AiRecipient } from "@liftcut/core/ai-recipient";

const key = "liftcut-coach-consent:guest";
async function guest(page: Page, en = false) {
  await page.context().addCookies([{ name: "liftcut_guest", value: "1", url: "http://127.0.0.1:3112" },
    { name: "NEXT_LOCALE", value: en ? "en" : "zh-CN", url: "http://127.0.0.1:3112" }]);
  await page.addInitScript(({ key, en }) => { localStorage.setItem("liftcut-guest-mode", "true"); localStorage.setItem(key, "coach-model-v2");
    localStorage.setItem("liftcut-ui", JSON.stringify({ state: { language: en ? "en" : "zh-CN", theme: "light" }, version: 0 })); }, { key, en });
  await page.route("**/api/guest-session", route => route.fulfill({ json: { remaining: 10, limit: 10 } }));
  await page.goto("/agent"); await expect(page.locator("#coach-input")).toBeEnabled();
}
async function send(page: Page, text: string) {
  await page.locator("#coach-input").fill(text);
  await page.locator("#coach-input").locator("xpath=..").locator('button[type="submit"]').click();
  await expect(page.getByTestId("coach-turn").last()).toHaveAttribute("aria-busy", "false");
}

for (const en of [false, true]) test(`recipient-bound consent, changed policy and no auto resend (${en ? "en" : "zh"})`, async ({ page }) => {
  const status = await (await page.request.get("/api/ai/coach")).json();
  const first: AiRecipient = status.recipient, second = { ...first, id: "b".repeat(64), model: "changed-fixture" };
  const requests: Record<string, unknown>[] = [];
  await page.route("**/api/ai/coach", async route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ...status, recipient: requests.length ? second : first } });
    const body = route.request().postDataJSON(); requests.push(body);
    return requests.length === 1 ? route.fulfill({ status: 409, json: { error: "AI_CONSENT_REQUIRED" } })
      : route.fulfill({ json: { requestId: body.id, message: "Synthetic response", model: second.model, provider: "local", sources: [] } });
  });
  await guest(page, en);
  const panel = page.getByTestId("coach-consent"), agree = page.getByRole("button", { name: en ? "Agree & enable" : "同意并开启", exact: true });
  await expect(panel).toContainText(first.origin); await expect(panel).toContainText(first.model);
  await send(page, en ? "Hello" : "你好"); expect(requests).toHaveLength(0); // Old version-only consent is insufficient.
  await agree.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `node_modules/.cache/recipient/consent-${en ? "en" : "zh"}.png` });
  await agree.click(); await send(page, en ? "Please help me" : "请帮我整理训练");
  expect(requests[0].recipient).toBe(first.id);
  await expect(panel).toContainText(second.model); await expect(agree).toBeEnabled();
  await expect(page.getByTestId("coach-turn").last()).toContainText(en ? "not resent" : "不会自动重发");
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  expect(requests).toHaveLength(1); await expect(page.getByTestId("coach-turn")).toHaveCount(2);
  await agree.click(); expect(requests).toHaveLength(1);
  await send(page, en ? "Continue please" : "请继续"); expect(requests[1].recipient).toBe(second.id);
  await expect(page.getByTestId("coach-turn").last()).toContainText("Synthetic response");
  await page.evaluate(key => { localStorage.removeItem(key); window.dispatchEvent(new StorageEvent("storage", { key })); }, key);
  await expect(agree).toBeEnabled(); await send(page, en ? "Hello again" : "你好呀"); expect(requests).toHaveLength(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("unreviewed recipient blocks further cloud sends but keeps local entry confirmation", async ({ page }) => {
  const status = await (await page.request.get("/api/ai/coach")).json(); let calls = 0;
  await page.route("**/api/ai/coach", route => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ...status, recipient: calls ? null : status.recipient } });
    calls++; return route.fulfill({ status: 409, json: { error: "AI_RECIPIENT_UNREVIEWED" } });
  });
  await guest(page); await page.getByRole("button", { name: "同意并开启", exact: true }).click();
  await send(page, "请帮我整理训练");
  await expect(page.getByRole("button", { name: "同意并开启", exact: true })).toBeDisabled();
  await send(page, "记录体重 72 公斤"); await expect(page.getByTestId("personal-draft")).toContainText("72 kg");
  await expect(page.getByRole("button", { name: "确认补录", exact: true })).toBeEnabled(); expect(calls).toBe(1);
});

test("legacy training and nutrition require explicit consent and attach its recipient header", async ({ page }) => {
  const status = await (await page.request.get("/api/ai/coach")).json(), headers: string[] = [];
  // Legacy generation is independent of the coach/today feature flag.
  await page.route("**/api/ai/coach", route => route.fulfill({ json: { ...status, available: false } }));
  await page.route("**/api/ai/generate-*", route => {
    headers.push(route.request().headers()["x-liftcut-ai-recipient"]);
    return route.fulfill({ status: 409, json: { error: "AI_CONSENT_REQUIRED" } });
  });
  await guest(page); await page.goto("/plan/ai");
  const panel = page.getByTestId("plan-recipient-consent"), buttons = page.getByRole("button", { name: /生成训练计划|生成饮食计划/, exact: true });
  await expect(panel).toContainText(status.recipient.origin); await expect(buttons.first()).toBeDisabled();
  await expect(panel.getByRole("listitem")).toHaveCount(9); // Guest legacy requests also send the profile snapshot.
  await expect(panel).toContainText("年龄"); await expect(panel).toContainText("伤病");
  for (let index = 0; index < 2; index++) {
    await panel.getByRole("button", { name: "同意并开启", exact: true }).click();
    await buttons.nth(index).click(); await expect(buttons.nth(index)).toBeDisabled();
    await expect(page.getByText("请核对 AI 接收方并同意发送. 本次请求不会自动重发.", { exact: true })).toBeVisible();
  }
  expect(headers).toEqual([status.recipient.id, status.recipient.id]);
});

test("failed storage writes and failed revocation stay closed despite storage events", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/ai/coach", route => {
    if (route.request().method() === "GET") return route.continue();
    calls++; return route.fulfill({ status: 500, json: { error: "UNEXPECTED_REQUEST" } });
  });
  await guest(page);
  await page.evaluate(key => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) {
    if (k === key) throw Error("synthetic-storage-denied"); return original.call(this, k, v); }; }, key);
  const agree = page.getByRole("button", { name: "同意并开启", exact: true });
  await agree.click(); await expect(page.getByText("无法在此浏览器保存你的选择，请检查存储权限。", { exact: true })).toBeVisible();
  await send(page, "你好"); expect(calls).toBe(0);
  await page.reload(); await agree.click(); // Reload removes only the test monkey patch.
  await page.getByRole("button", { name: "对话选项", exact: true }).click();
  await page.evaluate(key => { const original = Storage.prototype.removeItem; Storage.prototype.removeItem = function(k) {
    if (k === key) throw Error("synthetic-storage-denied"); return original.call(this, k); }; }, key);
  await page.getByRole("button", { name: "关闭自然对话", exact: true }).click();
  await page.evaluate(key => window.dispatchEvent(new StorageEvent("storage", { key })), key);
  await expect(agree).toBeVisible(); await send(page, "你好呀"); expect(calls).toBe(0);
});

test("failed plan revocation also blocks a newly mounted Agent consumer in the same tab", async ({ page }) => {
  let calls = 0;
  await page.route("**/api/ai/coach", route => {
    if (route.request().method() === "GET") return route.continue();
    calls++; return route.fulfill({ status: 500, json: { error: "UNEXPECTED_REQUEST" } });
  });
  await guest(page); await page.goto("/plan/ai");
  await page.getByRole("button", { name: "同意并开启", exact: true }).click();
  await page.evaluate(key => { const original = Storage.prototype.removeItem; Storage.prototype.removeItem = function(k) {
    if (k === key) throw Error("synthetic-storage-denied"); return original.call(this, k); }; }, key);
  await page.getByRole("button", { name: "关闭 AI 数据发送", exact: true }).click();
  await page.locator('a[href="/plan"]').first().click();
  await page.getByRole("navigation").getByRole("link", { name: "Agent", exact: true }).click();
  await expect(page.getByRole("button", { name: "同意并开启", exact: true })).toBeVisible();
  await send(page, "你好"); expect(calls).toBe(0);
});
