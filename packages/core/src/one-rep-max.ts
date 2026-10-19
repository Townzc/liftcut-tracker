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

export type Best = { weightKg: number | null; oneRepMaxKg: number | null };
/** All-time bests from confirmed sets; a load without reps proves nothing and is ignored. */
export function bestOf(sets: LoadedSet[]): Best {
  const lifted = sets.filter(s => (s.status ?? "done") === "done" && s.weightKg !== null && s.weightKg > 0 && s.reps !== null && s.reps >= 1);
  return { weightKg: lifted.length ? Math.max(...lifted.map(s => s.weightKg!)) : null, oneRepMaxKg: bestOneRepMax(sets)?.kg ?? null };
}
export const mergeBest = (a: Best, b: Best): Best => ({
  weightKg: a.weightKg === null ? b.weightKg : b.weightKg === null ? a.weightKg : Math.max(a.weightKg, b.weightKg),
  oneRepMaxKg: a.oneRepMaxKg === null ? b.oneRepMaxKg : b.oneRepMaxKg === null ? a.oneRepMaxKg : Math.max(a.oneRepMaxKg, b.oneRepMaxKg),
});
export type RecordBroken = { kind: "weight" | "one_rep_max"; value: number; previous: number };
/** A record needs an earlier best to beat: a first-ever set is not called a record. */
export function recordBroken(set: LoadedSet, prior: Best): RecordBroken | null {
  if (bestOf([set]).weightKg === null) return null;
  if (prior.weightKg !== null && set.weightKg! > prior.weightKg) return { kind: "weight", value: set.weightKg!, previous: prior.weightKg };
  const estimate = estimateOneRepMax(set);
  if (estimate && prior.oneRepMaxKg !== null && estimate.kg > prior.oneRepMaxKg) return { kind: "one_rep_max", value: estimate.kg, previous: prior.oneRepMaxKg };
  return null;
}
