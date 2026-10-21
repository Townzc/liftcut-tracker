import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";

test("real local Auth + fresh Data API: onboarding, saved profile, permission outage and recovery", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  const url = process.env.API_GRANTS_SUPABASE_URL!, dbUrl = process.env.API_GRANTS_BROWSER_DATABASE_URL!;
  expect(["localhost", "127.0.0.1"]).toContain(new URL(dbUrl).hostname);
  expect(new URL(dbUrl).pathname).toMatch(/^\/liftcut_p1_grants_/);
  const client = createClient(url, process.env.API_GRANTS_ANON_KEY!, { auth: { persistSession: false } });
  const email = `grants-${randomUUID()}@example.com`, password = "LocalAcceptance2026!";
  const signup = await client.auth.signUp({ email, password });
  expect(signup.error).toBeNull(); expect(signup.data.session).not.toBeNull();
  const owner = signup.data.user!.id;
  const admin = new Pool({ connectionString: dbUrl });
  let revoked = false;
  try {
    // Actual GoTrue password login; no intercepted browser/API responses.
    await page.goto("/login");
    await page.locator("#email").fill(email); await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    const saved = await client.from("user_settings").upsert({ user_id: owner, gender: "male", age: 25,
      height: 175, current_weight: 75, target_weight: 70, weekly_training_days: 3 });
    expect(saved.error).toBeNull();
    await page.reload(); await expect(page).toHaveURL("http://localhost:3105/");
    await expect(page.getByTestId("minimal-home")).toBeVisible();
    await page.goto("/settings"); await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("settings-index")).toBeVisible();
    await page.reload(); await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("settings-index")).toBeVisible();
    await page.goto("/login"); await expect(page).toHaveURL("http://localhost:3105/");
    expect((await admin.query("select count(*)::int as n from user_settings where user_id=$1", [owner])).rows[0].n).toBe(1);

    // Only this disposable database loses a privilege. A real PostgREST 42501
    // must never be interpreted as an empty settings row by the page proxy.
    await admin.query("revoke select on public.user_settings from authenticated"); revoked = true;
    const unavailable = await page.goto("/settings");
    expect(unavailable!.status()).toBe(503); await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByText("请稍后重试，无需重新填写.")).toBeVisible();
    await page.screenshot({ path: "node_modules/.cache/api-grants/unavailable-mobile.png" });
    await admin.query("grant select on public.user_settings to authenticated"); revoked = false;
    await page.getByRole("link", { name: "重新加载" }).click(); await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByTestId("settings-index")).toBeVisible();
    await expect(page.getByText("请稍后重试，无需重新填写.")).toHaveCount(0);
    const row = await client.from("user_settings").select("current_weight,weekly_training_days").single();
    expect(row.error).toBeNull(); expect(row.data?.current_weight).toBe(75);
    await page.screenshot({ path: "node_modules/.cache/api-grants/recovered-mobile.png" });
    expect(browserErrors).toEqual([]);
  } finally {
    if (revoked) await admin.query("grant select on public.user_settings to authenticated");
    await client.auth.signOut(); await admin.end();
  }
});
