import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePersonalEntry, personalEntrySchema } from "../src/lib/personal-records";
import { answerDataQuestion } from "../src/lib/agent-data";
import { createEmptyTrainingPlan } from "../src/lib/demo-data";

test("body and food drafts preserve unknowns; units, dates and full sentence are explicit",()=>{
  assert.deepEqual(parsePersonalEntry("记下体重 72.5 公斤","2026-10-14"),{kind:"body",date:"2026-10-14",weightKg:72.5,waistCm:null});
  assert.deepEqual(parsePersonalEntry("log yesterday weight 72 kg, waist 80 cm","2026-01-01"),{kind:"body",date:"2025-12-31",weightKg:72,waistCm:80});
  assert.deepEqual(parsePersonalEntry("2026-10-12 腰围 80 厘米","2026-10-14"),{kind:"body",date:"2026-10-12",weightKg:null,waistCm:80});
  assert.deepEqual(parsePersonalEntry("记录午餐 鸡肉饭 600 千卡 蛋白质 35 克","2026-10-14"),{kind:"food",date:"2026-10-14",foodName:"鸡肉饭",mealType:"lunch",calories:600,protein:35});
  assert.deepEqual(parsePersonalEntry("log lunch rice","2026-10-14"),{kind:"food",date:"2026-10-14",foodName:"rice",mealType:"lunch",calories:null,protein:null});
  assert.equal(parsePersonalEntry("午餐 无糖茶 0 kcal","2026-10-14")?.kind,"food");
  assert.equal(personalEntrySchema.safeParse({kind:"body",date:"2026-02-30",weightKg:72,waistCm:null}).success,false);
});
test("unsafe, partial, ambiguous, hypothetical and unreported measurements never become drafts",()=>{
  for(const text of ["不要记录体重72公斤","计划体重72公斤","体重72公斤？","体重72","weight -70 kg","weight 70 lb","体重 0 kg","体重 700 kg",
    "体重72公斤，明天跑步","体重72公斤 腰围未知","午餐 鸡肉饭 600","午餐 鸡肉饭 600 kcal unknown 5","午餐 鸡肉饭 -100 kcal","tomorrow weight 70 kg",
    "if weight 70 kg","2026-02-30 体重72公斤","早餐 2 eggs","午餐 鸡肉饭 蛋白质10000克","午餐吃了什么","lunch what did I eat"]) assert.equal(parsePersonalEntry(text,"2026-10-14"),null,text);
});
test("cross-domain queries need no workout, exclude voids, distinguish missing food from zero and never write",()=>{
  const snapshot={bodyMetricLogs:[],foodLogs:[],workoutLogs:[],trainingPlan:createEmptyTrainingPlan("test")},before=structuredClone(snapshot);
  assert.match(answerDataQuestion("最近体重",snapshot,[],null,false)!.lines.join(" "),/还没有身体记录/);
  assert.match(answerDataQuestion("今天吃了什么",snapshot,[],null,false)!.lines.join(" "),/不代表当天没有进食/);
  assert.equal(answerDataQuestion("记下体重72公斤",snapshot,[],null,false),null);
  assert.match(answerDataQuestion("目标体重多少",snapshot,[],null,false)!.lines.join(" "),/目标与实际记录分开保存/);
  assert.match(answerDataQuestion("what is my protein target",snapshot,[],null,true)!.lines.join(" "),/configured targets/);
  const now=new Date("2026-10-14T12:00:00"),record={id:"r",entry:{kind:"food" as const,date:"2026-10-14",foodName:"rice",mealType:"lunch" as const,calories:null,protein:10},source:"manual" as const,text:"",createdAt:now.toISOString(),undo:null};
  const lines=answerDataQuestion("今天吃了什么",snapshot,[record],null,false,now)!.lines.join(" ");
  assert.match(lines,/— kcal/);assert.match(lines,/不能代表全天摄入/);assert.doesNotMatch(lines,/0 kcal/);
  assert.match(answerDataQuestion("今天吃了什么",snapshot,[{...record,undo:{id:"u",createdAt:now.toISOString()}}],null,false,now)!.lines.join(" "),/暂无饮食记录/);
  assert.deepEqual(snapshot,before);
});
