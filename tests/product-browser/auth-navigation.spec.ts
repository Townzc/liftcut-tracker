import { test, expect, type Page } from "@playwright/test";

async function visitHomeAnonymously(page: Page, entry = "/login") {
  await page.goto(entry);
  // An actual attempted protected navigation also populates the router's cache.
  await page.getByRole("link", { name: "liftcut.", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?redirectedFrom=%2F$/);
}

async function verifyTabSwitches(page: Page) {
  await expect(page).toHaveURL("http://localhost:3103/");
  await expect(page.getByTestId("current-plan-card")).toBeVisible();
  const navigations: string[] = [];
  page.on("framenavigated", frame => {
    if (frame === page.mainFrame()) navigations.push(new URL(frame.url()).pathname);
  });
  for (const [name, path] of [["Agent", "/agent"], ["首页", "/"], ["设置", "/settings"], ["首页", "/"], ["Agent", "/agent"], ["首页", "/"]]) {
    await page.getByRole("navigation").getByRole("link", { name, exact: true }).click();
    await expect(page).toHaveURL("http://localhost:3103" + path);
    await expect(page.getByRole("navigation").getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
    if (path === "/") await expect(page.getByTestId("current-plan-card")).toBeVisible();
  }
  expect(navigations).not.toContain("/login");
  await page.reload();
  await expect(page.getByTestId("current-plan-card")).toBeVisible();
}

test("sign-in discards anonymous redirects before repeated Home, Agent and Settings navigation", async ({ page }) => {
  await visitHomeAnonymously(page);
  await page.locator("#email").fill("p1-fixture@example.invalid");
  await page.locator("#password").fill("p1-fixture-password");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await verifyTabSwitches(page);
});

for (const entry of ["/login", "/register"]) {
  test(`guest entry from ${entry} discards anonymous redirects and survives reload`, async ({ page }) => {
    await visitHomeAnonymously(page);
    if (entry === "/register") await page.getByRole("link", { name: "还没有账号？去注册", exact: true }).click();
    await page.getByRole("button", { name: "以游客身份继续", exact: true }).click();
    await verifyTabSwitches(page);
    await expect(page.getByText("访客模式 · 数据保存在本机", { exact: false })).toBeVisible();
  });
}
