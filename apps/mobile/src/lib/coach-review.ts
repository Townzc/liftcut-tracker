import type { CoachProposal } from "@liftcut/core/coach-contract";
import { operationId, type OutboxState } from "@liftcut/core/workout-outbox";
import { storedSet, workoutCanonical } from "@liftcut/core/workout-context";

export type ReviewProposal = Extract<CoachProposal, { kind: "workoutReview" }>;
/** Only a queue entry or exact server-confirmed rows determine this label. */
export function reviewWriteState(p: ReviewProposal, state: OutboxState | null) {
  if (!state || state.owner !== p.session.userId) return "unknown";
  const item = state.items.find(i => i.id === operationId(p.operation));
  if (item) return item.status === "conflict" || item.status === "auth" ? "failed" : "pending";
  const session = state.confirmed?.session;
  return session?.id === p.review.sessionId && p.review.requests.every(r => session.sets.some(s =>
    workoutCanonical(storedSet(s)) === workoutCanonical(r))) ? "saved" : "unknown";
}
