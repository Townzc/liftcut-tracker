import { z } from "zod";
import { workoutCanonical } from "./workout-context";
import { ConfirmedContextConflict, resolveConfirmedSet, type ConfirmedSetReference } from "./confirmed-set-reference";
import type { Session } from "./today";

/** Context around an atomic parser, not a second model or a write API. Original
 * v1 labels cannot encode these distinctions; do not overload null or "last". */
const quantity = z.strictObject({ value: z.number().finite().nullable(),
  certainty: z.enum(["stated", "approximate", "unknown"]) })
  .refine(q => (q.value === null) === (q.certainty === "unknown"), "Unknown must remain null");
const load = z.strictObject({ amount: quantity, unit: z.enum(["kg", "lb"]).nullable(),
  basis: z.enum(["per_hand", "total", "unspecified"]), reference: z.enum(["literal", "previous_confirmed", "unknown"]) })
  .superRefine((v, ctx) => {
    if (v.reference !== "literal" && (v.amount.value !== null || v.unit !== null)) ctx.addIssue({ code: "custom", message: "Reference is symbolic, never a copied number" });
    if (v.reference === "literal" && (v.amount.value === null || v.unit === null)) ctx.addIssue({ code: "custom", message: "Literal load requires amount and unit" });
    if (v.amount.value !== null && (v.amount.value < 0 || v.amount.value * (v.unit === "lb" ? .45359237 : 1) > 1000)) ctx.addIssue({ code: "custom", message: "Load out of range" });
  });
const pendingSet = z.strictObject({ load, reps: quantity.refine(q => q.value === null || Number.isInteger(q.value) && q.value >= 0 && q.value <= 100),
  rpe: quantity.refine(q => q.value === null || q.value >= 1 && q.value <= 10) });
const pendingSchema = z.strictObject({ id: z.uuid(), owner: z.uuid(), sessionId: z.uuid(), revision: z.number().int().positive(),
  exerciseId: z.string().min(1), state: z.literal("pending"), sets: z.array(pendingSet).min(1).max(16) });
export type PendingWorkoutDraft = z.infer<typeof pendingSchema>;
export const parsePendingWorkoutDraft = (input: unknown) => pendingSchema.parse(input);
export type WorkoutFocus = { kind: "pending"; id: string; revision: number }
  | { kind: "confirmed"; reference: ConfirmedSetReference };
function fail(reason: string): never { throw new ConfirmedContextConflict(reason); }

/** The conversation owns focus. A model cannot supply a different ID or silently
 * fall back from a missing/edited draft to a saved record with similar numbers. */
export function resolveWorkoutFocus(session: Session, focus: WorkoutFocus, pending: PendingWorkoutDraft | null) {
  if (session.status !== "active") fail("SESSION_ENDED");
  if (focus.kind === "confirmed") return { kind: "confirmed" as const, set: resolveConfirmedSet(session, { reference: focus.reference }) };
  if (!pending) fail("PENDING_DRAFT_MISSING");
  const draft = pendingSchema.parse(pending);
  if (draft.owner !== session.userId || draft.sessionId !== session.id || draft.id !== focus.id
    || draft.revision !== focus.revision) fail("STALE_PENDING_DRAFT");
  if (!session.prescription.exercises.some(e => e.id === draft.exerciseId)) fail("EXERCISE_NOT_FOUND");
  return { kind: "pending" as const, draft };
}

/** Only edits a pending preview. No approval, DB request, actual row or source
 * record is created. Approximate values retain uncertainty until clarified. */
export function correctPendingWorkout(session: Session, focus: WorkoutFocus, pending: PendingWorkoutDraft,
  setIndex: number, input: unknown): PendingWorkoutDraft {
  const target = resolveWorkoutFocus(session, focus, pending);
  if (target.kind !== "pending") fail("PENDING_TARGET_REQUIRED");
  const patch = pendingSet.partial().strict().refine(p => Object.keys(p).length > 0).parse(input);
  if (!Number.isInteger(setIndex) || setIndex < 1 || setIndex > target.draft.sets.length) fail("PENDING_SET_MISSING");
  return pendingSchema.parse({ ...target.draft, revision: target.draft.revision + 1,
    sets: target.draft.sets.map((s, i) => i === setIndex - 1 ? { ...s, ...patch } : s) });
}

/** Not every meaningful preview fits today's set storage. Retain its unit and
 * basis for Agent clarification instead of silently converting per-hand to total. */
export function pendingWorkoutRequirements(input: PendingWorkoutDraft): string[] {
  const draft = pendingSchema.parse(input), reasons = new Set<string>();
  for (const s of draft.sets) {
    if (s.reps.value === null) reasons.add("reps_required");
    if ([s.load.amount, s.reps, s.rpe].some(q => q.certainty === "approximate")) reasons.add("quantity_uncertain");
    if (s.load.reference === "previous_confirmed") reasons.add("confirmed_load_reference_required");
    if (s.load.basis === "per_hand") reasons.add("load_basis_storage_required");
  }
  return [...reasons];
}

/** Routing only: mixed statements MUST NOT become a single skip/repeat/end.
 * Unknown requests still need semantic verification after this preflight. */
export function workoutWorkflowBoundary(input: string): "atomic_candidate" | "agent_workflow" {
  if (input.length > 400 || /(?:左右各|单边|单手|per hand|each hand|那组先别算|不算|作废|重新做|重做|undo|redo|还差|漏记|有没有|是不是|剩下|剩余|rest of|remaining|原本|本来|没练|没做|跳过|结束|到这)/i.test(input)) return "agent_workflow";
  return "atomic_candidate";
}

export function samePendingDraft(a: PendingWorkoutDraft, b: PendingWorkoutDraft): boolean {
  return workoutCanonical(pendingSchema.parse(a)) === workoutCanonical(pendingSchema.parse(b));
}
