import { test } from "node:test";
import assert from "node:assert/strict";
import { groundPersonal, groundWorkout, reportedNumber, requestedReadRange } from "../src/lib/coach-grounding";
import { conversationHistory, coachRequestSchema } from "../src/lib/coach-model";
import type { Session } from "../src/lib/today";
const empty={dateQuote:null,weightQuote:null,waistQuote:null,foodQuote:null,mealQuote:null,caloriesQuote:null,proteinQuote:null};
const day="2026-10-14";
test("a date follow-up narrows the fresh read without narrowing comparisons",()=>{
  assert.deepEqual(requestedReadRange("那昨天呢？",day),{from:"2026-10-13",to:"2026-10-13"});
  assert.deepEqual(requestedReadRange("what about today?",day),{from:day,to:day});
  assert.equal(requestedReadRange("昨天到今天的变化",day),null);
});
test("model selects literal Chinese/Arabic spans; units and nulls are deterministic",()=>{
  assert.equal(reportedNumber("七十二点五"),72.5);assert.equal(reportedNumber("一百四十五"),145);assert.equal(reportedNumber("差不多七十"),null);
  const texts=["昨天早上秤了一下是一百四十五斤，帮我补上"];
  assert.deepEqual(groundPersonal({...empty,kind:"body",dateQuote:"昨天",weightQuote:"一百四十五斤"},texts,day),{kind:"body",date:"2026-10-13",weightKg:72.5,waistCm:null});
  assert.throws(()=>groundPersonal({...empty,kind:"body",weightQuote:"72.5公斤"},texts,day),/QUOTE_NOT/);
  assert.throws(()=>groundPersonal({...empty,kind:"body",weightQuote:"七十二"},["七十二"],day),/UNIT/);
});
test("meal prose preserves unknown nutrients and explicit zero",()=>{
  const p={...empty,kind:"food",foodQuote:"一碗牛肉面",mealQuote:"中午"};
  assert.deepEqual(groundPersonal(p,["中午吃了一碗牛肉面"],day),{kind:"food",date:day,foodName:"一碗牛肉面",mealType:"lunch",calories:null,protein:null});
  const zero=groundPersonal({...p,caloriesQuote:"0 kcal",proteinQuote:"零克"},["中午一碗牛肉面，标记 0 kcal，蛋白质零克"],day);
  assert.equal(zero.kind==="food"&&zero.calories,0);assert.equal(zero.kind==="food"&&zero.protein,0);
  assert.throws(()=>groundPersonal({...p,caloriesQuote:"600 kcal"},["中午吃了一碗牛肉面"],day),/QUOTE_NOT/);
});
test("goals, negatives, hypothetical reports and future dates do not create drafts",()=>{
  for(const text of ["目标体重七十公斤","假如体重七十公斤","不要记录体重七十公斤","明天体重七十公斤"])
    assert.throws(()=>groundPersonal({...empty,kind:"body",weightQuote:"七十公斤"},[text],day),/NOT_AN_ACTUAL/);
  assert.throws(()=>groundPersonal({...empty,kind:"body",dateQuote:"2026-10-15",weightQuote:"70kg"},["2026-10-15 体重70kg"],day),/DATE/);
});
test("follow-up quotes can only come from user text; they cannot be model guesses",()=>{
  const entry=groundPersonal({...empty,kind:"body",weightQuote:"七十二公斤",waistQuote:"八十厘米"},["体重七十二公斤","再加腰围八十厘米"],day);
  assert.equal(entry.kind==="body"&&entry.weightKg,72);assert.equal(entry.kind==="body"&&entry.waistCm,80);
  assert.throws(()=>groundPersonal({...empty,kind:"body",weightQuote:"65kg"},["我现在多少斤"],day),/QUOTE_NOT/);
});
test("workout oral numbers normalize through the same parser without plan targets",()=>{
  const s={id:"s",userId:"u",status:"active",prescription:{title:"t",exercises:[{id:"e",name:"深蹲",sets:3,repRange:"8-12",targetRpe:7}]},sets:[]} as unknown as Session;
  const p={exerciseId:"e",kind:"record",weightQuote:"五十公斤",repsQuotes:["八次"],rpeQuote:null,rpeScope:null,correctionSet:null};
  const r=groundWorkout(p,["刚才深蹲用的是五十公斤，做了八次"],s);
  assert.equal(r.draft.kind,"record");if(r.draft.kind==="record")assert.deepEqual(r.draft.sets.map(x=>[x.weightKg,x.reps,x.rpe]),[[50,8,null]]);
  assert.throws(()=>groundWorkout({...p,rpeQuote:"RPE 7"},["深蹲五十公斤八次"],s),/QUOTE_NOT/);
  assert.throws(()=>groundWorkout({...p,exerciseId:"other"},["深蹲五十公斤八次"],s),/EXERCISE_NOT_FOUND/);
});
test("conversation context is bounded; server rejects injected roles and missing consent",()=>{
  const history=conversationHistory(Array.from({length:40},()=>({text:"hello",reply:"data",lines:["world"]})));
  assert.equal(history.length,12);assert.ok(history.every(x=>x.role==="user"||x.role==="assistant"));
  assert.equal(coachRequestSchema.safeParse({id:"11111111-1111-4111-8111-111111111111",text:"hi",history:[],timezone:"UTC",locale:"zh"}).success,false);
});
