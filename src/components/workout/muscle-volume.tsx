"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkoutLog } from "@liftcut/core/types";
import { localDateAt } from "@liftcut/core/today";
import { BODY_REGIONS, FIGURE_BACK, FIGURE_FRONT, muscleVolume, volumeLevel, type BodyRegion, type FigureShape } from "@liftcut/core/muscle-volume";

const shade = ["fill-slate-100 dark:fill-slate-800", "fill-slate-300 dark:fill-slate-600", "fill-slate-500 dark:fill-slate-400", "fill-slate-800 dark:fill-slate-100"];
function Figure({ parts, levels, dx, label }: { parts: [BodyRegion | null, FigureShape[]][]; levels: Record<BodyRegion, number>; dx: number; label: string }) {
  return <g transform={`translate(${dx} 0)`}>
    {parts.map(([region, shapes]) => shapes.map((s, i) => <rect key={`${region}-${i}`} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r ?? 4}
      data-region={region ?? undefined} className={region ? `${shade[levels[region]]} stroke-slate-400 dark:stroke-slate-500` : "fill-none stroke-slate-300 dark:stroke-slate-600"} strokeWidth={0.8} />))}
    <text x={50} y={198} textAnchor="middle" className="fill-slate-500 text-[9px]">{label}</text>
  </g>;
}

/** Confirmed sets per body region; the figure only shades regions the catalog can name, the list gives the numbers. */
export function MuscleVolume({ logs }: { logs: WorkoutLog[] }) {
  const t = useTranslations("workout.volume"), body = useTranslations("today.replacement.body");
  const today = useMemo(() => localDateAt(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone), []);
  const [days, setDays] = useState<7 | 28>(7);
  const volume = useMemo(() => muscleVolume(logs, today, days), [logs, today, days]);
  const levels = Object.fromEntries(BODY_REGIONS.map(r => [r, volumeLevel(volume.regions[r], days)])) as Record<BodyRegion, number>;
  const trained = BODY_REGIONS.filter(r => volume.regions[r].sets || volume.regions[r].unknownRows);
  return <Card className="border-slate-200/80 bg-white/90 dark:border-slate-700/50 dark:bg-slate-800/90" data-testid="muscle-volume">
    <CardHeader>
      <CardTitle className="text-base">{t("title")}</CardTitle>
      <CardDescription>{t("hint")}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3 text-sm">
      <div className="flex gap-2">{([7, 28] as const).map(d => <Button key={d} size="sm" variant={d === days ? "default" : "outline"} aria-pressed={d === days} onClick={() => setDays(d)}>{t(`days${d}`)}</Button>)}</div>
      <svg viewBox="0 0 200 204" role="img" aria-label={t("figure")} className="mx-auto h-56 w-auto">
        <Figure parts={FIGURE_FRONT} levels={levels} dx={0} label={t("front")} /><Figure parts={FIGURE_BACK} levels={levels} dx={100} label={t("back")} />
      </svg>
      {!trained.length && !volume.unclassified.length ? <p role="status">{t("empty")}</p> : <ul className="space-y-1" data-testid="volume-list">
        {trained.map(r => <li key={r} className="flex justify-between gap-3"><span>{body(r)}</span>
          <span>{t("sets", { sets: volume.regions[r].sets })}{volume.regions[r].unknownRows > 0 && ` · ${t("unknownRows", { rows: volume.regions[r].unknownRows })}`}</span></li>)}
        {volume.unclassified.length > 0 && <li className="text-muted-foreground">{t("unclassified", { names: volume.unclassified.map(u => u.name).join("、") })}</li>}
      </ul>}
    </CardContent>
  </Card>;
}
