import { test } from "node:test";
import assert from "node:assert/strict";
import { bodyExtractionSchema, foodExtractionSchema, groundPersonal, groundWorkout, reportedNumber, requestedReadRange } from "../src/lib/coach-grounding";
import { conversationHistory, coachRequestSchema } from "../src/lib/coach-model";
import type { Session } from "../src/lib/today";
const empty={dateQuote:null,weightQuote:null,waistQuote:null,foodQuote:null,mealQuote:null,caloriesQuote:null,proteinQuote:null};
const day="2026-10-14";
test("entry tools reject cross-topic fields and ground an explicit current measurement",()=>{
  const body={dateQuote:"现在",weightQuote:"七十三点一公斤",waistQuote:null};
  assert.equal(bodyExtractionSchema.safeParse({...body,foodQuote:"牛肉面"}).success,false);
  assert.equal(foodExtractionSchema.safeParse({dateQuote:null,foodQuote:"牛肉面",mealQuote:"午餐",caloriesQuote:null,proteinQuote:null,weightQuote:"73kg"}).success,false);
  assert.deepEqual(groundPersonal({...empty,...body,kind:"body"},["现在称到七十三点一公斤，腰围仍没量，帮我追加一条今天的数据"],day),{kind:"body",date:day,weightKg:73.1,waistCm:null});
});
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

test("a later confirmation cannot turn earlier targets into reported actuals",()=>{
  const p={...empty,kind:"body",weightQuote:"六十五公斤"};
  assert.throws(()=>groundPersonal(p,["我的目标是六十五公斤","把刚才的数记下来"],day),/QUOTE_NOT/);
  const actual=groundPersonal(p,["我的目标是六十五公斤","今天实际称了六十五公斤"],day);
  assert.equal(actual.kind==="body"&&actual.weightKg,65);
  const s={status:"active",prescription:{exercises:[{id:"e",name:"深蹲",sets:3,repRange:"8-12",targetRpe:7}]},sets:[]} as unknown as Session;
  assert.throws(()=>groundWorkout({exerciseId:"e",kind:"record",weightQuote:null,repsQuotes:["八次"],rpeQuote:null,rpeScope:null,correctionSet:null},["计划深蹲八次","把刚才的次数记上"],s),/QUOTE_NOT/);
});

test("a quoted numeric fragment cannot change the value actually reported",()=>{
  assert.throws(()=>groundPersonal({...empty,kind:"body",weightQuote:"70公斤"},["实际体重170公斤"],day),/QUOTE_NOT/);
  assert.throws(()=>groundPersonal({...empty,kind:"body",weightQuote:"七十公斤"},["一百七十公斤"],day),/QUOTE_NOT/);
  const s={status:"active",prescription:{exercises:[{id:"e",name:"深蹲",sets:3,repRange:"8-12",targetRpe:7}]},sets:[]} as unknown as Session;
  const p={exerciseId:"e",kind:"record",weightQuote:null,repsQuotes:["八次"],rpeQuote:null,rpeScope:null,correctionSet:null};
  assert.throws(()=>groundWorkout(p,["做了十八次"],s),/QUOTE_NOT/);
  assert.throws(()=>groundWorkout({...p,weightQuote:"0 kg",repsQuotes:["8次"]},["80 kg 做了8次"],s),/QUOTE_NOT/);
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
