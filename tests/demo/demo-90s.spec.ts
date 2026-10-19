import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { relay, signIn, type Sent } from "../mobile-web/helpers";
// Synthetic account and data; the coach's answers come from the scripted model fixture, which the captions say.
const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL }), user = "11111111-1111-4111-8111-111111111111";
const out = "docs/product/evidence/demo-90s";
const clean = async () => {
  await db.query("delete from workout_sessions where user_id=$1 and training_plan_id like 'agent-%'", [user]);
  await db.query("update agent_private.runs set current_proposal=null where user_id=$1", [user]);
  for (const table of ["receipts", "execution_keys", "events", "proposals", "runs"]) await db.query(`delete from agent_private.${table} where user_id=$1`, [user]);
  await db.query("delete from training_plans where user_id=$1 and id like 'agent-%'", [user]);
  await db.query("delete from coach_request_usage where user_id=$1", [user]);
};
test.beforeAll(async () => { await clean(); await db.query("update public.training_plans set is_active=false where user_id=$1", [user]); });
test.afterAll(async () => { await clean(); await db.end(); });

/** Records the page through Chrome's screencast; `save` encodes the frames with their real timing into a WebM. */
async function record(page: Page) {
  const cdp = await page.context().newCDPSession(page), frames: { data: string; t: number }[] = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => { frames.push({ data, t: metadata.timestamp ?? Date.now() / 1000 }); void cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {}); });
  const start = () => cdp.send("Page.startScreencast", { format: "jpeg", quality: 80, maxWidth: 390, maxHeight: 844 });
  await start();
  page.on("load", () => void start().catch(() => {})); // A reload (the cold start) ends the screencast.
  return { save: async (file: string) => {
    await cdp.send("Page.stopScreencast");
    const dir = resolve("node_modules/.cache/demo/frames"); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    const list = frames.map((f, i) => { const name = join(dir, `${String(i).padStart(5, "0")}.jpg`); writeFileSync(name, Buffer.from(f.data, "base64"));
      return `file '${name}'\nduration ${Math.max(0.04, (frames[i + 1]?.t ?? f.t + 2) - f.t).toFixed(3)}`; });
    writeFileSync(join(dir, "list.txt"), `${list.join("\n")}\nfile '${join(dir, `${String(frames.length - 1).padStart(5, "0")}.jpg`)}'\n`);
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt"), "-vf",
      "scale=390:844:force_original_aspect_ratio=decrease,pad=390:844:(ow-iw)/2:(oh-ih)/2,fps=24,format=yuv420p", "-c:v", "libvpx-vp9", "-crf", "40", "-b:v", "0", "-row-mt", "1", file]);
  } };
}

/** A caption bar over the app; it is re-added after a reload. */
async function caption(page: Page, text: string, hold = 4500) {
  await page.evaluate(t => {
    let bar = document.getElementById("demo-caption");
    if (!bar) { bar = document.createElement("div"); bar.id = "demo-caption"; document.body.appendChild(bar); }
    Object.assign(bar.style, { position: "fixed", left: "8px", right: "8px", bottom: "8px", zIndex: "9999", padding: "10px 12px", borderRadius: "12px",
      background: "rgba(10,10,10,0.88)", color: "#fff", font: "600 14px/1.4 system-ui, sans-serif", pointerEvents: "none" });
    bar.textContent = t;
  }, text);
  await page.waitForTimeout(hold);
}

test("90-second demo: offline cold start, sync, one-sentence correction, review, next target", async ({ browser, page }) => {
  // Setup, not recorded: the plan comes from the web chat through the approval ledger.
  const web = await browser.newPage();
  await web.goto("http://localhost:3103/login"); await web.locator("#email").fill("p1-fixture@example.invalid"); await web.locator("#password").fill("p1-fixture-password");
  await web.getByRole("button", { name: "登录", exact: true }).click(); await web.waitForURL(/\/(?:onboarding)?$/);
  await web.getByRole("navigation").getByRole("link", { name: "Agent", exact: true }).click(); await web.getByRole("button", { name: "同意并开启", exact: true }).click();
  await web.getByLabel("发给训练助手", { exact: true }).fill("生成训练计划 [training-plan]"); await web.getByRole("button", { name: "发送", exact: true }).click();
  await web.getByRole("button", { name: "查看方案", exact: true }).click(); await web.getByRole("button", { name: "确认并应用", exact: true }).click();
  await expect(web.getByTestId("plan-receipt")).toBeVisible(); await web.close();

  const sent: Sent[] = [], net = { down: false };
  await relay(page, sent);
  await page.route(/^http:\/\/localhost:3103\/api\//, route => net.down ? route.abort("internetdisconnected") : route.fallback());
  await signIn(page);
  await page.getByRole("link", { name: "教练" }).click(); await page.getByRole("button", { name: "同意并开启" }).click(); await page.goBack();
  const recording = await record(page);
  await caption(page, "LiftCut 手机端 · 合成数据演示（教练回复来自脚本替身）", 6000);
  await page.getByRole("button", { name: "开始训练" }).click();
  const status = page.getByTestId("outbox-status"); await expect(status).toHaveText("已同步");
  const squat = (await db.query("select prescription from workout_sessions where user_id=$1 and status='active'", [user])).rows[0]
    .prescription.exercises.find((e: { name: string }) => e.name === "深蹲").id;
  const row = (n: number) => page.getByTestId(`set-${squat}-${n}`);

  await caption(page, "1 · 断网：照样记录，先存在手机里");
  net.down = true;
  for (const [n, reps] of [[1, "10"], [2, "9"], [3, "10"]] as const) {
    await row(n).getByLabel(`第 ${n} 组 重量 (kg)`).fill("60"); await row(n).getByLabel(`第 ${n} 组 次数`).fill(reps);
    await row(n).getByRole("button", { name: "完成" }).click(); await expect(row(n).getByText("已完成")).toBeVisible();
    await page.getByRole("button", { name: "结束休息" }).click().catch(() => {});
  }
  await expect(status).toContainText("待同步 3 条");
  await caption(page, "1 · 断网时关掉 App 再打开：三组都还在，等待同步", 1500);
  await page.reload(); await expect(status).toContainText("待同步 3 条");
  await caption(page, "1 · 断网时关掉 App 再打开：三组都还在，等待同步", 6000);

  await caption(page, "2 · 联网后按顺序补发，每组只保存一次", 3000);
  net.down = false; // Tap at once: the app also retries by itself every 5 seconds.
  await status.getByRole("button", { name: "立即同步" }).click(); await expect(status).toHaveText("已同步");
  await caption(page, "2 · 已同步", 3500);

  await caption(page, "3 · 一句话更正：第 2 组其实做了 10 次");
  const input = page.getByLabel("训练原话"); await input.scrollIntoViewIfNeeded();
  await input.fill("更正 深蹲 第 2 组 10 次"); await page.getByRole("button", { name: "解析并预览" }).click();
  await expect(page.getByTestId("sentence-preview")).toContainText("第 2 组次数：9 → 10"); await page.waitForTimeout(3500);
  await page.getByRole("button", { name: "确认保存这句话" }).click(); await expect(status).toHaveText("已同步");
  await caption(page, "3 · 更正是新的一条记录，原值保留、可撤销", 5000);

  await caption(page, "4 · 结束训练，请教练复盘（建议逐条由你决定）");
  await page.getByRole("button", { name: "结束训练" }).click(); await expect(status).toHaveText("已同步");
  const card = page.getByTestId("review-card"); await card.scrollIntoViewIfNeeded();
  await card.getByRole("button", { name: "复盘这次训练" }).click(); await expect(card.getByRole("checkbox")).toHaveCount(2);
  await caption(page, "4 · 两条建议各带依据；只接受“目标 RPE 提高 0.5”", 6000);
  await card.getByRole("checkbox").nth(0).click(); await card.getByRole("button", { name: "应用所选（1 项）" }).click();
  await expect(card.getByText("已应用到训练计划。")).toBeVisible();
  await caption(page, "4 · 经批准账本应用到计划，随时可以撤销", 6000);

  await caption(page, "5 · 下次训练：进阶引擎按实际完成的组算出目标和理由");
  await page.getByRole("button", { name: "开始另一次训练" }).click(); await page.getByRole("button", { name: "开始训练" }).click();
  await expect(status).toHaveText("已同步");
  const target = page.getByText(/^进阶目标 · /).first(); await expect(target).toContainText("62.5 kg"); // Three sets of 10 at 60 kg: add 2.5 kg.
  await target.evaluate(e => e.scrollIntoView({ block: "center" })); // Above the caption bar.
  await caption(page, "5 · 重量由代码计算，模型只决定结构和策略", 8000);
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: `${out}/next-target.png` });
  await recording.save(`${out}/demo-90s.webm`);
});
