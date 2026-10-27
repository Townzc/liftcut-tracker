import { expect, type Page } from "@playwright/test";

export type Sent = { url: string; authorization?: string; cookie?: string };
// A native app has no CORS; the browser export does. Relay its cross-origin calls unchanged and add CORS headers.
export async function relay(page: Page, sent: Sent[]) {
  await page.route(/^http:\/\/(127\.0\.0\.1:55440|localhost:3103)\//, async route => {
    const request = route.request(), cors = { "access-control-allow-origin": "http://localhost:8099",
      "access-control-allow-methods": "GET,POST,DELETE,OPTIONS", "access-control-allow-headers": request.headers()["access-control-request-headers"] ?? "*" };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    if (request.method() === "GET" && new URL(request.url()).pathname === "/api/account/deletion") {
      expect(request.headers().authorization, request.url()).toBeUndefined();
      expect(request.headers().cookie, request.url()).toBeUndefined();
    } else if (request.url().includes("/api/")) sent.push({ url: request.url(), authorization: request.headers().authorization, cookie: request.headers().cookie });
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), ...cors } });
  });
}
export async function signIn(page: Page, screenshot?: string) {
  await page.goto("/");
  await expect(page.getByText("登录 LiftCut", { exact: true })).toBeVisible();
  await page.getByLabel("邮箱").fill("p1-fixture@example.invalid"); await page.getByLabel("密码").fill("p1-fixture-password");
  if (screenshot) await page.screenshot({ path: screenshot });
  await page.getByRole("button", { name: "登录" }).click();
}
export function expectBearerOnly(sent: Sent[]) {
  expect(sent.length).toBeGreaterThan(0);
  for (const r of sent) { expect(r.authorization, r.url).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/); expect(r.cookie, r.url).toBeUndefined(); }
}
