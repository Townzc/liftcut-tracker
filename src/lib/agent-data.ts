import type { AppDataSnapshot } from "@liftcut/core/types";
import type { PersonalRecord } from "./personal-records";
import type { Session } from "@liftcut/core/today";
import { toDateString } from "./date";
import { recordPeriod } from "./record-period";

export type DataAnswer = {lines: string[]; topic: "body" | "food" | "workout" | "plan"; guidance?: true};
export function answerDataQuestion(input: string, snapshot: Pick<AppDataSnapshot,"bodyMetricLogs"|"foodLogs"|"workoutLogs"|"trainingPlan">,
  records: PersonalRecord[], session: Session | null, en: boolean, now = new Date(), owner?:string): DataAnswer | null {
  const text = input.normalize("NFKC").trim().toLowerCase();
  if (/^(?:帮我)?(?:记录|记下|记一下|record\b|log\b)/i.test(text) || /不要|don't|do not/.test(text)) return null;
  const query = /多少|趋势|最近|查看|我的|查|什么|如何|怎么样|变化|\?|？|\bwhat\b|\bshow\b|\bhow\b|\bhistory\b|\brecent\b|\bthis week\b/.test(text);
  if (/目标|建议|应该|target|goal|should|recommend/.test(text) && /体重|身体|腰围|热量|蛋白|卡路里|weight|body|waist|calori|protein/.test(text)) {
    return {guidance:true,topic: /体重|身体|腰围|weight|body|waist/.test(text) ? "body" : "food", lines: [en
      ? "You can view your configured targets in Settings → Profile & goals. Targets are separate from recorded measurements and meals. Ask ‘recent weight’ or ‘what did I eat today’ to see actual entries."
      : "已设置的目标可在「设置 → 基础信息与目标」查看。目标与实际记录分开保存；要查已记录的数据，可以问「最近体重」或「今天吃了什么」。"]};
  }
  const active = records.filter(r=>!r.undo), today=toDateString(now);
  const period=recordPeriod(text,today),topic=/体重|身体|腰围|weight|body|waist/.test(text)?"body":/吃|饮食|热量|蛋白|卡路里|food|meal|eat|ate|nutrition|calori|protein/.test(text)?"food":/训练|练了|workout|training/.test(text)?"workout":null;
  if(topic&&query&&period.kind==="unsupported")return {guidance:true,topic,lines:[en?"Please give one exact date (YYYY-MM-DD), or say ‘two months ago’. I couldn't identify the requested period, so I haven't substituted recent records.":"请明确一个日期（如 2026-08-16），或说「两个月前」. 这次时间范围不明确，我没有用最近的数据代替历史记录."]};
  const inRange=(date:string)=>date<=today&&(period.kind!=="range"||(date>=period.from&&date<=period.to));
  const rangeLines=period.kind==="range"?[`${en?"Date queried":"查询日期"}: ${period.from}${period.to===period.from?"":` ~ ${period.to}`}`]:[];
  const stamp = en ? "Source: your saved entries. Missing values are shown as —." : "依据已保存的记录；未填写的数值显示为 —。";
  if ((query || /^(体重|身体数据|腰围|body|weight|waist)$/.test(text)) && /体重|身体|腰围|weight|body|waist/.test(text)) {
    const body = [...snapshot.bodyMetricLogs.filter(r=>!owner||r.userId===owner).map(r=>({date:r.date,at:r.createdAt,weight:r.weight,waist:r.waist,legacy:true})),
      ...active.flatMap(r=>r.entry.kind === "body" ? [{date:r.entry.date,at:r.createdAt,weight:r.entry.weightKg,waist:r.entry.waistCm,legacy:false}] : [])]
      .filter(r=>inRange(r.date)).sort((a,b)=>b.date.localeCompare(a.date)||b.at.localeCompare(a.at));
    const weight = body.filter(r=>r.weight!==null), trend = /趋势|变化|trend|change/.test(text);
    const lines = body.length ? body.slice(0,7).map(r=>`${r.date} · ${en?"Weight":"体重"} ${r.weight??"—"} kg · ${en?"Waist":"腰围"} ${r.waist??"—"} cm${r.legacy ? en?" · legacy entry":" · 旧记录" : ""}`)
      : [period.kind==="range" ? en?"No body measurements saved for this period. I won't infer a past weight from a recent entry or target.":"该日期范围还没有身体记录，不能用现在的体重或目标体重推测当时的数值。" : en ? "You haven't saved any body measurements yet. Try ‘log weight 72.5 kg’." : "还没有身体记录。登录后可以告诉我「记下体重 72.5 公斤」，确认后保存。"];
    if (trend && weight.length>=2) lines.unshift(en ? `Change between the latest two weight entries: ${Number((weight[0].weight!-weight[1].weight!).toFixed(2))} kg.` : `最近两次体重记录相差 ${Number((weight[0].weight!-weight[1].weight!).toFixed(2))} kg。`);
    if(body.length>7)lines.push(en?`Showing the latest 7 of ${body.length} matching entries. Ask for a date to see older entries.`:`该范围有 ${body.length} 条记录，先显示最近 7 条；可指定日期查询更早的数据。`);
    return {topic:"body",lines:[...rangeLines,...lines,stamp]};
  }
  if ((query || /^(饮食|今天吃了什么|nutrition|food)$/.test(text)) && /吃|饮食|热量|蛋白|卡路里|food|meal|eat|ate|nutrition|calori|protein/.test(text)) {
    const date=period.kind==="range"?`${period.from}${period.from===period.to?"":` ~ ${period.to}`}`:today;
    const foods = [...snapshot.foodLogs.filter(r=>!owner||r.userId===owner).map(r=>({date:r.date,name:r.foodName,calories:r.calories as number|null,protein:r.protein as number|null})),
      ...active.flatMap(r=>r.entry.kind === "food" ? [{date:r.entry.date,name:r.entry.foodName,calories:r.entry.calories,protein:r.entry.protein}] : [])].filter(r=>period.kind==="range"?inRange(r.date):r.date===today);
    if (!foods.length) return {topic:"food",lines:[en ? `No meals recorded for ${date}. This does not mean you ate nothing.` : `${date} 暂无饮食记录，这不代表当天没有进食。`]};
    const sum=(key:"calories"|"protein")=>{const known=foods.filter(r=>r[key]!==null);return known.length ? Number(known.reduce((n,r)=>n+r[key]!,0).toFixed(1)) : "—";};
    return {topic:"food",lines:[`${date} · ${en?"Recorded subtotal":"已记录部分合计"}: ${sum("calories")} kcal · ${sum("protein")} g ${en?"protein":"蛋白质"}`,
      ...foods.map(r=>`${r.date} · ${r.name} · ${r.calories??"—"} kcal · ${r.protein??"—"} g`),
      ...(foods.some(r=>r.calories===null||r.protein===null)?[en?"Some values are missing; this is not your full daily intake.":"部分数值未填写，合计不能代表全天摄入。"]:[]),stamp]};
  }
  if ((period.kind==="range"||/本周|这周|最近|历史|this week|recent|history/.test(text)) && /训练|练了|workout|training/.test(text)) {
    const week=/本周|这周|this week/.test(text);
    const logs=snapshot.workoutLogs.filter(r=>(!owner||r.userId===owner)&&inRange(r.date)).sort((a,b)=>b.date.localeCompare(a.date));
    const lines = logs.slice(0,7).map(r=>`${r.date} · ${r.exercises.filter(e=>e.completed).length} ${en?"recorded sets/legacy exercise rows":"条已记录组 / 旧动作明细"} · ${r.completed ? en?"Finished":"已结束" : en?"In progress":"进行中"}`);
    if(period.kind==="none"&&session?.status === "active" && !logs.some(r=>r.id===session.id))lines.unshift(`${en?"Current session":"本次训练"} · ${session.sets.filter(s=>s.status==="done").length} ${en?"sets; may include pending sync":"组，可能含待同步记录"}`);
    return {topic:"workout",lines:[...rangeLines,en?`${week?"This week":"Queried history"}: ${logs.filter(r=>r.completed).length} completed sessions in saved history.`:`${week?"本周":"查询范围内"}已保存 ${logs.filter(r=>r.completed).length} 次结束的训练。`,...lines,stamp]};
  }
  if (!session && /^(今天练什么[?？]?|我今天练什么[?？]?|查看计划|我的计划|show plan|what is my plan|today's plan)$/.test(text)) {
    const plan=!owner||snapshot.trainingPlan.userId===owner?snapshot.trainingPlan:{...snapshot.trainingPlan,weeks:[]};
    return {topic:"plan",lines:plan.weeks.length ? [plan.name,...plan.weeks[0].days.map(d=>`${en?"Day":"训练日"} ${d.dayNumber} · ${d.title} · ${d.exercises.length} ${en?"exercises":"个动作"}`),
      en?"These are planned targets, not completed exercise. Choose a day above to begin.":"以上是计划目标，不代表实际完成。可展开上方「本次训练」选择训练日开始。"] : [en?"No active plan yet. Open training tools to create or import one.":"还没有训练计划。可展开「训练工具」创建或导入计划。"]};
  }
  return null;
}
