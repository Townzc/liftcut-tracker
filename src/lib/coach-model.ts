import type { CoachResponse as SharedCoachResponse } from "@liftcut/core/coach-contract";
import type { CoachTiming } from "./coach-timing";

export { COACH_CONSENT_VERSION, conversationHistory } from "@liftcut/core/coach-chat";
export { coachMessageSchema, coachRequestSchema, coachResponseSchema, coachProposalSchema } from "@liftcut/core/coach-contract";
export type { CoachRequest, CoachMessage, CoachSource, CoachProposal, CoachStatus } from "@liftcut/core/coach-contract";
// Optional diagnostic metadata is not an approval or a write receipt.
export type CoachResponse = SharedCoachResponse & { timing?: CoachTiming };
