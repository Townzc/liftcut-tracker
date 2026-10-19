"use client";
import { isNutritionPlan, type AnyPlan } from "@liftcut/core/agent-contracts";

export function PlanPreview({plan,en=false}:{plan:AnyPlan;en?:boolean}) {
  const meals:Record<string,string>={breakfast:"早餐",lunch:"午餐",dinner:"晚餐",snack:"加餐"};
  return <div className="space-y-3 text-sm leading-6" data-testid="plan-preview">
    <h3 className="text-base font-medium">{plan.plan_name}</h3><p className="whitespace-pre-wrap">{plan.summary}</p>
    {plan.warnings.map((w,i)=><p className="text-muted-foreground" key={i}>{w}</p>)}
    {isNutritionPlan(plan)?<>
      <p>{en?"Daily proposed targets":"每日建议目标"} · {plan.daily_targets.calories} kcal · {en?"Protein":"蛋白质"} {plan.daily_targets.protein_g} g · {en?"Carbs":"碳水"} {plan.daily_targets.carbs_g} g · {en?"Fat":"脂肪"} {plan.daily_targets.fat_g} g · {en?"Water":"饮水"} {plan.daily_targets.water_ml} ml</p>
      <p className="text-xs text-muted-foreground">{en?"Menu nutrients are estimates; these are not food intake records.":"菜单营养为估算值，计划不会记成实际饮食。"}</p>
      {plan.days.map((d,i)=><details key={d.day_number} open={i===0} className="rounded-xl border p-3"><summary className="cursor-pointer font-medium">{en?"Day":"第"} {d.day_number} {en?"":"天"}</summary>
        {d.notes&&<p className="mt-2">{d.notes}</p>}{d.meals.map(m=><section key={m.meal_type} className="mt-3"><h4 className="font-medium">{en?m.meal_type:meals[m.meal_type]} · {m.title}</h4>
          <ul className="space-y-2">{m.foods.map((f,j)=><li key={j}>{f.name} · {f.amount} · ≈ {f.estimated_calories} kcal / {en?"protein":"蛋白质"} {f.estimated_protein_g} g
            {f.notes&&<p className="text-muted-foreground">{f.notes}</p>}{f.alternatives.length>0&&<p className="text-muted-foreground">{en?"Alternatives":"可替换为"}：{f.alternatives.join("、")}</p>}</li>)}</ul>
        </section>)}</details>)}
    </>:<>
      {plan.reasoning_summary&&<p className="text-muted-foreground">{plan.reasoning_summary}</p>}
      {plan.weeks.map(w=><section key={w.week_number} className="space-y-2"><p className="font-medium">{en?"Week":"第"} {w.week_number} {en?"":"周"} · {w.focus}</p>
        {w.days.map((d,i)=><details key={d.day_number} open={i===0} className="rounded-xl border p-3"><summary className="cursor-pointer font-medium">{en?"Day":"第"} {d.day_number} {en?"":"天"} · {d.title} · {d.estimated_duration_minutes} {en?"min":"分钟"}</summary>
          {d.notes&&<p className="mt-2">{d.notes}</p>}<ul className="mt-3 space-y-3">{d.exercises.map((e,j)=><li key={j}><p>{e.name} · {e.sets} {en?"sets":"组"} × {e.rep_range} · RPE {e.target_rpe} · {en?"rest":"休息"} {e.rest_seconds}s</p>
            {e.notes&&<p className="text-muted-foreground">{e.notes}</p>}{e.alternative_exercises.length>0&&<p className="text-muted-foreground">{en?"Alternatives":"替代动作"}：{e.alternative_exercises.join("、")}</p>}</li>)}</ul>
        </details>)}
      </section>)}
      <p className="text-xs text-muted-foreground">{en?"These are prescribed targets, not completed sets. Your current workout keeps its original prescription.":"这些是计划目标，不是已完成记录。本次正在进行的训练仍保留原处方。"}</p>
    </>}
  </div>;
}
