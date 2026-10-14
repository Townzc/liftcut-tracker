"use client";
import { useLocale } from "next-intl";
import type { CoachSource } from "@/lib/coach-model";

const labels:Record<string,string>={body:"身体记录",food:"饮食记录",workout:"训练记录",plan:"当前计划（目标）",profile:"个人设置（目标）"};
const keys:Record<string,string>={date:"日期",weightKg:"体重 kg",waistCm:"腰围 cm",foodName:"食物",mealType:"餐次",calories:"热量 kcal",protein:"蛋白质 g",exercise:"动作",reps:"次数",rpe:"RPE",setIndex:"组",targetSets:"目标组数",targetReps:"目标次数",targetRpe:"目标 RPE",targetWeightKg:"目标体重 kg",calorieTarget:"热量目标",proteinTarget:"蛋白质目标",weeklyTrainingDays:"每周训练日",plan:"计划",week:"周",day:"训练日",title:"名称",fitnessGoal:"目标",experience:"经验",equipment:"器械",sessionMinutes:"训练时长"};
function fields(row:Record<string,unknown>,en:boolean){return Object.entries(row).filter(([k])=>k in keys).map(([k,v])=>`${en?k:keys[k]}: ${v===null?"—":Array.isArray(v)?v.join(", "):String(v)}`).join(" · ");}
export function CoachSources({sources}:{sources:CoachSource[]}){
  const en=useLocale()==="en";
  return <details className="mt-4 text-xs text-muted-foreground" data-testid="coach-sources"><summary className="w-fit cursor-pointer py-2">{en?"View sources":"查看依据"} · {sources.length}</summary>
    <div className="mt-2 space-y-4 rounded-xl border p-3">{sources.map((s,i)=><section key={`${s.id}:${i}`} className="space-y-2">
      <p className="font-medium text-foreground">{en?s.topic:labels[s.topic]} · {s.from} — {s.to}</p>
      <p>{en?"Read at":"读取于"} {new Date(s.readAt).toLocaleTimeString()} · {s.summary.recordCount as number} {en?"records":"条记录"}{s.truncated?(en?" · partial results":" · 结果未全部显示"):""}</p>
      {!s.rows.length&&<p>{en?"No saved records in this range.":"此范围内没有已保存的记录。"}</p>}
      {s.rows.slice(0,10).map((row,n)=><div key={n} className="break-words border-t pt-2"><p>{fields(row,en)}{row.legacy?(en?" · legacy":" · 旧记录"):""}</p>
        {Array.isArray(row.actualSets)&&row.actualSets.slice(0,8).map((set,j)=><p key={j}>{fields(set,en)}</p>)}</div>)}
      {s.rows.length>10&&<p>{en?"Showing the first 10 source entries; the summary uses all entries read.":"这里只展开前 10 条来源，汇总使用实际读取的全部记录。"}</p>}
    </section>)}</div>
  </details>;
}
