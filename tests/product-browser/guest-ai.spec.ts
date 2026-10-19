import {test,expect,type Page} from "@playwright/test";
import {Pool} from "pg";
import {randomUUID} from "node:crypto";
const db=new Pool({connectionString:process.env.W1B_TEST_DATABASE_URL}),owner="11111111-1111-4111-8111-111111111111";
async function guest(page:Page){await page.goto("/login");await page.getByRole("button",{name:"以游客身份继续",exact:true}).click();await expect(page.getByTestId("current-plan-card")).toBeVisible();await page.getByRole("navigation").getByRole("link",{name:"Agent",exact:true}).click();await expect(page.locator("#coach-input")).toBeEnabled();}
async function send(page:Page,text:string){await page.locator("#coach-input").fill(text);await page.getByRole("button",{name:"发送",exact:true}).click();await expect(page.getByTestId("coach-turn").last()).toHaveAttribute("aria-busy","false",{timeout:25000});}
async function login(page:Page){await page.goto("/login");await page.locator("#email").fill("p1-fixture@example.invalid");await page.locator("#password").fill("p1-fixture-password");await page.getByRole("button",{name:"登录",exact:true}).click();await expect(page.getByTestId("current-plan-card")).toBeVisible();}
test.beforeEach(async()=>{await db.query("delete from coach_private.guest_ai_usage");await db.query("delete from coach_private.guest_imports where user_id=$1",[owner]);await db.query("delete from personal_record_events where user_id=$1",[owner]);await db.query("delete from coach_request_usage where user_id=$1",[owner]);});
test.afterAll(async()=>{await db.query("delete from coach_private.guest_ai_usage");await db.query("delete from coach_private.guest_imports where user_id=$1",[owner]);await db.query("delete from personal_record_events where user_id=$1",[owner]);await db.query("delete from coach_request_usage where user_id=$1",[owner]);await db.end();});

test("real guest API stream, confirmed local facts, login preview/import, new chat memory and confirmed undo",async({page})=>{
  test.setTimeout(90000);const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  await guest(page);
  await expect(page.getByTestId("coach-data-categories").getByRole("listitem")).toHaveCount(5); // Guests have no saved plans or settings to send.
  await page.getByRole("button",{name:"同意并开启",exact:true}).click();
  await expect(page.getByTestId("guest-quota")).toContainText("10/10");
  const streamed=page.waitForResponse(r=>new URL(r.url()).pathname==="/api/ai/coach"&&r.request().method()==="POST");
  await send(page,"你好 你能做些什么");expect((await streamed).headers()["content-type"]).toContain("application/x-ndjson");await expect(page.getByTestId("guest-quota")).toContainText("9/10");
  await expect(page.getByTestId("coach-turn").last()).not.toContainText("记录训练组前");
  const cookie=(await page.context().cookies()).find(c=>c.name==="liftcut_ai_guest")!;expect(cookie.httpOnly).toBe(true);
  await send(page,"记录 2026-08-16 体重 72.5 公斤");
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith("liftcut-guest-record-v1:")).length)).toBe(0);
  await page.getByRole("button",{name:"确认补录",exact:true}).click();await expect(page.getByTestId("coach-turn").last()).toContainText("保存在本机");
  await send(page,"我刚做了卧推，五十公斤，十次 [guest-exercise]");await expect(page.getByTestId("personal-draft")).toContainText("50 kg");
  await page.getByRole("button",{name:"确认补录",exact:true}).click();
  await send(page,"记住我的目标是增肌 [guest-preference]");await expect(page.getByTestId("personal-draft")).toContainText("增肌");await page.getByRole("button",{name:"确认补录",exact:true}).click();
  expect((await page.request.get("/api/personal-records")).status()).toBe(401);
  expect((await db.query("select id from personal_record_events where user_id=$1",[owner])).rowCount).toBe(0);
  await page.goto("/settings/memory");await expect(page.getByTestId("fitness-memory")).toContainText("72.5 kg");await expect(page.getByTestId("fitness-memory")).toContainText("50 kg");
  await page.reload();await expect(page.getByTestId("fitness-memory")).toContainText("增肌");
  await page.screenshot({path:"node_modules/.cache/guest-ai/memory-guest.png",fullPage:true});
  await login(page);await page.getByRole("button",{name:"核对待同步记录",exact:true}).click();await expect(page.getByTestId("guest-import-preview")).toContainText("3 条记录");
  expect((await db.query("select id from personal_record_events where user_id=$1",[owner])).rowCount).toBe(0);
  await page.screenshot({path:"node_modules/.cache/guest-ai/import-preview.png",fullPage:true});
  await page.getByRole("button",{name:"确认同步",exact:true}).click();await expect(page.getByTestId("guest-import")).toHaveCount(0);
  await expect.poll(async()=>(await db.query("select id from personal_record_events where user_id=$1",[owner])).rowCount).toBe(3);
  expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith("liftcut-guest-record-v1:")).length)).toBe(0);
  await page.goto("/agent");await page.getByRole("button",{name:"同意并开启",exact:true}).click();await send(page,"你记住了什么 [guest-memory]");
  await expect(page.getByTestId("coach-turn").last()).toContainText("72.5 kg");await expect(page.getByTestId("coach-turn").last()).toContainText("50 kg");await expect(page.getByTestId("coach-turn").last()).toContainText("增肌");
  await page.getByRole("button",{name:"新对话",exact:true}).click();await send(page,"你记住了什么 [guest-memory]");await expect(page.getByTestId("coach-turn").last()).toContainText("72.5 kg");
  await page.goto("/settings/memory");const goal=page.getByTestId("memory-fact").filter({hasText:"增肌"});await goal.getByRole("button",{name:"撤销",exact:true}).click();
  expect((await db.query("select id from personal_record_events where user_id=$1 and parent_id is not null",[owner])).rowCount).toBe(0);
  await goal.getByRole("button",{name:"确认撤销",exact:true}).click();await expect(goal).toHaveCount(0);
  await page.screenshot({path:"node_modules/.cache/guest-ai/memory-account.png",fullPage:true});
  expect(errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test("guest quota rejection persists after reload, forged identities fail and account endpoints stay private",async({page})=>{
  await guest(page);await page.getByRole("button",{name:"同意并开启",exact:true}).click();await expect(page.getByTestId("guest-quota")).toContainText("10/10");
  await send(page,"你好");const used=(await db.query("select guest_id,network_hash from coach_private.guest_ai_usage order by created_at desc limit 1")).rows[0];
  await db.query("insert into coach_private.guest_ai_usage(request_id,guest_id,network_hash,created_at) select gen_random_uuid(),$1,$2,now()-interval '2 minutes' from generate_series(1,9)",[used.guest_id,used.network_hash]);
  await page.reload();await expect(page.getByTestId("guest-quota")).toContainText("0/10");await send(page,"你能做什么呀");await expect(page.getByTestId("coach-turn").last()).toContainText("今日访客试用额度已用完");
  const body={id:randomUUID(),text:"hello",history:[],locale:"en",timezone:"UTC",consent:"coach-model-v1",guestRecords:[]};
  expect((await page.request.post("/api/ai/coach",{headers:{Origin:"http://localhost:3103","X-Workout-Owner":owner},data:body})).status()).toBe(409);
  for(const path of ["/api/personal-records","/api/coach-memory","/api/coach-history"]){const res=await page.request.get(path);expect([401,404]).toContain(res.status());}
  const old=(await page.context().cookies()).find(c=>c.name==="liftcut_ai_guest")!;
  await page.context().addCookies([{...old,value:old.value+"tampered"}]);
  expect((await page.request.post("/api/ai/coach",{headers:{Origin:"http://localhost:3103"},data:{...body,id:randomUUID()}})).status()).toBe(401);
  expect((await page.request.post("/api/guest-import",{headers:{Origin:"http://localhost:3103"},data:{}})).status()).toBe(401);
});
