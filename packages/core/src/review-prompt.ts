import type { AiTrainingPlan } from "./ai-schemas";
import { replacementCandidates, type Equipment } from "./exercise-catalog";
import { allowModelRows } from "./model-data";
import { ruleForExercise } from "./progression";

/**
 * What a post-workout review model is sent (M2-3), shared by the server and the
 * replay evaluation (M2-5) so a recorded answer always matches the live prompt.
 */
export const REVIEW_SYSTEM = `You review one finished workout against the user's current training plan. Reply with one JSON object only:
{"outcome":"nochange","why":W,"evidence":[set ids]} or {"outcome":"changes","changes":[...]} with at most 5 changes of these types only:
{"type":"adjust_sets","exercise":E,"delta":-1|1,"why":W,"evidence":[...]}
{"type":"adjust_rpe","exercise":E,"delta":-0.5|0.5,"why":W,"evidence":[...]}
{"type":"switch_rule","exercise":E,"to":"linear"|"double","why":W,"evidence":[...]}
{"type":"replace_exercise","exercise":E,"replacement":one id from that exercise's candidates,"why":W,"evidence":[...]}
E is a plan exercise name copied exactly. Evidence lists ids of sets of that exercise from the input. W is one short sentence in the user's language.
Never propose loads or rep numbers: the progression engine computes them. Prefer nochange unless the sets clearly show a pattern (repeated misses, every set easy).`;

/** One saved set the review may cite; unknown values stay null. */
export type ReviewSet = { id: string; date: string; exercise: string; setIndex: number; status: "done" | "skipped";
  weightKg: number | null; reps: number | null; rpe: number | null };

/** The review's user message: plan targets and saved sets, each through the model-data allowlist. */
export function reviewMessage(plan: AiTrainingPlan, sets: readonly ReviewSet[], locale: "zh" | "en", equipment: readonly Equipment[]): string {
  const all = plan.weeks.flatMap(w => w.days.flatMap(d => d.exercises));
  const exercises = [...new Set(all.map(e => e.name))].map(name => {
    const e = all.find(x => x.name === name)!;
    return { exercise: name, targetSets: e.sets, targetReps: e.rep_range, targetRpe: e.target_rpe,
      rule: ruleForExercise({ sets: e.sets, repRange: e.rep_range })?.kind ?? null,
      candidates: replacementCandidates(name, [...equipment]).slice(0, 5).map(c => ({ id: c.id, name: locale === "en" ? c.en : c.zh })) };
  });
  return JSON.stringify({ locale, plan: allowModelRows("plan", exercises), sets: allowModelRows("workout", sets) });
}
