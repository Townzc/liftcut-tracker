import { z } from "zod";
import type { Session, StoredSet } from "./today";
import type { ConfirmedSetReference } from "./confirmed-set-reference";
import { workoutCanonical } from "./workout-context";

/** The client approves an immutable server preview, never supplies write values. */
export const workoutReviewApprovalSchema = z.strictObject({
  id: z.uuid(), conversationId: z.uuid(), sessionId: z.uuid(), version: z.literal(1),
  authorization: z.literal("confirm_preview"),
});
export type WorkoutReviewApproval = z.infer<typeof workoutReviewApprovalSchema>;
export type WorkoutReview = {
  id: string; conversationId: string; sessionId: string; requestId: string;
  basis: string; kind: "record" | "correct" | "inherit_weight" | "void" | "skip";
  before: (StoredSet | null)[]; requests: StoredSet[]; references: ConfirmedSetReference[]; text: string;
  model?: { provider: string; model: string; version: "coach-v1" };
};
export type WorkoutConversationState = {
  focus: ConfirmedSetReference | null;
  // Unconfirmed prose is context for clarification, never a source of saved actuals.
  pendingText: string | null;
};
export const reviewBasis = (s: Session) => workoutCanonical({ id: s.id, userId: s.userId, status: s.status,
  revision: s.revision, prescription: s.prescription, sets: [...s.sets].sort((a,b)=>a.id.localeCompare(b.id)) });
export const referenceFor = (s: StoredSet): ConfirmedSetReference => ({ sessionId: s.sessionId,
  recordId: s.id, exerciseId: s.planExerciseId, setIndex: s.setIndex, revision: s.revision });
