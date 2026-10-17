import {test} from "node:test";
import assert from "node:assert/strict";
import {recordPeriod} from "../src/lib/record-period";
import {coachIntent} from "../src/lib/coach-conversation";
import {localCoachReply,isCoachIntroduction} from "../src/lib/coach-local-chat";
import {initialRecordQuery} from "../src/lib/coach-query";
import {requestedReadRange} from "../src/lib/coach-grounding";
import {answerDataQuestion} from "../src/lib/agent-data";
import {conversationHistory} from "../src/lib/coach-model";
import {createEmptyTrainingPlan} from "../src/lib/demo-data";
import type {PersonalRecord} from "../src/lib/personal-records";

test("guest introductions and unknown chat never default to workout prerequisites",()=>{
  for(const text of ["你好 你能做些什么","你能做什么呀","你好，你可以帮我做什么？","Hello!","你能做什么"]){
    assert.equal(coachIntent(text,null).kind,"help",text);
    const reply=localCoachReply(text,false,false).join(" ");
    assert.match(reply,/访客.*本机数据模式/);assert.doesNotMatch(reply,/记录训练组前|先.*开始训练/);
  }
  for(const text of ["你好，看看我的体重","谢谢，保存吧","你能做什么，顺便帮我记录72公斤"])
    assert.equal(isCoachIntroduction(text),false,text);
  assert.doesNotMatch(localCoachReply("随便聊聊",false,false).join(" "),/先.*开始训练/);
  assert.match(localCoachReply("你记住我的数据吗",false,false).join(" "),/无痕浏览/);
});

test("historical points use calendar arithmetic and pin local and model queries equally",()=>{
  for(const [text,anchor,date] of [
    ["我2个月前的体重是多少","2026-10-16","2026-08-16"],
    ["我两个月前的体重是多少","2026-03-31","2026-01-31"],
    ["一个月前的体重是多少","2024-03-31","2024-02-29"],
    ["what was my weight two months ago?","2026-01-31","2025-11-30"],
    ["一年前体重多少","2025-02-28","2024-02-28"],
    ["查询2020-03-01的体重","2026-10-16","2020-03-01"],
  ]){
    assert.deepEqual(recordPeriod(text,anchor),{kind:"range",from:date,to:date});
    assert.deepEqual(requestedReadRange(text,anchor),{from:date,to:date});
    assert.deepEqual(initialRecordQuery(text,anchor),{topic:"body",alsoTopics:[],from:date,to:date});
  }
  for(const text of ["查2026-02-30的体重","查2026-12-01的体重","对比两个月前和今天体重","查上个月体重","查最近七天80公斤以上体重","查2026-08-16之前体重","查去年今天的体重"])
    assert.equal(recordPeriod(text,"2026-10-16").kind,"unsupported",text);
  assert.equal(initialRecordQuery("帮我记下两个月前体重72公斤","2026-10-16"),null);
});

test("saved dated facts survive more than six chat turns; no current or voided substitute for missing history",()=>{
  const now=new Date("2026-10-16T12:00:00"),snapshot={bodyMetricLogs:[],foodLogs:[],workoutLogs:[],trainingPlan:createEmptyTrainingPlan("owner")};
  const make=(date:string,weight:number|null,undo=false):PersonalRecord=>({id:date,entry:{kind:"body",date,weightKg:weight,waistCm:80},source:"manual",text:"",createdAt:now.toISOString(),undo:undo?{id:"undo",createdAt:now.toISOString()}:null});
  const records=[make("2026-08-16",72.5),make("2026-10-16",68),make("2026-07-16",81,true)];
  const turns=Array.from({length:8},(_,i)=>({text:i?"你好":"记下2026-08-16体重72.5公斤",lines:["历史回复"],reply:"data"}));
  assert.equal(conversationHistory(turns).length,12);
  assert.doesNotMatch(JSON.stringify(conversationHistory(turns)),/72\.5/);
  const answer=(text:string,rows=records)=>answerDataQuestion(text,snapshot,rows,null,false,now)!.lines.join(" ");
  assert.match(answer("我2个月前的体重是多少"),/2026-08-16.*72\.5 kg/);
  assert.doesNotMatch(answer("我2个月前的体重是多少"),/68 kg/);
  assert.match(answer("我3个月前体重多少"),/没有身体记录/);
  assert.doesNotMatch(answer("我3个月前体重多少"),/81 kg|68 kg|72\.5 kg/);
  assert.match(answer("我2个月前体重多少",[make("2026-08-16",null)]),/体重 — kg/);
  assert.doesNotMatch(answer("查上个月体重"),/68 kg|72\.5 kg/);
  assert.match(answer("我2个月前体重多少",[]),/没有身体记录/);
});
