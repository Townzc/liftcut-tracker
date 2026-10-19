"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkoutLog } from "@liftcut/core/types";
import { localDateAt } from "@liftcut/core/today";
import { BODY_REGIONS, muscleVolume, type BodyRegion, type Volume } from "@liftcut/core/muscle-volume";

// An original, deliberately simple figure: rounded blocks on a 100 × 190 grid per view. Unlisted parts stay neutral.
type Shape = { x: number; y: number; w: number; h: number; r?: number };
/** A left shape and its mirror image. */
const pair = (x: number, y: number, w: number, h: number): Shape[] => [{ x, y, w, h }, { x: 100 - x - w, y, w, h }];
const FRONT: [BodyRegion | null, Shape[]][] = [
  [null, [{ x: 40, y: 4, w: 20, h: 22, r: 10 }, { x: 45, y: 26, w: 10, h: 7 }, ...pair(17, 76, 9, 26), { x: 36, y: 88, w: 28, h: 10 }, ...pair(38, 144, 10, 38)]],
  ["shoulders", pair(22, 34, 14, 14).map(s => ({ ...s, r: 7 }))],
  ["chest", pair(34, 36, 15, 18)],
  ["biceps", pair(19, 50, 9, 24)],
  ["abdominals", [{ x: 38, y: 56, w: 24, h: 30 }]],
  ["quadriceps", pair(36, 100, 13, 42)],
];
const BACK: [BodyRegion | null, Shape[]][] = [
  [null, [{ x: 40, y: 4, w: 20, h: 22, r: 10 }, { x: 45, y: 26, w: 10, h: 7 }, ...pair(17, 76, 9, 26)]],
  ["shoulders", pair(22, 34, 14, 14).map(s => ({ ...s, r: 7 }))],
  ["back", [{ x: 34, y: 36, w: 32, h: 40 }]],
  ["triceps", pair(19, 50, 9, 24)],
  ["posterior_chain", [{ x: 36, y: 78, w: 28, h: 20 }]],
  ["hamstrings", pair(36, 100, 13, 42)],
  ["calves", pair(38, 144, 10, 38)],
];
const shade = ["fill-slate-100 dark:fill-slate-800", "fill-slate-300 dark:fill-slate-600", "fill-slate-500 dark:fill-slate-400", "fill-slate-800 dark:fill-slate-100"];
/** Per-week level so 7 and 28 days read alike: none, 1–3, 4–9, 10+ confirmed sets a week (unknown counts show as the lightest). */
const levelOf = (v: Volume, weeks: number) => { const perWeek = v.sets / weeks; return perWeek >= 10 ? 3 : perWeek >= 4 ? 2 : v.sets > 0 || v.unknownRows > 0 ? 1 : 0; };

function Figure({ parts, levels, dx, label }: { parts: [BodyRegion | null, Shape[]][]; levels: Record<BodyRegion, number>; dx: number; label: string }) {
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
  const levels = Object.fromEntries(BODY_REGIONS.map(r => [r, levelOf(volume.regions[r], days / 7)])) as Record<BodyRegion, number>;
  const trained = BODY_REGIONS.filter(r => volume.regions[r].sets || volume.regions[r].unknownRows);
  return <Card className="border-slate-200/80 bg-white/90 dark:border-slate-700/50 dark:bg-slate-800/90" data-testid="muscle-volume">
    <CardHeader>
      <CardTitle className="text-base">{t("title")}</CardTitle>
      <CardDescription>{t("hint")}</CardDescription>
    </CardHeader>
    <CardContent className="space-y-3 text-sm">
      <div className="flex gap-2">{([7, 28] as const).map(d => <Button key={d} size="sm" variant={d === days ? "default" : "outline"} aria-pressed={d === days} onClick={() => setDays(d)}>{t(`days${d}`)}</Button>)}</div>
      <svg viewBox="0 0 200 204" role="img" aria-label={t("figure")} className="mx-auto h-56 w-auto">
        <Figure parts={FRONT} levels={levels} dx={0} label={t("front")} /><Figure parts={BACK} levels={levels} dx={100} label={t("back")} />
      </svg>
      {!trained.length && !volume.unclassified.length ? <p role="status">{t("empty")}</p> : <ul className="space-y-1" data-testid="volume-list">
        {trained.map(r => <li key={r} className="flex justify-between gap-3"><span>{body(r)}</span>
          <span>{t("sets", { sets: volume.regions[r].sets })}{volume.regions[r].unknownRows > 0 && ` · ${t("unknownRows", { rows: volume.regions[r].unknownRows })}`}</span></li>)}
        {volume.unclassified.length > 0 && <li className="text-muted-foreground">{t("unclassified", { names: volume.unclassified.map(u => u.name).join("、") })}</li>}
      </ul>}
    </CardContent>
  </Card>;
}
