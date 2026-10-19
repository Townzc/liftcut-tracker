"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { ArrowLeft, ArrowUpRight, Check, Dumbbell } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { useTrackerStore } from "@/store/use-tracker-store";
import type { TodayData } from "@/lib/today";
import { exerciseLabel } from "@liftcut/core/exercise-catalog";
import { useCurrentPlan } from "./use-current-plan";
import { PlanProgressBar } from "./current-plan-card";

export function CurrentPlanPage() {
  const locale = useLocale(), en = locale === "en";
  const { plan, progress, hasPlan, loading, error, refresh, owner } = useCurrentPlan();
  const [selected, setSelected] = useState("");
  const [today, setToday] = useState<{ owner: string; data: TodayData } | null>(null);
  const [sessionError, setSessionError] = useState(false);
  useEffect(() => {
    if (!owner) return;
    const controller = new AbortController();
    void fetch("/api/workout-sessions", { cache: "no-store", headers: { "X-Workout-Owner": owner }, signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error("LOAD_FAILED"); return response.json() as Promise<TodayData>; })
      .then(data => { setToday({ owner, data }); setSessionError(false); })
      .catch(() => { if (!controller.signal.aborted) setSessionError(true); });
    return () => controller.abort();
  }, [owner, plan.id]);
  const active = today?.owner === owner && today?.data.session?.status === "active" ? today.data.session : null;
  const activeDay = active?.trainingPlanId === plan.id ? progress.days.find(day => day.weekNumber === active.weekNumber && day.dayNumber === active.dayNumber) : null;
  const day = progress.days.find(item => item.id === selected) ?? activeDay ?? progress.nextDay ?? progress.days[0];
  const chosenRecorded = day && progress.recorded.has(progress.key(day.weekNumber, day.dayNumber));
  const duration = day?.notes.match(/^Estimated duration: (\d+) min$/m)?.[1];
  const dayNotes = day?.notes.replace(/^Estimated duration: \d+ min$/m, "").trim();
  function selectWorkout() {
    if (!day) return;
    useTrackerStore.getState().setSelectedWeek(day.weekNumber);
    useTrackerStore.getState().setSelectedDay(day.dayNumber);
  }
  return <div className="mx-auto max-w-2xl pb-4" data-testid="current-plan-page">
    <Link href="/" className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" />{en ? "Home" : "返回首页"}</Link>
    <h1 className="text-2xl font-medium tracking-tight">{en ? "Current plan" : "当前计划"}</h1>
    {loading && !hasPlan ? <p role="status" className="py-8 text-sm">{en ? "Loading…" : "正在读取…"}</p> : error ?
      <div role="alert" className="space-y-3 py-8"><p>{en ? "Could not refresh your plan." : "暂时无法刷新计划."}</p><Button variant="outline" onClick={() => void refresh()}>{en ? "Try again" : "重试"}</Button></div> : !hasPlan ?
      <div className="space-y-5 py-10"><p className="text-sm text-muted-foreground">{en ? "Your confirmed training plan will appear here." : "确认后的训练计划会出现在这里."}</p><Link href="/agent" className={buttonVariants({ variant: "outline" })}>{en ? "Create with Agent" : "去 Agent 制定计划"}</Link></div> : <>
      <section className="mt-6 rounded-2xl border p-5 sm:p-6" aria-label={en ? "Plan progress" : "计划进度"}>
        <p className="text-base font-medium leading-7">{plan.name}</p>
        <div className="mb-4 mt-5 flex items-end justify-between gap-3">
          <p className="text-muted-foreground"><span className="mr-1 text-4xl font-medium tabular-nums text-foreground">{progress.calendarDay ?? "—"}</span> / {progress.totalDays} {en ? "days" : "天"}</p>
          <span className="text-xs text-muted-foreground">{en ? `${plan.weeks.length} weeks` : `${plan.weeks.length} 周计划`}</span>
        </div>
        <PlanProgressBar day={progress.calendarDay} total={progress.totalDays} en={en} />
        <div className="mt-5 flex flex-wrap justify-between gap-2 text-xs text-muted-foreground">
          <p>{en ? "Plan date" : "计划日期"} · {progress.startDate ?? "—"}</p>
          <p data-testid="recorded-plan-days">{en ? "Training days recorded" : "已记录训练日"} · {progress.recordedDays} / {progress.days.length}</p>
        </div>
        <p className="mt-3 text-xs leading-6 text-muted-foreground">{progress.cycleEnded ? (en ? "The cycle has ended. Unrecorded workouts are still available." : "周期已结束，未记录的训练仍可继续.") : (en ? "Calendar time and recorded workouts are counted separately." : "日历进度与实际训练分别统计.")}</p>
      </section>
      {active && <div className="mt-6 rounded-xl bg-muted/60 p-4 text-sm" data-testid="current-plan-active-session"><p>{en ? "Workout in progress" : "有训练正在进行"} · {active.prescription.title}</p><p className="mt-2 text-xs text-muted-foreground">{en ? "Continue with its saved prescription, including any changes for this session." : "继续时保留本次训练的原处方和已确认调整."}</p><Link href="/current-plan/workout" className="mt-2 inline-flex min-h-11 items-center underline underline-offset-4">{en ? "Continue recording" : "继续记录"}</Link></div>}
      <section className="mt-9" aria-label={en ? "Today's workout" : "今日训练"}>
        <div className="flex items-center gap-2"><Dumbbell className="size-4" /><h2 className="text-lg font-medium">{en ? "Today's workout" : "今日训练"}</h2></div>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">{en ? "Next unrecorded day. Choose a different day or rest as needed." : "按未记录顺序推荐，也可自行选日或休息."}</p>
        <label className="mt-5 block text-xs text-muted-foreground" htmlFor="current-plan-day">{en ? "Training day" : "选择训练日"}</label>
        <select id="current-plan-day" className="mt-2 min-h-12 w-full rounded-xl border bg-background px-3 text-sm" value={day?.id ?? ""} onChange={event => setSelected(event.target.value)}>
          {progress.days.map(item => <option key={item.id} value={item.id}>{en ? `Week ${item.weekNumber} · Day ${item.dayNumber}` : `第 ${item.weekNumber} 周 · 第 ${item.dayNumber} 次`} · {item.title}{progress.recorded.has(progress.key(item.weekNumber, item.dayNumber)) ? (en ? " · Recorded" : " · 已记录") : ""}</option>)}
        </select>
        {day && <div className="mt-6" data-testid="current-plan-exercises">
          <div className="flex items-center justify-between gap-3"><h3 className="text-base font-medium">{day.title}</h3>{chosenRecorded && <span className="flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3" />{en ? "Recorded" : "已记录"}</span>}</div>
          {duration && <p className="mt-2 text-xs text-muted-foreground">{en ? `About ${duration} min` : `预计 ${duration} 分钟`}</p>}
          <ol className="mt-3 divide-y">{day.exercises.map((exercise, index) => <li key={exercise.id} className="py-5">
            <div className="flex gap-3"><span className="mt-0.5 text-xs tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0 flex-1">
              <p className="font-medium">{exerciseLabel(exercise.name, locale)}</p>
              <p className="mt-2 text-sm text-muted-foreground">{exercise.sets} {en ? "sets" : "组"} × {exercise.repRange} · {en ? "Target RPE" : "目标 RPE"} {exercise.targetRpe}</p>
              {exercise.notes && <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">{en ? exercise.notes : exercise.notes.replace(/^Rest: (\d+)s$/gm, "休息 $1 秒")}</p>}
              {!!exercise.alternativeExercises?.length && <p className="mt-2 text-xs leading-6 text-muted-foreground">{en ? "Alternatives" : "替代动作"} · {exercise.alternativeExercises.join("、")}</p>}
            </div></div>
          </li>)}</ol>
          {!day.exercises.length && <p className="py-5 text-sm text-muted-foreground">{en ? "No exercises scheduled for this day." : "这一天没有安排动作."}</p>}
          {dayNotes && <p className="mb-3 whitespace-pre-wrap text-xs leading-6 text-muted-foreground">{dayNotes}</p>}
          <p className="mt-2 text-xs leading-6 text-muted-foreground">{en ? "These are targets. Opening a workout does not mark any sets as completed." : "以上是计划目标；进入记录页不会自动完成任何一组."}</p>
          {!active && <Link href={owner ? "/current-plan/workout" : "/agent"} onClick={selectWorkout} className={buttonVariants({ className: "mt-5 w-full" })}>{en ? "Open workout" : "开始记录"}</Link>}
        </div>}
        {sessionError && <p className="mt-3 text-xs text-muted-foreground">{en ? "Workout status is temporarily unavailable. It will be checked again when you open recording." : "暂时无法读取进行中的训练，进入记录页后会重新核对."}</p>}
      </section>
      <Link href={"/agent?prompt=" + encodeURIComponent(en ? "I'd like to adjust my current training plan" : "我想调整当前训练计划")}
        className="mt-8 flex min-h-14 items-center justify-between border-y py-4 text-sm">{en ? "Adjust with Agent" : "让 Agent 调整计划"}<ArrowUpRight className="size-4" /></Link>
      {plan.notes && <section className="mt-7"><h2 className="text-sm font-medium">{en ? "Plan notes" : "计划说明"}</h2><p className="mt-3 whitespace-pre-wrap text-xs leading-7 text-muted-foreground">{plan.notes}</p></section>}
    </>}
  </div>;
}

