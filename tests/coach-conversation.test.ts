import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { coachIntent } from "../src/lib/coach-conversation";
import type { Session } from "@liftcut/core/today";
const exercise = randomUUID();
const session = (): Session => ({id: randomUUID(), userId: randomUUID(), localDate: "2026-10-14", timezone: "America/Los_Angeles",
  trainingPlanId: randomUUID(), weekNumber: 1, dayNumber: 1, status: "active", revision: 1,
  startedAt: "2026-10-14T07:00:00Z", endedAt: null, sets: [],
  prescription: {title: "Synthetic", exercises: [{id: exercise, name: "杠铃卧推", sets: 4, repRange: "8-12", targetRpe: 7}]}});
test("read/help/undo intents are bounded and preserve input session", () => {
  const s = session(), before = structuredClone(s);
  for (const [text, kind] of [["今天练什么？", "plan"], ["SHOW PLAN!", "plan"], ["已完成多少", "progress"],
    ["撤销上一条", "receipts"], ["help", "help"], ["修改长期计划", "longTerm"]]) assert.equal(coachIntent(text,s).kind, kind);
  assert.deepEqual(s,before);
  assert.equal(coachIntent("undo",null).kind,"receipts");
  assert.equal(coachIntent("今天练什么",null).kind,"noSession");
  assert.equal(coachIntent("杠铃卧推 8 次",{...s,status:"ended"}).kind,"noSession");
  assert.equal(coachIntent(" ",s).kind,"invalid");assert.equal(coachIntent("a".repeat(401),s).kind,"invalid");
});
test("actuals keep nulls and targets never become actual values", () => {
  const s=session(), result=coachIntent("杠铃卧推 8 次",s);
  assert.equal(result.kind,"parse");if(result.kind!=="parse" || result.result.status!=="draft")throw Error("No draft");
  assert.deepEqual(result.result.draft,{kind:"record",exerciseId:exercise,explicit:false,sets:[{setIndex:1,weightKg:null,reportedWeight:null,inputUnit:null,reps:8,rpe:null}]});
  for(const text of ["计划杠铃卧推 50 kg 10 次","不要记录 杠铃卧推 8 次","杠铃卧推 50 kg 8 次？","delete all records"]){
    const r=coachIntent(text,s,exercise);assert.equal(r.kind,"parse");if(r.kind==="parse")assert.equal(r.result.status,"clarify");
  }
});
test("missing exercise requires selection and unknown replacement never falls back",()=>{
  const s=session();let r=coachIntent("8 次",s);assert.equal(r.kind,"parse");if(r.kind==="parse")assert.deepEqual(r.result,{status:"clarify",reason:"exercise_not_unique"});
  r=coachIntent("8 次",s,exercise);if(r.kind!=="parse")throw Error();assert.equal(r.result.status,"draft");
  assert.deepEqual(coachIntent("替换动作",s,exercise),{kind:"replace",exerciseId:exercise});
  assert.deepEqual(coachIntent("replace bench press",s),{kind:"replace",exerciseId:exercise});
  assert.deepEqual(coachIntent("替换不存在动作",s,exercise),{kind:"replace",exerciseId:undefined});
  s.prescription.exercises.push({...s.prescription.exercises[0],id:randomUUID()});
  assert.deepEqual(coachIntent("replace bench press",s,exercise),{kind:"replace",exerciseId:undefined});
});
