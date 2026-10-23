import { randomUUID } from "node:crypto";
import { COACH_CONSENT_VERSION } from "@liftcut/core/coach-chat";
import type { CoachRequest, CoachResponse } from "@liftcut/core/coach-contract";
import type { Session, StoredSet } from "@liftcut/core/today";
import { workoutCanonical, workoutContextInput } from "@liftcut/core/workout-context";
import { createHash } from "node:crypto";
import { reviewBasis, type WorkoutReview } from "@liftcut/core/workout-review";

/** Synthetic wire fixture shared by Node and the mobile transport tests. */
export function coachFixture() {
  const request: CoachRequest = { id: randomUUID(), text: "合成测试", history: [], locale: "zh", timezone: "UTC",
    consent: COACH_CONSENT_VERSION, conversationId: randomUUID() };
  const session: Session = { id: randomUUID(), userId: randomUUID(), localDate: "2026-10-22", timezone: "UTC",
    trainingPlanId: randomUUID(), weekNumber: 1, dayNumber: 1, status: "active", revision: 1,
    prescription: { title: "Contract fixture", exercises: [{ id: "row", name: "坐姿划船", sets: 3, repRange: "9", targetRpe: 7 }] },
    startedAt: "2026-10-22T00:00:00Z", endedAt: null, sets: [] };
  const set: StoredSet = { id: randomUUID(), sessionId: session.id, planExerciseId: "row", setIndex: 1, revision: 1,
    status: "done", weightKg: null, reps: 9, rpe: null, inputUnit: "kg", sourceRef: request.id,
    weightSource: null, repsSource: "user_said" };
  const review: WorkoutReview = { id: randomUUID(), conversationId: request.conversationId!, sessionId: session.id,
    requestId: request.id, basis: reviewBasis(session), kind: "record", before: [null], requests: [set], references: [], text: request.text,
    model: { provider: "fixture", model: "fixture", version: "coach-v1", sourceTexts: [request.text] } };
  const hash = createHash("sha256").update(workoutCanonical(workoutContextInput(session))).digest("hex");
  const reply: CoachResponse = { requestId: request.id, message: "请确认", model: "fixture", provider: "fixture", sources: [],
    proposal: { kind: "workoutReview", session, hash, review, operation: { action: "review", body: {
      id: review.id, conversationId: review.conversationId, sessionId: session.id, version: 1, authorization: "confirm_preview",
    } } } };
  return { request, session, set, review, hash, reply };
}
