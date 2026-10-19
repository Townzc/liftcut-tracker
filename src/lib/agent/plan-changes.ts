import {isNutritionPlan,type AnyPlan} from "@liftcut/core/agent-contracts";
type Row=Record<string,unknown>;
const rows=(value:unknown):Row[]=>Array.isArray(value)?value.filter((v):v is Row=>!!v&&typeof v==="object"):[];
export function planChanges(baseline:Row[],plan:AnyPlan,en=false):string[]{
  if(!baseline.length)return [];
  const before=new Map<string,string>(),after=new Map<string,string>();
  const day=(w:unknown,d:unknown)=>en?`Week ${w}, day ${d}`:`第 ${w} 周第 ${d} 天`;
  if(!isNutritionPlan(plan)){
    for(const p of baseline)for(const w of rows(p.weeks))for(const d of rows(w.days))for(const e of rows(d.exercises))
      before.set(`${day(w.week_number,d.day_number)} · ${e.name}`,`${e.sets} × ${e.rep_range} · RPE ${e.target_rpe}`);
    for(const w of plan.weeks)for(const d of w.days)for(const e of d.exercises)
      after.set(`${day(w.week_number,d.day_number)} · ${e.name}`,`${e.sets} × ${e.rep_range} · RPE ${e.target_rpe}`);
  }else{
    for(const [key,field,label] of [["calories","daily_calorie_target",en?"Calories (kcal)":"热量 (kcal)"],["protein_g","protein_target",en?"Protein (g)":"蛋白质 (g)"],["carbs_g","carb_target",en?"Carbs (g)":"碳水 (g)"],["fat_g","fat_target",en?"Fat (g)":"脂肪 (g)"]] as const){
      before.set(label,String(baseline[0][field]));after.set(label,String(plan.daily_targets[key]));
    }
    const key=(d:unknown,m:unknown)=>`${en?"Day":"第"} ${d} ${en?"":"天"} · ${m}`;
    for(const p of baseline)for(const d of rows(p.days))for(const m of rows(d.meals))
      before.set(key(d.day_number,m.meal_type),rows(m.foods_json).map(f=>`${f.name} ${f.amount}`).join("、"));
    for(const d of plan.days)for(const m of d.meals)
      after.set(key(d.day_number,m.meal_type),m.foods.map(f=>`${f.name} ${f.amount}`).join("、"));
  }
  return [...new Set([...before.keys(),...after.keys()])].filter(k=>before.get(k)!==after.get(k)).map(k=>`${k}：${before.get(k)??(en?"none":"无")} → ${after.get(k)??(en?"removed":"移除")}`);
}
