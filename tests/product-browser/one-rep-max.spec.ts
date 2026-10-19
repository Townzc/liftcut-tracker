import { test, expect } from "@playwright/test";

test("mobile history shows an estimated 1RM with its source set and refuses sets above 12 reps", async ({ page }) => {
  // Guest mode keeps the real app and storage without hosted services; the estimate itself is unit-tested.
  await page.context().addCookies([{ name: "liftcut_guest", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(() => {
    localStorage.setItem("liftcut-guest-mode", "true");
    localStorage.setItem("liftcut-ui", JSON.stringify({ state: { language: "zh-CN", theme: "light" }, version: 0 }));
  });
  await page.goto("/workout");
  const card = page.getByTestId("one-rep-max");
  await expect(card.getByText("还没有同时记录了重量和次数的已完成组。", { exact: true })).toBeVisible();
  const weights = page.getByLabel("实际重量（kg）", { exact: true }), reps = page.getByLabel("实际次数", { exact: true });
  const done = page.getByRole("checkbox", { name: "已完成", exact: true });
  await weights.nth(0).fill("60"); await reps.nth(0).fill("5"); await done.nth(0).click();
  await weights.nth(1).fill("20"); await reps.nth(1).fill("15"); await done.nth(1).click();
  // Unknown reps on a completed row is not a set the estimate may use.
  await weights.nth(2).fill("30"); await done.nth(2).click();
  await page.getByRole("button", { name: "保存训练记录", exact: true }).click();
  await expect(card.getByText("67.5 kg", { exact: true })).toBeVisible();
  await expect(card.getByText(/^依据 \d{4}-\d{2}-\d{2} · 60 kg × 5 次$/)).toBeVisible();
  await expect(card.getByText("不估算：没有 12 次以内的已确认组", { exact: true })).toBeVisible();
  await expect(card.getByTestId("one-rep-max-row")).toHaveCount(2);
  // Older-format guest logs say which exercises were completed, not how many sets: the calendar marks the day without inventing sets.
  const calendar = page.getByTestId("training-calendar");
  await expect(calendar.getByRole("status")).toHaveText("过去一年训练 1 天。 其中 1 天来自旧记录，组数未知。");
  await expect(calendar.getByRole("button", { name: /^\d{4}-\d{2}-\d{2} · 3 个动作已完成，组数未知$/ })).toHaveCount(1);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "node_modules/.cache/w1a/one-rep-max-mobile.png" });
});
