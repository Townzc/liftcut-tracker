import { z } from "zod";
import { COACH_CONSENT_VERSION } from "./coach-chat";
import { guestFactsSchema, personalCommandSchema } from "./personal-records";
import { contextSchema, bindingSchema, planSchema, nutritionPlanSchema } from "./agent-contracts";
import { operationBody, type WorkoutOperation } from "./workout-outbox";
import { workoutReviewApprovalSchema, type WorkoutReview } from "./workout-review";
import type { Session } from "./today";
import type { LogDraft } from "./workout-log-parser";

// Transport contracts only. Parsing a reply never authorizes or performs a write.
export const coachMessageSchema = z.strictObject({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(2400) });
export const coachRequestSchema = z.strictObject({
  id: z.uuid(), text: z.string().trim().min(1).max(400), history: z.array(coachMessageSchema).max(12),
  locale: z.enum(["zh", "en"]), timezone: z.string().max(100).refine(v => {
    try { new Intl.DateTimeFormat("en", { timeZone: v }); return true; } catch { return false; }
  }), consent: z.literal(COACH_CONSENT_VERSION), selectedExerciseId: z.string().max(150).optional(),
  planRunId: z.uuid().optional(), guestRecords: guestFactsSchema.optional(),
  // Older clients remain valid and keep their legacy, non-continuous tool path.
  conversationId: z.uuid().optional(),
});
export type CoachRequest = z.infer<typeof coachRequestSchema>;
export type CoachMessage = z.infer<typeof coachMessageSchema>;
export type CoachInput = Omit<CoachRequest, "consent">;
const object = z.record(z.string(), z.unknown()), positive = z.number().int().positive();
const quantity = z.number().nonnegative().nullable();
const provenance = z.enum(["user_entered", "user_confirmed_prefill", "user_said"]).nullable();
const storedSet = z.looseObject({
  id: z.uuid(), sessionId: z.uuid(), planExerciseId: z.string().min(1), setIndex: positive, revision: positive,
  status: z.enum(["done", "skipped", "voided"]), weightKg: quantity, reps: z.number().int().nonnegative().nullable(),
  rpe: z.number().min(1).max(10).nullable(), inputUnit: z.enum(["kg", "lb"]), sourceRef: z.string(),
  weightSource: provenance, repsSource: provenance, perHandLoad: z.strictObject({ value: z.number().nonnegative(), unit: z.enum(["kg", "lb"]) }).optional(),
});
const session: z.ZodType<Session> = z.looseObject({
  id: z.uuid(), userId: z.uuid(), localDate: z.string(), timezone: z.string(), trainingPlanId: z.string(),
  weekNumber: positive, dayNumber: positive, status: z.enum(["active", "ended", "cancelled"]), revision: positive,
  startedAt: z.string(), endedAt: z.string().nullable(),
  prescription: z.looseObject({ title: z.string(), exercises: z.array(z.looseObject({
    id: z.string(), name: z.string(), sets: positive, repRange: z.string(), targetRpe: z.number(),
  })) }), sets: z.array(storedSet.extend({ exerciseName: z.string(), updatedAt: z.string() })),
});
const draft: z.ZodType<LogDraft> = z.discriminatedUnion("kind", [
  z.looseObject({ kind: z.literal("record"), exerciseId: z.string(), explicit: z.boolean(), sets: z.array(z.looseObject({
    setIndex: positive, weightKg: quantity, reportedWeight: quantity, inputUnit: z.enum(["kg", "lb"]).nullable(),
    reps: z.number().int().nonnegative(), rpe: z.number().nullable(),
  })) }),
  z.looseObject({ kind: z.literal("correct"), exerciseId: z.string(), explicit: z.literal(true), recordId: z.uuid(),
    revision: positive, setIndex: positive, changes: z.strictObject({ reps: z.number().int().nonnegative() }) }),
  z.looseObject({ kind: z.literal("skip"), exerciseId: z.string(), setIndex: positive, explicit: z.literal(true) }),
  z.looseObject({ kind: z.literal("end"), explicit: z.literal(false) }),
]);
const review: z.ZodType<WorkoutReview> = z.looseObject({
  id: z.uuid(), conversationId: z.uuid(), sessionId: z.uuid(), requestId: z.uuid(), basis: z.string(),
  kind: z.enum(["record", "correct", "inherit_weight", "void", "skip"]), text: z.string(),
  before: z.array(storedSet.nullable()), requests: z.array(storedSet).min(1),
  references: z.array(z.strictObject({ sessionId: z.uuid(), recordId: z.uuid(), exerciseId: z.string(), setIndex: positive, revision: positive })),
  model: z.strictObject({ provider: z.string(), model: z.string(), version: z.literal("coach-v1") }).optional(),
}).refine(r => r.before.length === r.requests.length, "Review rows must align");
const legacyOperation = z.strictObject({ action: z.enum(["apply", "end"]), body: z.unknown() })
  .refine(v => { try { operationBody(v as WorkoutOperation); return true; } catch { return false; } }, "Invalid operation");
const receipt = z.looseObject({ id: z.string(), runId: z.string(), proposalId: z.string(), contentHash: z.string(),
  approvalId: z.string(), contextRevision: z.number(), planId: z.string(), committedAt: z.string(),
  kind: z.enum(["training", "nutrition"]).optional(), appliedStateHash: z.string().optional() });
const run = z.looseObject({ id: z.string(), version: z.string(),
  status: z.enum(["planning", "awaiting_approval", "approved", "revoked", "declined", "applied", "stale", "budget_exhausted"]),
  revision: z.number(), contextRevision: z.number(), kind: z.enum(["training", "nutrition"]), baseline: z.array(object),
  context: contextSchema, attempts: z.number(), approvalId: z.string().nullable(),
  proposal: bindingSchema.extend({ version: positive, plan: z.union([planSchema, nutritionPlanSchema]) }).nullable(),
  receipt: receipt.nullable(), events: z.array(z.looseObject({ sequence: z.string(), type: z.string(), actor: z.string(), data: z.unknown(), at: z.string() })),
});
export const coachProposalSchema = z.discriminatedUnion("kind", [
  z.looseObject({ kind: z.literal("personal"), command: personalCommandSchema.options[0] }),
  z.looseObject({ kind: z.literal("workout"), session, hash: z.string(), draft, operation: legacyOperation }),
  z.looseObject({ kind: z.literal("workoutReview"), session, hash: z.string(), review,
    operation: z.strictObject({ action: z.literal("review"), body: workoutReviewApprovalSchema }) }),
  z.looseObject({ kind: z.literal("plan"), run }),
]).superRefine((p, ctx) => {
  if (p.kind !== "workoutReview") return;
  const b = p.operation.body, r = p.review;
  if (b.id !== r.id || b.conversationId !== r.conversationId || b.sessionId !== r.sessionId || r.sessionId !== p.session.id
    || r.requests.some(s => s.sessionId !== r.sessionId) || r.references.some(s => s.sessionId !== r.sessionId))
    ctx.addIssue({ code: "custom", message: "Review identity mismatch" });
});
export const coachSourceSchema = z.looseObject({ id: z.string(), topic: z.string(), from: z.string(), to: z.string(),
  readAt: z.string(), rows: z.array(object), summary: object, truncated: z.boolean() });
export const coachResponseSchema = z.looseObject({ requestId: z.uuid(), message: z.string(), model: z.string(), provider: z.string(),
  sources: z.array(coachSourceSchema), proposal: coachProposalSchema.optional() }).superRefine((r, ctx) => {
  if (r.proposal?.kind === "workoutReview" && r.proposal.review.requestId !== r.requestId)
    ctx.addIssue({ code: "custom", message: "Review request mismatch" });
});
export type CoachSource = z.infer<typeof coachSourceSchema>;
export type CoachProposal = z.infer<typeof coachProposalSchema>;
export type CoachResponse = z.infer<typeof coachResponseSchema>;
export type CoachStatus = { available: boolean; provider: string | null; model: string | null; consentVersion: typeof COACH_CONSENT_VERSION };
