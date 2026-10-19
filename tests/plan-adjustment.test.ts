import {test} from "node:test";
import assert from "node:assert/strict";
import {adjustPlan} from "../src/lib/agent/plan-adjustment";
import {planChanges} from "../src/lib/agent/plan-changes";
import {nutritionPlanSchema} from "@liftcut/core/agent-contracts";
import {trainingFixture,nutritionFixture} from "./fixtures/coach-plans";
test("small training changes preserve all unrequested prescriptions and original input",()=>{
  const expected=structuredClone(trainingFixture);expected.weeks[0].days[0].exercises[0].sets=2;expected.summary="仅改一项";
  const result=adjustPlan(trainingFixture,{summary:"仅改一项",changes:[{path:"/weeks/0/days/0/exercises/0/sets",value:2}]});
  assert.deepEqual(result,expected);assert.equal(trainingFixture.weeks[0].days[0].exercises[0].sets,3);
});
test("nutrition target changes preserve menu and reject arbitrary paths, wrong types and invalid bounds",()=>{
  const result=adjustPlan(nutritionFixture,{summary:"修改目标",changes:[{path:"/daily_targets/calories",value:2200}]});assert.deepEqual(result,{...nutritionFixture,summary:"修改目标",daily_targets:{...nutritionFixture.daily_targets,calories:2200}});
  for(const [path,value] of [["/__proto__/polluted","yes"],["/daily_targets/calories",800],["/daily_targets/calories","2200"],["/days/99/notes","x"],["/days/0/meals/0/foods",[]]] as const)
    assert.throws(()=>adjustPlan(nutritionFixture,{summary:"invalid",changes:[{path,value:value as string|number|string[]}]}));
  assert.throws(()=>adjustPlan(nutritionFixture,{summary:"duplicate",changes:[{path:"/daily_targets/calories",value:2200},{path:"/daily_targets/calories",value:2100}]}));
});
test("nutrition duplicate dates and meals cannot be published; before/after targets are explicit",()=>{
  assert.equal(nutritionPlanSchema.safeParse({...nutritionFixture,days:[...nutritionFixture.days,...nutritionFixture.days]}).success,false);
  const p=structuredClone(nutritionFixture);p.days[0].meals.push(p.days[0].meals[0]);assert.equal(nutritionPlanSchema.safeParse(p).success,false);
  const changes=planChanges([{daily_calorie_target:1800,protein_target:120,carb_target:245,fat_target:60,days:[]}],nutritionFixture);
  assert.ok(changes.some(x=>x.includes("1800 → 2000")));
});
