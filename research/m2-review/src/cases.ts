import type { AiTrainingPlan } from "@liftcut/core/ai-schemas";
import type { ReviewCase } from "@liftcut/core/eval/review-eval";
import type { ReviewSet } from "@liftcut/core/review-prompt";

/**
 * Synthetic review cases (M2-5). Labels come from the kind alone and were written
 * before any model answer existed:
 * - steady, one-bad-day, first-session, unknown-rpe: no pattern, so nochange;
 * - all-easy: every set of the reviewed exercise at the top of its range, RPE ≥ 2 under target, three sessions → up;
 * - repeated-misses: below the range at RPE ≥ 9.5 in three sessions → down.
 */
export const KINDS = ["steady", "one-bad-day", "first-session", "unknown-rpe", "all-easy", "repeated-misses"] as const;
export const PER_KIND = 8, SEED = 20261019;

function random(seed: number) { // mulberry32
  return () => { seed = seed + 0x6d2b79f5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// Weighted lifts carry a load; bodyweight ones keep weightKg null (unknown, never 0).
const POOL: { name: string; load: number | null; range: string }[] = [
  { name: "杠铃深蹲", load: 80, range: "5" }, { name: "杠铃卧推", load: 60, range: "5" }, { name: "杠铃传统硬拉", load: 100, range: "5" },
  { name: "哑铃卧推", load: 22.5, range: "8-12" }, { name: "单臂哑铃划船", load: 25, range: "8-12" }, { name: "站姿哑铃推举", load: 15, range: "8-12" },
  { name: "正握高位下拉", load: 45, range: "10-12" }, { name: "俯卧撑", load: null, range: "8-12" }, { name: "哑铃罗马尼亚硬拉", load: 20, range: "10-12" },
];
const DATES = ["2026-09-14", "2026-09-10", "2026-09-07"]; // Newest first: the finished workout, then two earlier ones.

export function buildCases(): ReviewCase[] {
  const next = random(SEED), pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)];
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(next() * 16).toString(16)).join("");
  const cases: ReviewCase[] = [];
  for (const kind of KINDS) for (let k = 0; k < PER_KIND; k++) {
    const chosen = [...POOL].sort(() => next() - 0.5).slice(0, 3), rpe = pick([7, 7.5, 8]);
    const plan: AiTrainingPlan = { plan_name: "合成计划", goal_type: "muscle_gain", summary: "合成复盘用例", reasoning_summary: "", warnings: [],
      weeks: [{ week_number: 1, focus: "", days: [{ day_number: 1, title: "A", notes: "", estimated_duration_minutes: 60,
        exercises: chosen.map(e => ({ name: e.name, sets: 3, rep_range: e.range, target_rpe: rpe, rest_seconds: 120, notes: "", alternative_exercises: [] })) }] }] };
    const target = chosen[0], sessions = kind === "first-session" ? 1 : 3, sets: ReviewSet[] = [];
    for (let s = 0; s < sessions; s++) for (const e of chosen) {
      const [lo, hi = lo] = e.range.split("-").map(Number);
      for (let i = 1; i <= 3; i++) {
        let reps = lo + Math.floor(next() * (hi - lo + 1)), effort: number | null = rpe + pick([-0.5, 0, 0, 0.5]);
        if (e === target && kind === "all-easy") { reps = hi; effort = rpe - pick([2, 2.5, 3]); }
        if (e === target && (kind === "repeated-misses" || kind === "one-bad-day" && s === 0)) { reps = Math.max(1, lo - pick([1, 2])); effort = pick([9.5, 10]); }
        if (kind === "unknown-rpe") effort = null;
        sets.push({ id: `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`, date: DATES[s], exercise: e.name, setIndex: i, status: "done",
          weightKg: e.load === null ? null : e.load + 2.5 * Math.floor(next() * 3), reps, rpe: effort });
      }
    }
    const up = kind === "all-easy", down = kind === "repeated-misses";
    cases.push({ id: `${kind}-${k + 1}`, kind, plan, sets, equipment: [],
      expect: up || down ? { change: true, exercise: target.name, direction: up ? "up" : "down" } : { change: false } });
  }
  return cases;
}
