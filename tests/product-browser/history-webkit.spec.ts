import {test,expect,webkit,devices} from "@playwright/test";
import {Pool} from "pg";
test("iPhone-sized WebKit retains streaming reply, input and cloud history through tabs and reload",async()=>{
  const db=new Pool({connectionString:process.env.W1B_TEST_DATABASE_URL}),owner="11111111-1111-4111-8111-111111111111";
  await db.query("delete from coach_request_usage where user_id=$1",[owner]);
  const browser=await webkit.launch(),context=await browser.newContext({...devices["iPhone 13"],baseURL:"http://localhost:3103"}),page=await context.newPage();
  try{
    await page.goto("/login");await page.locator("#email").fill("p1-fixture@example.invalid");await page.locator("#password").fill("p1-fixture-password");
    await page.getByRole("button",{name:"登录",exact:true}).click();await page.waitForURL(/\/(?:onboarding)?$/);await page.goto("/agent");
    await page.getByRole("button",{name:"同意并开启",exact:true}).click();await page.locator("#coach-input").fill("你好 [stream-slow]");
    await page.getByRole("button",{name:"发送",exact:true}).click();await expect(page.getByTestId("coach-turn")).toContainText("可以自然");await expect(page.getByTestId("coach-turn")).toHaveAttribute("aria-busy","true");
    await page.getByRole("navigation").getByRole("link",{name:"设置",exact:true}).click();await expect(page.getByTestId("settings-index")).toBeVisible();
    await page.getByRole("navigation").getByRole("link",{name:"Agent",exact:true}).click();await expect(page.getByTestId("coach-turn")).toHaveAttribute("aria-busy","false");await expect(page.getByTestId("coach-sync-status")).toHaveText("对话已同步");
    await page.locator("#coach-input").fill("手机未发送草稿");await page.reload();await expect(page.locator("#coach-input")).toHaveValue("手机未发送草稿");await expect(page.getByTestId("coach-turn")).toHaveCount(1);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const send=await page.getByRole("button",{name:"发送",exact:true}).boundingBox(),nav=await page.getByRole("navigation").boundingBox();expect(send&&nav&&send.y+send.height<=nav.y).toBeTruthy();
    await page.screenshot({path:"node_modules/.cache/coach-history-release/iphone-webkit.png",fullPage:true});
  }finally{await context.close();await browser.close();await db.query("delete from coach_request_usage where user_id=$1",[owner]);await db.end();}
});
