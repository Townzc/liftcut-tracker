import {test} from "node:test";
import assert from "node:assert/strict";
import {CoachExecution} from "../src/lib/coach-execution";
import {CoachTimer,spanWallMs} from "../src/lib/coach-timing";
import {initialRecordQuery} from "../src/lib/coach-query";

test("read groups overlap; a failed read still releases exclusive draft and later reads in order",async()=>{
  const gate=new CoachExecution(),seen:string[]=[];
  let release!:()=>void;const hold=new Promise<void>(r=>{release=r;});
  const a=gate.run(true,async()=>{seen.push("a-start");await hold;seen.push("a-end");});
  const b=gate.run(true,async()=>{seen.push("b-start");await hold;throw new Error("synthetic");});
  const bHandled=assert.rejects(b,/synthetic/);
  const draft=gate.run(false,async()=>{seen.push("draft");});
  const c=gate.run(true,async()=>{seen.push("c");});
  const finish=gate.run(false,async()=>{seen.push("finish");});
  await Promise.resolve();assert.deepEqual(seen,["a-start","b-start"]);assert.equal(gate.idle,false);
  release();await Promise.all([a,bHandled,draft,c,finish]);
  assert.deepEqual(seen,["a-start","b-start","a-end","draft","c","finish"]);assert.equal(gate.idle,true);
});

test("competing draft calls cannot both observe an empty proposal; abort remains effective after waiting",async()=>{
  const gate=new CoachExecution(),abort=new AbortController();let count=0;
  const prepare=()=>gate.run(false,async()=>{if(count)return;await Promise.resolve();count++;});
  await Promise.all([prepare(),prepare()]);assert.equal(count,1);
  const blocked=gate.run(false,async()=>{abort.abort();});
  await assert.rejects(gate.run(true,async()=>{abort.signal.throwIfAborted();}));await blocked;
});

test("explicit fresh read-ahead honors timezone anchor, Monday weeks and independent topics",()=>{
  assert.deepEqual(initialRecordQuery("帮我核对最近一周的身体和饮食记录，有哪些已有的数据，哪些数值还不知道？","2026-10-14"),
    {topic:"body",alsoTopics:["food"],from:"2026-10-08",to:"2026-10-14"});
  assert.deepEqual(initialRecordQuery("Show my weight and food records for yesterday","2026-01-01"),
    {topic:"body",alsoTopics:["food"],from:"2025-12-31",to:"2025-12-31"});
  assert.equal(initialRecordQuery("查看本周训练记录","2026-10-18")?.from,"2026-10-12");
  assert.equal(initialRecordQuery("查看本周训练记录","2026-10-19")?.from,"2026-10-19");
  assert.equal(initialRecordQuery("check body records for day before yesterday","2026-01-01")?.to,"2025-12-30");
});

test("ambiguous ranges, write intent, quoted prompts and follow-ups stay with the model",()=>{
  for(const text of ["今天称了72.5公斤，帮我记一下","查今天的身体记录，再保存72公斤","查今天和昨天身体记录","查最近7天与上周的身体记录",
    "查去年今天身体记录","查最近7天超过80公斤的身体记录","比较最近一周身体记录","不要查今天体重记录","怎么记录今天体重？",
    "查今天饮食计划","查最近一个月身体记录","昨天呢？","查全部身体记录","Show weight records before yesterday",
    "Check last week's food records",'解释“查看今天身体记录”的意思',"制定训练计划，参考今天训练记录","怎么查今天身体记录？","show tomorrow weight records and today weight records"]){
    assert.equal(initialRecordQuery(text,"2026-10-14"),null,text);
  }
});

test("timing uses one request clock, exposes no payloads and accounts for overlapping tools once",async()=>{
  let clock=100;const timer=new CoachTimer(()=>clock);
  await timer.measure("auth",async()=>{clock+=10;});
  await assert.rejects(timer.db("body.query",async()=>{clock+=20;throw new Error("private data must not enter timing");}));
  timer.firstText();clock+=5;timer.firstText();timer.tool("read_records",10);clock+=5;timer.tool("read_records",20);
  const value=timer.snapshot();assert.equal(value.authMs,10);assert.equal(value.firstTextMs,30);assert.equal(value.serverMs,40);
  assert.equal(value.toolWallMs,30);assert.equal(spanWallMs([]),0);
  assert.equal(JSON.stringify(value).includes("private"),false);assert.equal(value.database[0].durationMs,20);
});
