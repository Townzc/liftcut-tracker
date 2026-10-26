import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {groundWorkoutReview} from "../src/lib/workout-review-grounding";
import {referenceFor} from "@liftcut/core/workout-review";
import type {Session,SetLog} from "@liftcut/core/today";
const owner=randomUUID(),id=randomUUID(),row=randomUUID(),press=randomUUID();
const sets:SetLog[]=[1,2].map(n=>({id:randomUUID(),sessionId:id,planExerciseId:row,setIndex:n,revision:1,status:"done",weightKg:30+n*5,
  reps:9,rpe:6,weightSource:"user_entered",repsSource:"user_entered",inputUnit:"kg",sourceRef:"today-tap",exerciseName:"坐姿划船",updatedAt:"2026-10-22T00:00:00Z"}));
const s:Session={id,userId:owner,localDate:"2026-10-21",timezone:"UTC",trainingPlanId:randomUUID(),weekNumber:1,dayNumber:1,status:"active",revision:1,
  prescription:{title:"Synthetic",exercises:[{id:row,name:"坐姿划船",sets:2,repRange:"99",targetRpe:10},{id:press,name:"哑铃肩推",sets:3,repRange:"99",targetRpe:10}]},
  startedAt:"2026-10-21T00:00:00Z",endedAt:null,sets};
const group=(weightQuote:string|null,repsQuote:string|null,rpeQuote:string|null=null,countQuote:string|null=null)=>({weightQuote,repsQuote,rpeQuote,countQuote});
const make=(text:string,input:unknown,session=s,pendingText:string|null=null)=>groundWorkoutReview(input,text,session,
  {focus:referenceFor(sets[1]),pendingText},{id:randomUUID(),conversationId:randomUUID(),requestId:randomUUID(),newId:randomUUID});
test("live review: exact ordinal patches only that confirmed set; a load is never an ordinal",()=>{
  const input={kind:"correct",exerciseId:row,targetQuote:"第1组",groups:[group(null,"5次")]};
  const r=make("更正坐姿划船第1组，5次",input);
  assert.equal(r.requests[0].id,sets[0].id);assert.equal(r.requests[0].reps,5);assert.equal(r.requests[0].weightKg,35);
  assert.throws(()=>make("更正坐姿划船，35公斤，5次",{...input,targetQuote:"35公斤"}),/TARGET|ROLE/);
  assert.throws(()=>make("更正坐姿划船第1组，不是5次，是7次",input),/AMBIGUOUS_NUMERIC_SOURCE/);
});
test("live review: explicit inheritance uses that exercise's last confirmed load and creates an extra actual slot",()=>{
  const r=make("坐姿划船又做了6次，重量不变",{kind:"inherit_weight",exerciseId:row,targetQuote:null,groups:[group(null,"6次")]});
  assert.equal(r.requests[0].weightKg,40);assert.equal(r.requests[0].setIndex,3);assert.equal(r.requests[0].rpe,null);
  assert.equal(r.references[0].recordId,sets[1].id);
  const copied=make("坐姿划船又做了6次，重量不变",{kind:"record",exerciseId:row,targetQuote:null,groups:[group("999公斤","6次")]});
  assert.equal(copied.requests[0].weightKg,40); // model's copied/invented quote is not a value source
  assert.throws(()=>make("坐姿划船又做了6次",{kind:"inherit_weight",exerciseId:row,targetQuote:null,groups:[group(null,"6次")]}),/EXPLICIT_SAME/);
});
test("live review: pending statements cannot redirect a correction to an older confirmed focus",()=>{
  const p={kind:"correct",exerciseId:row,targetQuote:null,groups:[group(null,null,"RPE 7")]};
  assert.throws(()=>make("刚才那组更正为RPE 7",p,s,"另一组还没确定次数"),/CONFIRMED_FOCUS_REQUIRED/);
  const r=make("刚才那组更正为RPE 7",p);assert.equal(r.requests[0].id,sets[1].id);
});

test("explicit use of the previous load reads a confirmed row, never a copied model number",()=>{
  for(const phrase of ["沿用上组重量", "沿用上一组的重量", "使用刚才的重量"]){
    const r=make(`坐姿划船再做了7次，${phrase}`,{kind:"record",exerciseId:row,targetQuote:null,groups:[group("999公斤","7次")]});
    assert.equal(r.requests[0].weightKg,40);assert.equal(r.requests[0].weightSource,"user_confirmed_prefill");
    assert.equal(r.references[0].recordId,sets[1].id);assert.equal(r.requests[0].rpe,null);
  }
  assert.throws(()=>make("坐姿划船再做了7次",{kind:"inherit_weight",exerciseId:row,targetQuote:null,groups:[group(null,"7次")]}),/EXPLICIT_SAME/);
});
test("live review: void is compensation; redo never gets silently appended",()=>{
  const r=make("刚才那组不算，重新做了一组",{kind:"void",exerciseId:row,targetQuote:null,groups:[]});
  assert.equal(r.requests.length,1);assert.equal(r.requests[0].status,"voided");assert.equal(r.requests[0].weightKg,40);
  assert.equal(r.requests[0].sourceRef,sets[1].sourceRef);assert.equal(r.requests[0].revision,2);
});
test("live review: preserves per-hand unit without mixing it with total load; missing/uncertain quantities never become precise",()=>{
  const p={kind:"record",exerciseId:press,targetQuote:null,groups:[group("17磅","11次")]};
  const r=make("哑铃肩推，单边17磅，11次",p);assert.deepEqual(r.requests[0].perHandLoad,{value:17,unit:"lb"});
  assert.equal(r.requests[0].weightKg,null);assert.equal(r.requests[0].weightSource,null);
  assert.throws(()=>make("哑铃肩推，大概单边17磅，11次",p),/UNCERTAIN/);
  assert.throws(()=>make("哑铃肩推17，11次",p),/QUOTE_NOT/);
});
test("live review: skipped is never done; plan quantities and query do not fill actuals",()=>{
  const r=make("哑铃肩推没练，跳过",{kind:"skip",exerciseId:press,targetQuote:null,groups:[]});
  assert.equal(r.requests.length,3);assert.ok(r.requests.every(x=>x.status==="skipped"&&x.weightKg===null&&x.reps===null));
  assert.throws(()=>make("哑铃肩推是不是都完成了？",{kind:"skip",exerciseId:press,targetQuote:null,groups:[]}),/CLARIFICATION/);
});
test("numeric roles: polite phrases and anaphoric last rep are not extra repetition reports",()=>{
  const r=make("帮我记一下，坐姿划船又做了一组，重量不变，6次，最后一个有点吃力",{
    kind:"record",exerciseId:row,targetQuote:"重量不变",groups:[group("刚才那个重量","6次")].map(g=>({...g,weightQuote:null}))});
  assert.equal(r.requests.length,1);assert.equal(r.requests[0].reps,6);assert.equal(r.requests[0].weightKg,40);
  const hand=make("哑铃肩推左右各17磅，11次",{kind:"record",exerciseId:press,targetQuote:null,groups:[group("17磅","11次")]});
  assert.deepEqual(hand.requests[0].perHandLoad,{value:17,unit:"lb"});
  assert.throws(()=>make("哑铃肩推17磅左右，11次",{kind:"record",exerciseId:press,targetQuote:null,groups:[group("17磅","11次")]}),/UNCERTAIN/);
});
