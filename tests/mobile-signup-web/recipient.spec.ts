import { test, expect } from "@playwright/test";

// Same synthetic Expo export as signup UI; no database, model, SMTP or native evidence.
for (const locale of ["zh-CN", "en"] as const) test(`${locale} recipient renewal never resends and offline history remains visible`, async ({ page }) => {
  const owner = "11111111-1111-4111-8111-111111111111", zh = locale === "zh-CN";
  const token = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ sub: owner, exp: 2200000000 })).toString("base64url")}.synthetic`;
  const session = { access_token: token, refresh_token: "synthetic-refresh", expires_at: 2200000000, expires_in: 3600, token_type: "bearer",
    user: { id: owner, email: "recipient-ui@local.test", aud: "authenticated" } };
  await page.addInitScript(({ session, locale, owner }) => {
    if (localStorage.getItem("recipient-seeded")) return;
    localStorage.setItem("sb-127-auth-token", JSON.stringify(session)); localStorage.setItem("liftcut-locale", locale);
    localStorage.setItem(`liftcut-coach-consent:${owner}`, "coach-model-v2"); localStorage.setItem("recipient-seeded", "1");
  }, { session, locale, owner });
  let id = "a".repeat(64), model = "fixture-one", posts = 0, refuse = false, offline = false;
  const headers = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, POST, OPTIONS" };
  await page.route("http://127.0.0.1:55438/**", route => route.fulfill({ status: 503, headers, json: {} }));
  await page.route("http://127.0.0.1:3109/**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    if (path === "/api/ai/coach" && req.method() === "GET") {
      expect(req.headers().authorization).toBeUndefined();
      return route.fulfill({ status: offline ? 503 : 200, headers, json: { available: true, recipient: { id, name: "DeepSeek", origin: "https://api.deepseek.com", model } } });
    }
    if (path === "/api/ai/coach" && req.method() === "POST") {
      posts++; expect(req.postDataJSON().recipient).toBe("a".repeat(64));
      if (refuse) { id = "b".repeat(64); model = "fixture-two"; return route.fulfill({ status: 409, headers, json: { error: "AI_CONSENT_REQUIRED" } }); }
      return route.fulfill({ headers: { ...headers, "content-type": "application/x-ndjson" }, body: JSON.stringify({ type: "result",
        result: { requestId: req.postDataJSON().id, message: "SYNTHETIC_HISTORY_RETAINED", sources: [], provider: "fixture", model } }) + "\n" });
    }
    return route.fulfill({ status: 503, headers, json: {} });
  });
  await page.goto("/coach");
  const enable = page.getByRole("button", { name: zh ? "同意并开启" : "Agree and turn on", exact: true });
  const send = page.getByRole("button", { name: zh ? "发送" : "Send", exact: true });
  await expect(page.getByTestId("ai-recipient")).toContainText("api.deepseek.com");
  expect(posts).toBe(0); await expect(send).toBeDisabled(); await enable.click();
  const input = page.getByLabel(zh ? "发给训练助手" : "Message the coach", { exact: true });
  await input.fill("hello synthetic"); await send.click();
  await expect(page.getByText("SYNTHETIC_HISTORY_RETAINED", { exact: true })).toBeVisible();
  refuse = true; await input.fill("explicit second request"); await send.click();
  await expect(page.getByTestId("ai-recipient")).toContainText("fixture-two"); await expect(send).toBeDisabled();
  await expect(page.getByText("SYNTHETIC_HISTORY_RETAINED", { exact: true })).toBeVisible(); expect(posts).toBe(2);
  await page.screenshot({ path: test.info().outputPath(`recipient-renewal-${locale}.png`), fullPage: true });
  await enable.click(); expect(posts).toBe(2); // Consent never replays a message or confirms a proposal.
  offline = true; await page.reload();
  await expect(page.getByText("SYNTHETIC_HISTORY_RETAINED", { exact: true })).toBeVisible();
  await expect(page.getByText(zh ? /暂时无法确认 AI 接收方/ : /The AI recipient cannot be verified/)).toBeVisible();
  await expect(send).toBeDisabled(); expect(posts).toBe(2);
});
