import { bodyRegionOf } from "./exercise-catalog";
import type { WorkoutLog } from "./types";

/**
 * Confirmed completed sets per body region over a recent window (M3-2). The region
 * comes from the exercise catalog only: a name whose catalog matches disagree or that
 * the catalog does not know is listed as unclassified, never guessed. As in the training calendar, an older log row with
 * no set count adds an unknown row instead of an invented number of sets.
 */
export const BODY_REGIONS = ["chest", "shoulders", "back", "quadriceps", "posterior_chain", "hamstrings", "calves", "biceps", "triceps", "abdominals"] as const;
export type BodyRegion = typeof BODY_REGIONS[number];
export type Volume = { sets: number; unknownRows: number };
export type MuscleVolume = { from: string; to: string; regions: Record<BodyRegion, Volume>; unclassified: (Volume & { name: string })[] };

const DAY = 86400000;
const isRegion = (body: string): body is BodyRegion => (BODY_REGIONS as readonly string[]).includes(body);

/** The `days` days ending on `today` (the viewer's local date, inclusive). */
export function muscleVolume(logs: readonly Pick<WorkoutLog, "date" | "exercises">[], today: string, days: number): MuscleVolume {
  const from = new Date(Date.parse(`${today}T00:00:00Z`) - (days - 1) * DAY).toISOString().slice(0, 10);
  const regions = Object.fromEntries(BODY_REGIONS.map(r => [r, { sets: 0, unknownRows: 0 }])) as Record<BodyRegion, Volume>;
  const other = new Map<string, Volume>();
  for (const log of logs) {
    if (log.date < from || log.date > today) continue;
    for (const row of log.exercises) {
      if (!row.completed) continue;
      const body = bodyRegionOf(row.name);
      const target = body && isRegion(body) ? regions[body] : other.get(row.name) ?? other.set(row.name, { sets: 0, unknownRows: 0 }).get(row.name)!;
      if (row.recordedSets != null && row.recordedSets > 0) target.sets += row.recordedSets; else target.unknownRows++;
    }
  }
  return { from, to: today, regions, unclassified: [...other].map(([name, v]) => ({ name, ...v })).sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Per-week level so 7 and 28 days read alike: none, 1–3, 4–9, 10+ confirmed sets a week; unknown counts show as the lightest. */
export const volumeLevel = (v: Volume, days: number): 0 | 1 | 2 | 3 => {
  const perWeek = v.sets / (days / 7);
  return perWeek >= 10 ? 3 : perWeek >= 4 ? 2 : v.sets > 0 || v.unknownRows > 0 ? 1 : 0;
};

// An original, deliberately simple figure shared by the web and the app: rounded blocks on a
// 100 × 190 grid per view. Parts without a region stay neutral.
export type FigureShape = { x: number; y: number; w: number; h: number; r?: number };
const pair = (x: number, y: number, w: number, h: number): FigureShape[] => [{ x, y, w, h }, { x: 100 - x - w, y, w, h }]; // Left and mirrored right.
const head: FigureShape[] = [{ x: 40, y: 4, w: 20, h: 22, r: 10 }, { x: 45, y: 26, w: 10, h: 7 }, ...pair(17, 76, 9, 26)];
const shoulders = pair(22, 34, 14, 14).map(s => ({ ...s, r: 7 }));
export const FIGURE_FRONT: [BodyRegion | null, FigureShape[]][] = [
  [null, [...head, { x: 36, y: 88, w: 28, h: 10 }, ...pair(38, 144, 10, 38)]],
  ["shoulders", shoulders], ["chest", pair(34, 36, 15, 18)], ["biceps", pair(19, 50, 9, 24)],
  ["abdominals", [{ x: 38, y: 56, w: 24, h: 30 }]], ["quadriceps", pair(36, 100, 13, 42)],
];
export const FIGURE_BACK: [BodyRegion | null, FigureShape[]][] = [
  [null, head], ["shoulders", shoulders], ["back", [{ x: 34, y: 36, w: 32, h: 40 }]], ["triceps", pair(19, 50, 9, 24)],
  ["posterior_chain", [{ x: 36, y: 78, w: 28, h: 20 }]], ["hamstrings", pair(36, 100, 13, 42)], ["calves", pair(38, 144, 10, 38)],
];
