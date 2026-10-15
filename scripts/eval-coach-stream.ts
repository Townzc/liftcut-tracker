/** Opt-in streaming evaluation against the configured real provider, local synthetic data only. */
import assert from "node:assert/strict";
import {loadEnvFile} from "node:process";
import {randomUUID} from "node:crypto";
import {mkdir,writeFile} from "node:fs/promises";
import {Pool} from "pg";
import {runCoach} from "../src/services/ai/coach-agent";
import {COACH_CONSENT_VERSION} from "../src/lib/coach-model";

async function main(){
  const url=process.env.W1B_TEST_DATABASE_URL;
  if(process.env.COACH_LIVE_EVAL!=="true"||!url||!["localhost","127.0.0.1"].includes(new URL(url).hostname)||!new URL(url).pathname.startsWith("/liftcut_p1_w1b_"))throw new Error("Opt-in local synthetic database required");
  loadEnvFile(".env.local");const runtime=new URL(url);runtime.username="liftcut_workout";runtime.password="w1b-local-fixture-only";process.env.WORKOUT_DATABASE_URL=runtime.toString();
  runtime.username="liftcut_agent";runtime.password="p1-local-fixture-only";process.env.AGENT_DATABASE_URL=runtime.toString();
  process.env.COACH_SIGNING_SECRET="local-stream-evaluation-only-not-production";
  const db=new Pool({connectionString:url}),owner=randomUUID(),observations:unknown[]=[];
  const directory=`node_modules/.cache/coach-stream-live/${new Date().toISOString().replace(/[:.]/g,"-")}`;await mkdir(directory,{recursive:true});
  try{
    await db.query("insert into auth.users values($1)",[owner]);
    await db.query("insert into user_settings(user_id,weekly_training_days,session_duration_minutes,available_equipment,fitness_goal,training_experience) values($1,2,45,'{哑铃,自重}','maintenance','beginner')",[owner]);
    for(const [kind,text] of [
      ["chat","用四句话介绍你能如何帮助我查记录、补录数据、制定训练和饮食计划，并说明修改如何确认。"],
      ["read","帮我核对最近一周的身体和饮食记录，有哪些已有的数据，哪些数值还不知道？"],
      ["body","刚才称到了七十二点五公斤，腰围没量，帮我记一下。"],
      ["plan","每周两天，每次45分钟，用哑铃和自重，每天只要两个动作。生成一周可重复的训练计划，先给我确认预览。"],
    ]){
      const started=Date.now(),chunks:{ms:number;length:number}[]=[];let length=0;
      const result=await runCoach(owner,{id:randomUUID(),text,history:[],locale:"zh",timezone:"America/Los_Angeles",consent:COACH_CONSENT_VERSION},AbortSignal.timeout(50000),undefined,event=>{
        if(event.type==="reset")length=0;
        if(event.type==="text"&&event.text){length+=event.text.length;chunks.push({ms:Date.now()-started,length});}
        assert.notEqual(event.type,"result"); // Only the route can publish a validated terminal result.
      });
      const totalMs=Date.now()-started;
      observations.push({kind,totalMs,firstTextMs:chunks[0]?.ms??null,chunks,result});await writeFile(`${directory}/observations.json`,JSON.stringify(observations,null,2));
      if(kind==="chat"||kind==="read"){
        assert.ok(chunks.length>1,`${kind}: expected real incremental text`);assert.ok(chunks[0].ms<totalMs);
        assert.equal(chunks.at(-1)?.length,result.message.length);assert.equal(result.proposal,undefined);
        if(kind==="read")assert.equal(result.sources.length,2);
      }else if(kind==="body")assert.equal(result.proposal?.kind,"personal");
      else assert.equal(result.proposal?.kind,"plan");
      assert.equal((await db.query("select count(*)::int n from training_plans where user_id=$1",[owner])).rows[0].n,0);
      assert.equal((await db.query("select count(*)::int n from personal_record_events where user_id=$1",[owner])).rows[0].n,0);
      console.log(JSON.stringify({kind,totalMs,firstTextMs:chunks[0]?.ms??null,chunks:chunks.length,proposal:result.proposal?.kind??null}));
    }
  }finally{
    await db.query("update agent_private.runs set current_proposal=null where user_id=$1",[owner]);
    for(const table of ["receipts","execution_keys","events","proposals","runs"])await db.query(`delete from agent_private.${table} where user_id=$1`,[owner]);
    await db.query("delete from auth.users where id=$1",[owner]);await db.end();
  }
  console.log(`Real provider results: ${directory}; synthetic user removed.`);
}
main().then(()=>process.exit(0)).catch(()=>{console.error("Real streaming evaluation failed; inspect local evidence. No credentials or raw provider error logged.");process.exit(1);});
