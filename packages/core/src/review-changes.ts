import { z } from "zod";
import type { AiTrainingPlan } from "./ai-schemas";
import { exerciseCatalog, replacementCandidates, type Equipment } from "./exercise-catalog";
import { clonePlain } from "./plain-data";
import { ruleForExercise } from "./progression";

/**
 * The closed list of changes a post-workout review may propose (plan rules 1 and 2).
 * Each change names an exercise of the current plan, says why, and cites the saved
 * sets it rests on. The model picks structure and policy only: rep ranges, sets and
 * names are computed here, loads stay with the progression engine. A new change type
 * needs a schema entry, a check in reviewProblems, an apply step and tests together.
 */
const evidence = z.array(z.string().trim().min(1).max(100)).max(12);
const change = { exercise: z.string().trim().min(1).max(120), why: z.string().trim().min(1).max(300), evidence: evidence.min(1) };
export const reviewChangeSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("adjust_sets"), ...change, delta: z.union([z.literal(-1), z.literal(1)]) }),
  z.strictObject({ type: z.literal("adjust_rpe"), ...change, delta: z.union([z.literal(-0.5), z.literal(0.5)]) }),
  z.strictObject({ type: z.literal("switch_rule"), ...change, to: z.enum(["linear", "double"]) }),
  z.strictObject({ type: z.literal("replace_exercise"), ...change, replacement: z.string().trim().min(1).max(80) }),
]);
export const reviewSchema = z.discriminatedUnion("outcome", [
  z.strictObject({ outcome: z.literal("nochange"), why: z.string().trim().min(1).max(300), evidence }),
  z.strictObject({ outcome: z.literal("changes"), changes: z.array(reviewChangeSchema).min(1).max(5) }),
]);
export type ReviewChange = z.infer<typeof reviewChangeSchema>;
export type Review = z.infer<typeof reviewSchema>;
/** What the review may cite: each saved set's ID and the plan exercise it belongs to. */
export type ReviewEvidence = { sets: ReadonlyMap<string, string>; equipment: readonly Equipment[] };

const occurrences = (plan: AiTrainingPlan, name: string) => plan.weeks.flatMap(w => w.days.flatMap(d => d.exercises.filter(e => e.name === name)));
const ruleOf = (e: { sets: number; rep_range: string }) => ruleForExercise({ sets: e.sets, repRange: e.rep_range })?.kind ?? null;

/** Every reason the review cannot be applied to this plan; empty means it may be shown for acceptance. */
export function reviewProblems(plan: AiTrainingPlan, review: Review, cited: ReviewEvidence): string[] {
  const problems: string[] = [], citations = review.outcome === "nochange" ? [{ exercise: null, evidence: review.evidence }] : review.changes;
  for (const c of citations) for (const id of c.evidence)
    if (!cited.sets.has(id)) problems.push(`evidence_missing:${id}`);
    else if (c.exercise !== null && cited.sets.get(id) !== c.exercise) problems.push(`evidence_other_exercise:${id}`);
  if (review.outcome === "nochange") return problems;
  // One change of each type per exercise; a replacement stands alone (later changes would name a removed exercise).
  const types = new Map<string, string[]>();
  for (const c of review.changes) types.set(c.exercise, [...types.get(c.exercise) ?? [], c.type]);
  for (const [name, list] of types) if (new Set(list).size !== list.length || list.includes("replace_exercise") && list.length > 1) problems.push(`conflicting_changes:${name}`);
  for (const c of review.changes) {
    const found = occurrences(plan, c.exercise);
    if (!found.length) { problems.push(`exercise_not_in_plan:${c.exercise}`); continue; }
    if (c.type === "adjust_sets" && found.some(e => e.sets + c.delta < 1 || e.sets + c.delta > 10)) problems.push(`sets_out_of_range:${c.exercise}`);
    if (c.type === "adjust_rpe" && found.some(e => e.target_rpe + c.delta < 4 || e.target_rpe + c.delta > 10)) problems.push(`rpe_out_of_range:${c.exercise}`);
    if (c.type === "switch_rule" && found.some(e => ruleOf(e) === null || ruleOf(e) === c.to)) problems.push(`rule_unchanged:${c.exercise}`);
    if (c.type === "replace_exercise" && !replacementCandidates(c.exercise, [...cited.equipment]).some(x => x.id === c.replacement))
      problems.push(`replacement_not_allowed:${c.exercise}`);
  }
  return problems;
}

/** The plan after the accepted changes. Pure: the input plan is not modified. */
export function applyReview(plan: AiTrainingPlan, accepted: readonly ReviewChange[]): AiTrainingPlan {
  const next = clonePlain(plan);
  for (const c of accepted) for (const e of occurrences(next, c.exercise)) {
    if (c.type === "adjust_sets") e.sets += c.delta;
    else if (c.type === "adjust_rpe") e.target_rpe += c.delta;
    else if (c.type === "switch_rule") {
      const [min] = e.rep_range.match(/\d{1,2}/) ?? ["8"];
      e.rep_range = c.to === "linear" ? min : `${min}-${Number(min) + 3}`; // A double range adds three reps of headroom.
    } else e.name = exerciseCatalog.find(x => x.id === c.replacement)!.zh;
  }
  return next;
}
