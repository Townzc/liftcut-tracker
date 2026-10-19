import type { AiTrainingPlan } from "../ai-schemas";
import type { Equipment } from "../exercise-catalog";
import { reviewProblems, reviewSchema, type ReviewChange } from "../review-changes";
import type { ReviewSet } from "../review-prompt";

/**
 * Replay scoring for post-workout reviews (M2-5). A case's `expect` is fixed by the
 * synthetic generator before any model answer is seen: whether the sets show a pattern
 * that warrants a change, and in which direction.
 */
export type ReviewCase = { id: string; kind: string; plan: AiTrainingPlan; sets: ReviewSet[]; equipment: Equipment[];
  expect: { change: false } | { change: true; exercise: string; direction: "up" | "down" } };
export type ReviewScore = {
  cases: number; answered: number; typeValid: number;
  /** Cited set ids that exist and belong to the cited exercise, over all citations in schema-valid answers; null when nothing was cited. */
  evidenceReal: number | null;
  /** Answers that pass every check, i.e. would be shown to the user. */
  shown: number;
  /** A shown change where the case warrants none: the review's main failure. */
  unwarrantedChanges: number;
  /** A warranted change that was not shown (nochange, invalid or missing answer). */
  missedChanges: number;
  /** A shown sets/RPE change on the warranted case that goes the other way. */
  wrongDirection: number;
  problems: Record<string, number>;
};

const direction = (c: ReviewChange) => c.type === "adjust_sets" || c.type === "adjust_rpe" ? (c.delta > 0 ? "up" : "down") : null;

export function scoreReviews(cases: readonly ReviewCase[], answers: ReadonlyMap<string, unknown>): ReviewScore {
  const score: ReviewScore = { cases: cases.length, answered: 0, typeValid: 0, evidenceReal: null, shown: 0, unwarrantedChanges: 0, missedChanges: 0, wrongDirection: 0, problems: {} };
  let cited = 0, real = 0;
  for (const c of cases) {
    if (answers.has(c.id)) score.answered++;
    const parsed = reviewSchema.safeParse(answers.get(c.id));
    if (!parsed.success) { if (c.expect.change) score.missedChanges++; continue; }
    score.typeValid++;
    const sets = new Map(c.sets.map(s => [s.id, s.exercise])), review = parsed.data;
    for (const x of review.outcome === "nochange" ? [{ exercise: null, evidence: review.evidence }] : review.changes)
      for (const id of x.evidence) { cited++; if (sets.has(id) && (x.exercise === null || sets.get(id) === x.exercise)) real++; }
    const problems = reviewProblems(c.plan, review, { sets, equipment: c.equipment });
    for (const p of problems) { const kind = p.split(":")[0]; score.problems[kind] = (score.problems[kind] ?? 0) + 1; }
    if (problems.length) { if (c.expect.change) score.missedChanges++; continue; }
    score.shown++;
    const changes = review.outcome === "changes" ? review.changes : [];
    if (!c.expect.change) { if (changes.length) score.unwarrantedChanges++; continue; }
    if (!changes.length) score.missedChanges++;
    const expected = c.expect.direction;
    if (changes.some(x => direction(x) !== null && direction(x) !== expected)) score.wrongDirection++;
  }
  score.evidenceReal = cited ? Math.round(real / cited * 1000) / 1000 : null;
  return score;
}
