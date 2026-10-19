/**
 * Estimated one-rep max (Brzycki) from confirmed actual sets only. Above 12 reps
 * the estimate is too unreliable, so none is produced; unknown values stay
 * unknown instead of becoming 0.
 */
export const MAX_ESTIMATE_REPS = 12;
export type LoadedSet = { date: string; weightKg: number | null; reps: number | null;
  status?: "done" | "skipped" | "voided" };
/** The estimate always carries the exact set it was computed from. */
export type OneRepMaxEstimate<T extends LoadedSet = LoadedSet> = { kg: number; set: T };

export function estimateOneRepMax<T extends LoadedSet>(set: T): OneRepMaxEstimate<T> | null {
  const { weightKg: weight, reps } = set;
  if ((set.status ?? "done") !== "done" || weight === null || reps === null || !(weight > 0) ||
    !Number.isInteger(reps) || reps < 1 || reps > MAX_ESTIMATE_REPS) return null;
  return { kg: Math.round(weight * 36 / (37 - reps) * 10) / 10, set };
}

/** Highest estimate; on a tie the earliest set, i.e. the one that first reached it. */
export function bestOneRepMax<T extends LoadedSet>(sets: T[]): OneRepMaxEstimate<T> | null {
  let best: OneRepMaxEstimate<T> | null = null;
  for (const set of sets) {
    const estimate = estimateOneRepMax(set);
    if (estimate && (!best || estimate.kg > best.kg || (estimate.kg === best.kg && set.date < best.set.date))) best = estimate;
  }
  return best;
}
