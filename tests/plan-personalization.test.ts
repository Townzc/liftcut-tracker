import {test} from "node:test";
import assert from "node:assert/strict";
import {planPersonalization,planningMemoryContent,type PlanningMemory} from "../src/lib/agent/plan-personalization";
import type {MemoryFact} from "../src/lib/fitness-memory";
const fact=(metric:string,value:string|number,date="2026-08-17"):MemoryFact=>({id:metric,recordId:metric,metric,value,date,createdAt:date+"T12:00:00Z",unit:metric==="weight"?"kg":null,source:"conversation"});
const memory:PlanningMemory={version:1,kind:"training",anchorDate:"2026-10-17",timezone:"Asia/Shanghai",facts:[fact("preference:goal","增肌"),fact("preference:schedule","每周三次，每次45分钟"),fact("preference:equipment","仅哑铃"),fact("weight",72.5),fact("waist",80),{...fact("exercise:卧推",50),exerciseName:"卧推",reps:10,sets:null,rpe:null}],recentLoads:[],truncated:false};
test("confirmed planning facts take precedence without converting settings into measurements",()=>{
  const p=planPersonalization({fitness_goal:"fat_loss",current_weight:90,weekly_training_days:5,available_equipment:["杠铃"],injury_notes:"右肩不适",food_restrictions:"花生过敏"},memory);
  assert.deepEqual(p.goal,{source:"confirmed_memory",value:"增肌",date:"2026-08-17",settingsFallback:{fitness_goal:"fat_loss"}});
  assert.equal(p.schedule.value,"每周三次，每次45分钟");assert.equal(p.equipment.value,"仅哑铃");
  assert.equal(p.profileContext.weight.value,72.5);assert.equal(p.profileContext.weight.source,"confirmed_measurement");
  assert.equal(p.body[0].daysAgo,61);assert.equal(p.exerciseLoads[0].rpe,null);
  assert.equal(p.precautions.injuryNotes,"右肩不适");assert.equal(p.precautions.foodRestrictions,"花生过敏");
});
test("missing facts remain missing and zero settings do not become measurements",()=>{
  const p=planPersonalization({current_weight:0,age:0,calorie_target:0},{...memory,facts:[]});
  assert.equal(p.body.length,0);assert.equal(p.exerciseLoads.length,0);assert.equal(p.profileContext.age,null);
  assert.deepEqual(p.profileContext.weight,{source:"settings_not_dated_measurement",value:null});
  assert.equal(p.profileContext.calorieTarget,null);
});
test("freshness binding ignores the read day but includes actual values and restrictions",()=>{
  assert.deepEqual(planningMemoryContent(memory),planningMemoryContent({...memory,anchorDate:"2026-10-18"}));
  assert.notDeepEqual(planningMemoryContent(memory),planningMemoryContent({...memory,facts:[...memory.facts,fact("preference:injury","避免疼痛动作")]}));
});
