import {z} from "zod";
import {isNutritionPlan,planSchema,nutritionPlanSchema,type AnyPlan} from "@liftcut/core/agent-contracts";
export const planAdjustmentSchema=z.object({summary:z.string().trim().min(1).max(1000),changes:z.array(z.object({
  path:z.string().max(180),value:z.union([z.string().max(1000),z.number().finite(),z.array(z.string().max(120)).max(12)]),
}).strict()).min(1).max(20)}).strict();
export function adjustPlan(original:AnyPlan,input:z.infer<typeof planAdjustmentSchema>):AnyPlan{
  const plan=structuredClone(original),seen=new Set<string>();
  const training=/^\/weeks\/\d+\/days\/\d+\/(?:title|notes|estimated_duration_minutes|exercises\/\d+\/(?:name|sets|rep_range|target_rpe|rest_seconds|notes|alternative_exercises))$/;
  const nutrition=/^\/(?:daily_targets\/(?:calories|protein_g|carbs_g|fat_g|water_ml)|days\/\d+\/(?:notes|meals\/\d+\/(?:title|foods\/\d+\/(?:name|amount|estimated_calories|estimated_protein_g|notes|alternatives))))$/;
  for(const change of input.changes){
    if(seen.has(change.path)||!(change.path==="/plan_name"||(isNutritionPlan(plan)?nutrition:training).test(change.path)))throw new Error("INVALID_PLAN_PATH");
    seen.add(change.path);const parts=change.path.slice(1).split("/");let cursor:unknown=plan;
    for(const part of parts.slice(0,-1)){
      if(!cursor||typeof cursor!=="object"||!Object.hasOwn(cursor,part))throw new Error("PLAN_TARGET_NOT_FOUND");
      cursor=(cursor as Record<string,unknown>)[part];
    }
    const key=parts.at(-1)!;
    if(!cursor||typeof cursor!=="object"||!Object.hasOwn(cursor,key))throw new Error("PLAN_TARGET_NOT_FOUND");
    const row=cursor as Record<string,unknown>;
    if(typeof row[key]!==typeof change.value||Array.isArray(row[key])!==Array.isArray(change.value))throw new Error("PLAN_VALUE_TYPE");
    row[key]=change.value;
  }
  plan.summary=input.summary;
  return isNutritionPlan(plan)?nutritionPlanSchema.parse(plan):planSchema.parse(plan);
}
