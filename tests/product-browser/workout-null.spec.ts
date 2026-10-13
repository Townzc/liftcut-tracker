import { test, expect } from "@playwright/test";

test("mobile guest form saves blanks, clearing a measurement survives blur and reload", async ({ page }) => {
  // Real app and localStorage. Hosted auth/database are covered separately, not mocked as E2E here.
  await page.context().addCookies([{ name: "liftcut_guest", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(() => {
    localStorage.setItem("liftcut-guest-mode", "true");
    localStorage.setItem("liftcut-ui", JSON.stringify({ state: { language: "zh-CN", theme: "light" }, version: 0 }));
  });
  await page.goto("/workout");
  const weight = page.getByLabel("实际重量（kg）", { exact: true }).first();
  const reps = page.getByLabel("实际次数", { exact: true }).first();
  const rpe = page.getByLabel("实际 RPE", { exact: true }).first();
  await expect(rpe).toHaveValue("");
  await expect(reps).toHaveValue("");
  await expect(weight).toHaveValue("");
  await expect(rpe).toHaveAttribute("placeholder", /目标.*未记录/);
  await reps.fill("8");
  await rpe.fill("9");
  await rpe.fill("");
  await rpe.press("Tab");
  await expect(rpe).toHaveValue("");
  await weight.evaluate(element => element.scrollIntoView({ block: "center" }));
  await page.screenshot({ path: "node_modules/.cache/w1a/form-blank-mobile.png" });
  await page.getByRole("button", { name: "保存训练记录", exact: true }).click();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("liftcut-tracker-ui-state")!).state.guestSnapshot.workoutLogs.length)).toBe(1);
  const actuals = () => page.evaluate(() => {
    const e = JSON.parse(localStorage.getItem("liftcut-tracker-ui-state")!).state.guestSnapshot.workoutLogs[0].exercises[0];
    return [e.actualWeight, e.actualReps, e.actualRpe];
  });
  expect(await actuals()).toEqual([null, 8, null]);
  await page.reload();
  await expect(weight).toHaveValue(""); await expect(reps).toHaveValue("8"); await expect(rpe).toHaveValue("");
  // Explicit zero must stay different from unknown, even after an edit.
  await weight.fill("0");
  await page.getByRole("button", { name: "保存训练记录", exact: true }).click();
  await expect.poll(actuals).toEqual([0, 8, null]);
  await page.reload();
  await expect(weight).toHaveValue("0");
  await page.getByRole("button", { name: /查看详情/ }).first().click();
  await expect(page.getByText("重量 0kg | 次数 8 | RPE —", { exact: true })).toBeVisible();
  await page.screenshot({ path: "node_modules/.cache/w1a/detail-null-mobile.png" });
});
