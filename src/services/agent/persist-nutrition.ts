import "server-only";
import type { PoolClient } from "pg";
import type { NutritionPlan } from "@/lib/agent/contracts";

// Only called within AgentStore.execute's approved transaction/savepoint.
export async function persistNutritionPlan(db: PoolClient, owner: string, id: string, plan: NutritionPlan) {
  const t = plan.daily_targets;
  await db.query("update public.nutrition_plans set is_active=false,updated_at=now() where user_id=$1 and is_active",[owner]);
  await db.query(`insert into public.nutrition_plans(id,user_id,name,goal_type,daily_calorie_target,protein_target,carb_target,fat_target,notes,is_active)
    values($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`,[id,owner,plan.plan_name,plan.goal_type,t.calories,t.protein_g,t.carbs_g,t.fat_g,
    [plan.summary,`Water target: ${t.water_ml} ml`,...plan.warnings].join("\n\n")]);
  const days=plan.days.map(d=>({id:`${id}-d${d.day_number}`,nutrition_plan_id:id,day_number:d.day_number,notes:d.notes}));
  const meals=plan.days.flatMap(d=>d.meals.map((m,i)=>({id:`${id}-d${d.day_number}-m${i+1}`,day_id:`${id}-d${d.day_number}`,
    meal_type:m.meal_type,title:m.title,foods_json:m.foods})));
  await db.query(`insert into public.nutrition_plan_days(id,nutrition_plan_id,day_number,notes) select * from jsonb_to_recordset($1::jsonb)
    as x(id text,nutrition_plan_id text,day_number integer,notes text)`,[JSON.stringify(days)]);
  await db.query(`insert into public.nutrition_plan_meals(id,day_id,meal_type,title,foods_json) select * from jsonb_to_recordset($1::jsonb)
    as x(id text,day_id text,meal_type text,title text,foods_json jsonb)`,[JSON.stringify(meals)]);
}
