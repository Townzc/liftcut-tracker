import "server-only";
import type { Pool } from "pg";
import { z } from "zod";
import type { AiTrainingPlan } from "@liftcut/core/ai-schemas";
import { equipmentIds, type Equipment } from "@liftcut/core/exercise-catalog";
import { REVIEW_SYSTEM, reviewMessage, type ReviewSet } from "@liftcut/core/review-prompt";
import { samePlain } from "@liftcut/core/plain-data";
import { applyReview, reviewProblems, reviewSchema, type Review } from "@liftcut/core/review-changes";
import type { ReviewOutcome } from "@liftcut/core/review-client";
import { COACH_CONSENT_VERSION } from "@/lib/coach-model";
import type { AgentStore } from "@/services/agent/store";
import { beginOwnerTransaction } from "@/services/owner-transaction";

/**
 * Post-workout review (M2-3), run only when the user asks. The model sees the
 * finished and recent sets (allowlisted fields) and the plan's exercises, and may
 * answer only with the closed review types. A valid change list becomes an ordinary
 * approval-ledger proposal; nothing is applied until the user approves it there.
 */
// Equipment is chosen by the user, as in the replacement sheet; without it no replacement is offered.
export const reviewRequestSchema = z.strictObject({ sessionId: z.uuid(), requestKey: z.uuid(), consent: z.literal(COACH_CONSENT_VERSION),
  locale: z.enum(["zh", "en"]), timezone: z.string().max(100), equipment: z.array(z.enum(equipmentIds)).max(equipmentIds.length).default([]) });
export type ReviewModel = (prompt: { system: string; user: string }) => Promise<unknown>;
export type { ReviewOutcome }; // Shared with the web and mobile review cards.

/** Sets of the finished session and the four before it that share an exercise; skipped sets count as evidence too. */
async function readSets(pool: Pool, owner: string, sessionId: string): Promise<ReviewSet[]> {
  const db = await pool.connect();
  try {
    await beginOwnerTransaction(db, owner, "liftcut_workout");
    const rows = (await db.query(`with target as (select local_date,started_at,prescription from public.workout_sessions where id=$1 and status='ended'),
      names as (select distinct e->>'name' as name from target t cross join lateral jsonb_array_elements(t.prescription->'exercises') e),
      recent as (select s.id from public.workout_sessions s, target t where s.status='ended' and (s.local_date,s.started_at)<=(t.local_date,t.started_at)
        and exists(select 1 from jsonb_array_elements(s.prescription->'exercises') e where e->>'name' in (select name from names))
        order by s.local_date desc,s.started_at desc limit 5)
      select l.id,s.local_date::text as date,l.exercise_name as exercise,l.set_index as "setIndex",l.status,l.weight_kg as "weightKg",l.reps,l.rpe
      from public.set_logs l join public.workout_sessions s on s.id=l.session_id
      where l.session_id in (select id from recent) and l.status in ('done','skipped') and l.exercise_name in (select name from names)
      order by s.local_date desc,s.started_at desc,l.exercise_name,l.set_index limit 120`, [sessionId])).rows;
    await db.query("commit");
    return rows.map(r => ({ ...r, weightKg: r.weightKg === null ? null : Number(r.weightKg), rpe: r.rpe === null ? null : Number(r.rpe) }) as ReviewSet);
  } catch (error) { await db.query("rollback").catch(() => {}); throw error; } finally { db.release(); }
}

export async function reviewWorkout(owner: string, input: unknown, deps: { pool: Pool; agent: AgentStore; model: ReviewModel }): Promise<ReviewOutcome> {
  const request = reviewRequestSchema.parse(input);
  const sets = await readSets(deps.pool, owner, request.sessionId);
  if (!sets.length) return { status: "unavailable", error: "NO_FINISHED_SETS" };
  const snapshot = await deps.agent.planContext(owner, "training", undefined, request.timezone);
  // Only plans created through the ledger have an editable copy to change; older plans keep their own editor.
  if (!snapshot.editable) return { status: "unavailable", error: "PLAN_NOT_EDITABLE" };
  const plan = snapshot.editable.plan as AiTrainingPlan, context = snapshot.editable.context, equipment: Equipment[] = request.equipment;
  const raw = await deps.model({ system: REVIEW_SYSTEM, user: reviewMessage(plan, sets, request.locale, equipment) });
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) return { status: "invalid", problems: ["schema"] };
  const problems = reviewProblems(plan, parsed.data, { sets: new Map(sets.map(s => [s.id, s.exercise])), equipment });
  if (problems.length) return { status: "invalid", problems };
  if (parsed.data.outcome === "nochange") return { status: "nochange", review: parsed.data };
  const prepared = await deps.agent.prepare(owner, request.requestKey, snapshot, context, applyReview(plan, parsed.data.changes),
    { type: "workout_review", data: { sessionId: request.sessionId, review: parsed.data, basePlan: plan } });
  if (!prepared.ok) return { status: "unavailable", error: prepared.error };
  return { status: "proposed", review: parsed.data, run: prepared.value };
}

const noteSchema = z.object({ sessionId: z.uuid(), review: reviewSchema, basePlan: z.custom<AiTrainingPlan>(v => !!v && typeof v === "object"),
  acceptedFrom: z.uuid().optional() });
export const acceptRequestSchema = z.strictObject({ runId: z.uuid(), requestKey: z.uuid(), timezone: z.string().max(100),
  accepted: z.array(z.number().int().min(0).max(4)).min(1).max(5).refine(xs => new Set(xs).size === xs.length) });
export const rollbackRequestSchema = z.strictObject({ runId: z.uuid(), requestKey: z.uuid(), timezone: z.string().max(100) });
type Deps = { agent: AgentStore };

async function reviewNote(agent: AgentStore, owner: string, runId: string) {
  const note = noteSchema.safeParse(await agent.annotation(owner, runId, "workout_review"));
  return note.success && note.data.review.outcome === "changes" ? { ...note.data, changes: note.data.review.changes } : null;
}

/**
 * Accepting some of a review's changes is a new preview of the base plan with only
 * those changes; it supersedes the review's preview. Accepting all keeps the original.
 * Either way the user still approves and applies it through the ledger.
 */
export async function acceptReview(owner: string, input: unknown, deps: Deps): Promise<ReviewOutcome> {
  const request = acceptRequestSchema.parse(input), note = await reviewNote(deps.agent, owner, request.runId);
  if (!note || request.accepted.some(i => i >= note.changes.length)) return { status: "unavailable", error: "REVIEW_NOT_FOUND" };
  const subset = [...request.accepted].sort((a, b) => a - b).map(i => note.changes[i]), review: Review = { outcome: "changes", changes: subset };
  // A retry returns the preview the first request made, even though that request closed the review's own preview.
  const replay = await deps.agent.byRequestKey(owner, request.requestKey);
  if (replay) return (await reviewNote(deps.agent, owner, replay.id))?.acceptedFrom === request.runId
    ? { status: "proposed", review, run: replay } : { status: "unavailable", error: "KEY_CONFLICT" };
  const current = await deps.agent.get(owner, request.runId);
  if (current.ok && current.value.status === "stale") return { status: "unavailable", error: "CONTEXT_STALE" };
  // Accepting all keeps the review's own preview, also once it is applied, so a retry stays harmless.
  if (current.ok && subset.length === note.changes.length && ["awaiting_approval", "approved", "applied"].includes(current.value.status))
    return { status: "proposed", review: note.review, run: current.value };
  if (!current.ok || !["awaiting_approval", "approved"].includes(current.value.status)) return { status: "unavailable", error: "REVIEW_CLOSED" };
  // The review's preview is still fresh, so the plan has not changed since the review was made.
  const snapshot = await deps.agent.planContext(owner, "training", request.runId, request.timezone);
  if (!snapshot.draft || !snapshot.editable) return { status: "unavailable", error: "CONTEXT_STALE" };
  const prepared = await deps.agent.prepare(owner, request.requestKey, snapshot, snapshot.editable.context, applyReview(note.basePlan, subset),
    { type: "workout_review", data: { sessionId: note.sessionId, review, basePlan: note.basePlan, acceptedFrom: request.runId } });
  return prepared.ok ? { status: "proposed", review, run: prepared.value } : { status: "unavailable", error: prepared.error };
}

/** Undo is a compensating preview that restores the plan from before the review; it never deletes history. */
export async function rollbackReview(owner: string, input: unknown, deps: Deps): Promise<ReviewOutcome> {
  const request = rollbackRequestSchema.parse(input), note = await reviewNote(deps.agent, owner, request.runId);
  if (!note) return { status: "unavailable", error: "REVIEW_NOT_APPLIED" };
  const replay = await deps.agent.byRequestKey(owner, request.requestKey);
  if (replay) return z.object({ from: z.uuid() }).safeParse(await deps.agent.annotation(owner, replay.id, "workout_review_rollback")).data?.from === request.runId
    ? { status: "proposed", review: note.review, run: replay } : { status: "unavailable", error: "KEY_CONFLICT" };
  const applied = await deps.agent.get(owner, request.runId);
  if (!applied.ok || applied.value.status !== "applied" || !applied.value.proposal) return { status: "unavailable", error: "REVIEW_NOT_APPLIED" };
  const snapshot = await deps.agent.planContext(owner, "training", undefined, request.timezone);
  // Only while the reviewed plan is still the current one: later edits are never silently undone.
  if (!snapshot.editable || !samePlain(snapshot.editable.plan, applied.value.proposal.plan)) return { status: "unavailable", error: "CONTEXT_STALE" };
  const prepared = await deps.agent.prepare(owner, request.requestKey, snapshot, snapshot.editable.context, note.basePlan,
    { type: "workout_review_rollback", data: { from: request.runId } });
  return prepared.ok ? { status: "proposed", review: note.review, run: prepared.value } : { status: "unavailable", error: prepared.error };
}
