"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkoutLog } from "@liftcut/core/types";
import { localDateAt } from "@liftcut/core/today";
import { trainingCalendar, type CalendarDay } from "@liftcut/core/training-calendar";

const shade: Record<CalendarDay["level"], string> = {
  0: "bg-slate-100 dark:bg-slate-800", 1: "bg-slate-300 dark:bg-slate-600", 2: "bg-slate-500 dark:bg-slate-400",
  3: "bg-slate-700 dark:bg-slate-300", 4: "bg-slate-900 dark:bg-slate-100",
};

/** A year of confirmed training on the history page; days without records stay empty, never zero-set workouts. */
export function TrainingCalendar({ logs }: { logs: WorkoutLog[] }) {
  const t = useTranslations("workout.calendar");
  const today = useMemo(() => localDateAt(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  const calendar = useMemo(() => trainingCalendar(logs, today), [logs, today]);
  const [selected, setSelected] = useState<CalendarDay | null>(null), scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollLeft = scroller.current.scrollWidth; }, [calendar]); // Latest weeks first in view.
  const label = (d: CalendarDay) => !d.unknownRows ? t("day", { date: d.date, sets: d.sets })
    : d.sets ? t("unknownDay", { date: d.date, sets: d.sets, rows: d.unknownRows }) : t("unknownOnly", { date: d.date, rows: d.unknownRows });
  return <Card className="border-slate-200/80 bg-white/90 dark:border-slate-700/50 dark:bg-slate-800/90" data-testid="training-calendar">
    <CardHeader>
      <CardTitle className="text-base">{t("title")}</CardTitle>
      <CardDescription>{t("hint")}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3 text-sm">
      <p role="status">{!calendar.trainedDays ? t("empty") : calendar.sets ? t("summary", { days: calendar.trainedDays, sets: calendar.sets }) : t("summaryDays", { days: calendar.trainedDays })}
        {calendar.unknownDays > 0 && ` ${t("unknown", { days: calendar.unknownDays })}`}</p>
      <div ref={scroller} className="overflow-x-auto p-1">
        <div className="flex w-max gap-[3px]">
          {calendar.weeks.map((week, w) => <div key={w} className="grid grid-rows-7 gap-[3px]">
            {week.map((d, i) => !d ? <span key={i} className="size-3" /> : d.level === 0
              ? <span key={i} aria-hidden className={`size-3 rounded-[3px] ${shade[0]}`} />
              : <button key={i} type="button" aria-label={label(d)} aria-pressed={selected?.date === d.date} onClick={() => setSelected(d)}
                className={`size-3 rounded-[3px] ${shade[d.level]} ${selected?.date === d.date ? "ring-2 ring-slate-400" : ""}`} />)}
          </div>)}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <p data-testid="calendar-selected">{selected ? label(selected) : t("tap")}</p>
        <p className="flex shrink-0 items-center gap-1" aria-hidden>{t("less")}{([0, 1, 2, 3, 4] as const).map(l => <span key={l} className={`size-3 rounded-[3px] ${shade[l]}`} />)}{t("more")}</p>
      </div>
    </CardContent>
  </Card>;
}
