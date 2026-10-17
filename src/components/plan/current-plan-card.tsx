"use client";

import Link from "next/link";
import { ChevronRight, Dumbbell } from "lucide-react";
import { useLocale } from "next-intl";
import { Button } from "@/components/ui/button";
import { useCurrentPlan } from "./use-current-plan";

export function PlanProgressBar({ day, total, en }: { day: number | null; total: number; en: boolean }) {
  return <div role="progressbar" aria-label={en ? "Plan calendar progress" : "计划日历进度"}
    aria-valuemin={0} aria-valuemax={total} aria-valuenow={day ?? undefined}
    aria-valuetext={day === null ? (en ? "Start date unavailable" : "暂无开始日期") : `${day} / ${total}`}
    className="h-1.5 overflow-hidden rounded-full bg-muted">
    <div className="h-full rounded-full bg-foreground transition-[width] motion-reduce:transition-none" style={{ width: `${total && day !== null ? day / total * 100 : 0}%` }} />
  </div>;
}

export function CurrentPlanCard() {
  const en = useLocale() === "en";
  const { plan, progress, hasPlan, loading, error, refresh } = useCurrentPlan();
  if (loading && !hasPlan) return <div className="mb-6 rounded-2xl border p-5 text-sm text-muted-foreground" role="status">{en ? "Loading your plan…" : "正在读取当前计划…"}</div>;
  if (error) return <div className="mb-6 rounded-2xl border p-5 text-sm"><p>{en ? "Your current plan could not be refreshed." : "暂时无法刷新当前计划."}</p><Button variant="ghost" onClick={() => void refresh()}>{en ? "Try again" : "重试"}</Button></div>;
  return <Link prefetch={true} href={hasPlan ? "/current-plan" : "/agent?prompt=" + encodeURIComponent(en ? "Help me create a training plan" : "帮我制定一个训练计划")}
    className="mb-6 block rounded-2xl border p-5 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-offset-4 sm:p-6" data-testid="current-plan-card">
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2.5 text-sm font-medium"><Dumbbell className="size-4" aria-hidden="true" />{en ? "Current plan" : "当前计划"}</span>
      <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
    </div>
    {hasPlan ? <>
      <p className="mt-5 truncate text-lg font-medium">{plan.name}</p>
      <div className="mb-3 mt-4 flex items-baseline justify-between gap-3 text-sm">
        <p><span className="text-2xl font-medium tabular-nums">{progress.calendarDay ?? "—"}</span><span className="ml-1 text-muted-foreground">/ {progress.totalDays} {en ? "days" : "天"}</span></p>
        <span className="text-xs text-muted-foreground">{en ? `${progress.recordedDays} training days recorded` : `已记录 ${progress.recordedDays} 次训练`}</span>
      </div>
      <PlanProgressBar day={progress.calendarDay} total={progress.totalDays} en={en} />
      <p className="mt-4 truncate text-xs text-muted-foreground">{progress.nextDay ? `${en ? "Up next" : "下次训练"} · ${progress.nextDay.title}` : (en ? "All training days recorded. View your plan." : "所有训练日已有记录，查看计划.")}</p>
    </> : <p className="mt-4 text-sm text-muted-foreground">{en ? "Create a plan with Agent. It will appear here once confirmed." : "让 Agent 制定计划，确认后就会出现在这里."}</p>}
  </Link>;
}
