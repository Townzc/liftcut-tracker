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
