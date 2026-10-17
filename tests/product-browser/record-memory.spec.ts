import {test,expect,type Page} from "@playwright/test";
import {Pool} from "pg";
import {recordPeriod} from "../../src/lib/record-period";
const db=new Pool({connectionString:process.env.W1B_TEST_DATABASE_URL});
const owner="11111111-1111-4111-8111-111111111111";
const dateInLA=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Los_Angeles",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const historical=()=>{const p=recordPeriod("两个月前",dateInLA());if(p.kind!=="range")throw Error("date");return p.from;};
async function send(page:Page,text:string){await page.locator("#coach-input").fill(text);await page.getByRole("button",{name:"发送",exact:true}).click();await expect(page.getByTestId("coach-turn").last()).toHaveAttribute("aria-busy","false");}
async function guest(page:Page){await page.goto("/login");await page.getByRole("button",{name:"以游客身份继续",exact:true}).click();await expect(page.getByTestId("current-plan-card")).toBeVisible();await page.getByRole("navigation").getByRole("link",{name:"Agent",exact:true}).click();await expect(page.locator("#coach-input")).toBeEnabled();}
test.afterAll(async()=>{await db.end();});

test("guest screenshot prompts receive useful local replies, with honest mode and no disabled write preview",async({page})=>{
  const writes:string[]=[],errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  page.on("request",r=>{if(r.method()==="POST"&&new URL(r.url()).pathname.startsWith("/api/"))writes.push(r.url());});
  await guest(page);
  for(const input of ["你好 你能做些什么","你能做什么呀"]){await send(page,input);const turn=page.getByTestId("coach-turn").last();await expect(turn).toContainText("访客当前使用本机数据模式");await expect(turn).not.toContainText("记录训练组前");}
  await send(page,"记下体重 72.5 公斤");await expect(page.getByTestId("coach-turn").last()).toContainText("尚未保存");await expect(page.getByRole("button",{name:"确认补录",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"记忆范围",exact:true}).click();await expect(page.getByTestId("coach-memory-scope")).toContainText("无痕浏览结束");
  await expect(page.getByTestId("coach-memory-scope")).toContainText("不是数据保存期限");
  expect(writes).toEqual([]);expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:"node_modules/.cache/guest-memory/guest-mode.png",fullPage:true,animations:"disabled"});
});

test("guest reads persisted historical facts after eight turns and reload, without substituting current weight",async({page})=>{
  await guest(page);const past=historical();
  await page.evaluate(({past,today})=>{
    const key="liftcut-tracker-ui-state",saved=JSON.parse(localStorage.getItem(key)!);
    saved.state.guestSnapshot.bodyMetricLogs=[{id:"synthetic-old-weight",userId:"guest-local",date:past,weight:72.5,waist:null,notes:"Synthetic fixture",createdAt:past+"T12:00:00Z"},
      {id:"synthetic-current-weight",userId:"guest-local",date:today,weight:68,waist:null,notes:"Synthetic fixture",createdAt:today+"T12:00:00Z"}];
    localStorage.setItem(key,JSON.stringify(saved));
  },{past,today:dateInLA()});
  await page.reload();await expect(page.locator("#coach-input")).toBeEnabled();
  for(let i=0;i<8;i++)await send(page,"你好");
  await send(page,"我2个月前的体重是多少");await expect(page.getByTestId("coach-turn").last()).toContainText(past);await expect(page.getByTestId("coach-turn").last()).toContainText("72.5 kg");await expect(page.getByTestId("coach-turn").last()).not.toContainText("68 kg");
  await page.reload();await expect(page.locator("#coach-input")).toBeEnabled();await send(page,"我两个月前的体重是多少");await expect(page.getByTestId("coach-turn").last()).toContainText("72.5 kg");
  await send(page,"我3个月前的体重是多少");await expect(page.getByTestId("coach-turn").last()).toContainText("没有身体记录");await expect(page.getByTestId("coach-turn").last()).not.toContainText("72.5 kg");
  await send(page,"查上个月的体重");await expect(page.getByTestId("coach-turn").last()).toContainText("没有用最近的数据代替");
  await page.screenshot({path:"node_modules/.cache/guest-memory/guest-historical.png",fullPage:true,animations:"disabled"});
});

test("confirmed account measurement survives chat truncation, reload and new conversation through fresh model reads",async({page})=>{
  test.setTimeout(90000);const past=historical(),text=`记录 ${past} 体重 77.25 公斤`;
  await db.query("delete from coach_request_usage where user_id=$1",[owner]);
  await db.query("delete from personal_record_events where user_id=$1 and request->>'text'=$2",[owner,text]);
  try{
    await page.goto("/login");await page.locator("#email").fill("p1-fixture@example.invalid");await page.locator("#password").fill("p1-fixture-password");await page.getByRole("button",{name:"登录",exact:true}).click();await expect(page.getByTestId("current-plan-card")).toBeVisible();await page.goto("/agent");await expect(page.locator("#coach-input")).toBeEnabled();
    await send(page,text);await expect(page.getByRole("button",{name:"确认补录",exact:true})).toBeVisible();
    expect((await db.query("select id from personal_record_events where user_id=$1 and request->>'text'=$2",[owner,text])).rowCount).toBe(0);
    await page.getByRole("button",{name:"确认补录",exact:true}).click();
    await expect.poll(async()=>(await db.query("select id from personal_record_events where user_id=$1 and request->>'text'=$2",[owner,text])).rowCount).toBe(1);
    for(let i=0;i<8;i++)await send(page,"你好 你能做些什么");
    await page.getByRole("button",{name:"同意并开启",exact:true}).click();
    const req=page.waitForRequest(r=>new URL(r.url()).pathname==="/api/ai/coach"&&r.method()==="POST");
    await send(page,"我两个月前的体重是多少");const history=(await req).postDataJSON().history;
    expect(history).toHaveLength(12);expect(JSON.stringify(history)).not.toContain("77.25");
    await expect(page.getByTestId("coach-turn").last()).toContainText("77.25 kg");
    await expect(page.getByTestId("coach-sync-status")).toHaveText("对话已同步");
    await page.reload();await expect(page.locator("#coach-input")).toBeEnabled();
    await page.getByRole("button",{name:"新对话",exact:true}).click();
    const fresh=page.waitForRequest(r=>new URL(r.url()).pathname==="/api/ai/coach"&&r.method()==="POST");
    await send(page,"我2个月前的体重是多少");expect((await fresh).postDataJSON().history).toEqual([]);await expect(page.getByTestId("coach-turn").last()).toContainText("77.25 kg");
    const source=page.getByTestId("coach-turn").last().locator("summary");await source.click();await expect(page.getByTestId("coach-turn").last()).toContainText(past);
    await page.screenshot({path:"node_modules/.cache/guest-memory/account-historical.png",fullPage:true,animations:"disabled"});
    expect((await db.query("select id from personal_record_events where user_id=$1 and request->>'text'=$2",[owner,text])).rowCount).toBe(1);
  }finally{await db.query("delete from personal_record_events where user_id=$1 and request->>'text'=$2",[owner,text]);await db.query("delete from coach_request_usage where user_id=$1",[owner]);}
});
