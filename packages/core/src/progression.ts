/**
 * Deterministic next-session targets, computed only from confirmed actual sets.
 * Pure fold over the history: no stored counters, so correcting a record changes
 * the next target immediately. Prescriptions, prefills and model output never
 * enter. A missing, skipped, voided or unknown (null) set counts as not achieved
 * and never advances a target.
 */

export type Unit = "kg" | "lb";
/** One stored actual row; weights are always stored in kg. */
export type ActualSet = { setIndex: number; status: "done" | "skipped" | "voided";
  weightKg: number | null; reps: number | null; seconds?: number | null };
export type ExerciseSession = { date: string; sets: ActualSet[] };
export type ExternalLoad = { increment: number; unit: Unit };
export type Deload = { afterMisses: number; percent: number };
export type ProgressionRule = { sets: number; deload?: Deload } & (
  | { kind: "linear"; reps: number; load: ExternalLoad }
  | { kind: "double"; minReps: number; maxReps: number; load: ExternalLoad | "bodyweight" }
  | { kind: "timed"; seconds: number; incrementSeconds: number; maxSeconds: number });
export type Outcome = "no_data" | "baseline" | "increase" | "progress_reps" | "hold" | "deload" | "top_of_range";
export type Miss = { set: number; reason: "missing" | "skipped" | "no_weight" | "no_reps" | "no_seconds" |
  "short_reps" | "light" | "short_time"; got?: number; want?: number };
export type NextTarget = {
  kind: ProgressionRule["kind"]; sets: number; outcome: Outcome;
  /** External load in `unit`; null for bodyweight, timed, or when no weight was ever confirmed. */
  weight: number | null; weightKg: number | null; unit: Unit | null;
  reps: number | null; repRange: [number, number] | null; seconds: number | null;
  /** Consecutive sessions that missed the current target. */
  misses: number; miss: Miss | null;
  /** The last session the target was computed from, for traceability. */
  basis: ExerciseSession | null;
  why: { zh: string; en: string };
};

export const DEFAULT_DELOAD: Deload = { afterMisses: 3, percent: 10 };
const LB_KG = 0.45359237;
const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const toUnit = (kg: number, unit: Unit) => round(unit === "kg" ? kg : kg / LB_KG);
const floorTo = (n: number, step: number) => round(Math.floor(n / step + 1e-9) * step);
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function check(rule: ProgressionRule, session: ExerciseSession, weight: number | null, seconds: number | null) {
  const unit = rule.kind !== "timed" && rule.load !== "bodyweight" ? rule.load.unit : null;
  const minReps = rule.kind === "linear" ? rule.reps : rule.kind === "double" ? rule.minReps : null;
  let miss: Miss | null = null, working: number | null = null, low: number | null = null;
  const fail = (m: Miss) => { miss ??= m; };
  for (let set = 1; set <= rule.sets; set++) {
    const row = session.sets.filter(r => r.setIndex === set && r.status !== "voided").at(-1);
    if (!row) { fail({ set, reason: "missing" }); continue; }
    if (row.status === "skipped") { fail({ set, reason: "skipped" }); continue; }
    if (seconds !== null) {
      const got = row.seconds ?? null;
      if (got === null) fail({ set, reason: "no_seconds" });
      else if (got < seconds) fail({ set, reason: "short_time", got, want: seconds });
      continue;
    }
    if (unit) {
      if (row.weightKg === null) { fail({ set, reason: "no_weight" }); continue; }
      const got = toUnit(row.weightKg, unit);
      working = working === null ? got : Math.min(working, got);
      if (weight !== null && got < weight) fail({ set, reason: "light", got, want: weight });
    }
    if (row.reps === null) { fail({ set, reason: "no_reps" }); continue; }
    low = low === null ? row.reps : Math.min(low, row.reps);
    if (minReps !== null && row.reps < minReps) fail({ set, reason: "short_reps", got: row.reps, want: minReps });
  }
  return { miss: miss as Miss | null, working, low };
}

export function nextTarget(rule: ProgressionRule, history: ExerciseSession[]): NextTarget {
  const deload = rule.deload ?? DEFAULT_DELOAD;
  const load = rule.kind === "timed" || rule.load === "bodyweight" ? null : rule.load;
  const range: [number, number] | null = rule.kind === "linear" ? [rule.reps, rule.reps]
    : rule.kind === "double" ? [rule.minReps, rule.maxReps] : null;
  const sessions = [...history].sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  let weight: number | null = null, seconds = rule.kind === "timed" ? rule.seconds : null, reps = range?.[0] ?? null;
  let misses = 0, outcome: Outcome = "no_data", miss: Miss | null = null, before: number | null = null, low: number | null = null;
  let basis: ExerciseSession | null = null;
  for (const session of sessions) {
    const result = check(rule, session, weight, seconds);
    const first = load !== null && weight === null;
    if (first && result.working !== null) weight = result.working;
    basis = session; miss = result.miss; low = result.low; before = rule.kind === "timed" ? seconds : weight;
    if (load && weight === null) { outcome = "no_data"; continue; }
    if (miss) {
      misses++; outcome = first ? "baseline" : "hold";
      if (misses < deload.afterMisses) continue;
      misses = 0; outcome = "deload"; reps = range?.[0] ?? null;
      const factor = 1 - deload.percent / 100;
      if (load && weight !== null && floorTo(weight * factor, load.increment) > 0) weight = floorTo(weight * factor, load.increment);
      if (rule.kind === "timed" && seconds !== null) seconds = Math.max(rule.incrementSeconds, floorTo(seconds * factor, rule.incrementSeconds));
      continue;
    }
    misses = 0;
    if (rule.kind === "timed") {
      outcome = seconds! >= rule.maxSeconds ? "top_of_range" : "increase";
      seconds = Math.min(rule.maxSeconds, seconds! + rule.incrementSeconds);
    } else if (load && weight !== null && (rule.kind === "linear" || low! >= rule.maxReps)) {
      weight = Math.max(weight, result.working!); before = weight;
      weight = round(weight + load.increment); reps = range![0]; outcome = "increase";
    } else if (rule.kind === "double") {
      if (load) weight = Math.max(weight!, result.working!);
      outcome = !load && low! >= rule.maxReps ? "top_of_range" : "progress_reps";
      reps = clamp(low! + 1, rule.minReps, rule.maxReps);
    }
  }
  const target: Omit<NextTarget, "why"> = { kind: rule.kind, sets: rule.sets, outcome,
    weight, weightKg: weight === null || !load ? null : round(load.unit === "kg" ? weight : weight * LB_KG, 3),
    unit: load?.unit ?? null, reps, repRange: range, seconds, misses, miss, basis };
  return { ...target, why: explain(rule, target, before, low, deload) };
}

const n = (v: number) => String(round(v));
function missText(m: Miss, unit: string) {
  const { set, got = 0, want = 0 } = m;
  return ({
    missing: [`第 ${set} 组没有记录`, `set ${set} was not recorded`],
    skipped: [`第 ${set} 组跳过`, `set ${set} was skipped`],
    no_weight: [`第 ${set} 组重量未记录`, `set ${set} has no recorded weight`],
    no_reps: [`第 ${set} 组次数未记录`, `set ${set} has no recorded reps`],
    no_seconds: [`第 ${set} 组时长未记录`, `set ${set} has no recorded time`],
    short_reps: [`第 ${set} 组 ${got} 次，少于 ${want} 次`, `set ${set} reached ${got} reps, below ${want}`],
    light: [`第 ${set} 组 ${n(got)} ${unit}，低于目标 ${n(want)} ${unit}`, `set ${set} used ${n(got)} ${unit}, below the ${n(want)} ${unit} target`],
    short_time: [`第 ${set} 组 ${got} 秒，少于 ${want} 秒`, `set ${set} lasted ${got} s, below ${want} s`],
  } as const)[m.reason];
}

function explain(rule: ProgressionRule, t: Omit<NextTarget, "why">, before: number | null, low: number | null, deload: Deload) {
  const u = t.unit ?? "", w = t.weight === null ? "" : `${n(t.weight)} ${u}`, b = before === null ? "" : n(before);
  const [mz, me] = t.miss ? missText(t.miss, u) : ["", ""];
  const count = `${t.misses}/${deload.afterMisses}`;
  const keep = rule.kind === "timed" ? [`${t.seconds} 秒`, `${t.seconds} s`]
    : t.weight !== null ? [w, w] : [`每组 ${t.reps} 次`, `${t.reps} reps per set`];
  const inc = rule.kind !== "timed" && rule.load !== "bodyweight" ? `${n(rule.load.increment)} ${u}` : "";
  const [min, max] = t.repRange ?? [0, 0];
  const why = (zh: string, en: string) => ({ zh, en });
  switch (t.outcome) {
    case "no_data":
      if (rule.kind === "timed") return why(`还没有确认记录，按处方 ${t.seconds} 秒开始。`, `No confirmed sets yet; start with the prescribed ${t.seconds} s.`);
      if (rule.kind === "double" && rule.load === "bodyweight") return why(`还没有确认记录，每组先做到 ${min} 次。`, `No confirmed sets yet; aim for ${min} reps per set.`);
      return why(`${t.miss ? `上次${mz}。` : ""}还没有确认过的重量，先选一个能完成处方次数的重量；不推算数字。`,
        `${t.miss ? `Last time ${me}. ` : ""}No confirmed weight yet; pick a load you can complete for the prescribed reps. No number is inferred.`);
    case "baseline":
      return why(`首次确认记录：${mz}；以 ${w} 为基准再试一次（连续未达成 ${count}）。`,
        `First confirmed session: ${me}; repeat ${w} as the baseline (${count} misses in a row).`);
    case "hold":
      return why(`上次${mz}，保持 ${keep[0]}（连续未达成 ${count}，到 ${deload.afterMisses} 次减载）。`,
        `Last time ${me}; stay at ${keep[1]} (${count} misses in a row; deload at ${deload.afterMisses}).`);
    case "deload":
      return why(`连续 ${deload.afterMisses} 次未达成（最近一次：${mz}），减载 ${deload.percent}% 到 ${keep[0]}。`,
        `Missed ${deload.afterMisses} sessions in a row (latest: ${me}); deload ${deload.percent}% to ${keep[1]}.`);
    case "increase":
      if (rule.kind === "timed") return why(`上次每组都坚持到 ${b} 秒，下次 ${t.seconds} 秒。`, `Every set lasted ${b} s last time; next ${t.seconds} s.`);
      if (rule.kind === "linear") return why(`上次 ${t.sets} 组都以 ${b} ${u} 完成 ${min} 次，下次加 ${inc} 到 ${w}。`,
        `All ${t.sets} sets hit ${min} reps at ${b} ${u} last time; add ${inc} to ${w}.`);
      return why(`上次每组都做到 ${max} 次（${b} ${u}），下次加 ${inc} 到 ${w}，从 ${min} 次重新累积。`,
        `Every set reached ${max} reps at ${b} ${u} last time; add ${inc} to ${w} and rebuild from ${min} reps.`);
    case "progress_reps":
      return why(`上次每组都在 ${min}–${max} 次内（最少 ${low} 次）${w ? `，保持 ${w}` : ""}，下次每组争取 ${t.reps} 次。`,
        `Every set was within ${min}–${max} reps last time (lowest ${low})${w ? `; stay at ${w}` : ""}; aim for ${t.reps} reps per set.`);
    case "top_of_range":
      if (rule.kind === "timed") return why(`上次每组都坚持到 ${t.seconds} 秒，已到上限，保持。`, `Every set reached the ${t.seconds} s ceiling; hold.`);
      return why(`上次每组都做到 ${max} 次，已到次数上限；可以加负重或换更难的变式，重量不自动推算。`,
        `Every set reached ${max} reps, the top of the range; add load or a harder variation. No weight is inferred.`);
  }
}

/**
 * Default rule for a prescription row: "5" is linear, "8-12" is double progression.
 * Bodyweight is only assumed when the caller says so (e.g. a catalog entry without
 * equipment); anything else, such as "AMRAP" or "30s", gets no automatic target.
 */
export function ruleForExercise(exercise: { sets: number; repRange: string }, options: { bodyweight?: boolean; unit?: Unit } = {}): ProgressionRule | null {
  const match = /^\s*(\d{1,2})\s*(?:[-–~～至到]\s*(\d{1,2}))?\s*(?:次|reps?)?\s*$/i.exec(exercise.repRange);
  if (!match || !Number.isInteger(exercise.sets) || exercise.sets < 1) return null;
  const min = Number(match[1]), max = Number(match[2] ?? match[1]);
  if (min < 1 || max < min) return null;
  const unit = options.unit ?? "kg", load = { increment: unit === "kg" ? 2.5 : 5, unit };
  if (options.bodyweight) return { kind: "double", sets: exercise.sets, minReps: min, maxReps: max, load: "bodyweight" };
  return min === max ? { kind: "linear", sets: exercise.sets, reps: min, load } : { kind: "double", sets: exercise.sets, minReps: min, maxReps: max, load };
}

