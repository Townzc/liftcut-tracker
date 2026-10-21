import { z } from "zod";
import { storedSet, workoutCanonical } from "./workout-context";
import type { Session, SetLog, StoredSet } from "./today";

/** Experimental approval boundary. Only the authenticated store's current
 * Session may be supplied, never a model-generated history or pending outbox. */
const referenceSchema = z.strictObject({ sessionId: z.uuid(), recordId: z.uuid(),
  exerciseId: z.string().min(1), setIndex: z.number().int().positive(), revision: z.number().int().positive() });
export type ConfirmedSetReference = z.infer<typeof referenceSchema>;
export type SetSelector = { exerciseId: string; target: number | "last" } | { reference: ConfirmedSetReference };
export class ConfirmedContextConflict extends Error {}
function fail(reason: string): never { throw new ConfirmedContextConflict(reason); }
const ref = (s: SetLog): ConfirmedSetReference => ({ sessionId: s.sessionId, recordId: s.id,
  exerciseId: s.planExerciseId, setIndex: s.setIndex, revision: s.revision });

function current(session: Session) {
  if (session.status !== "active") fail("SESSION_ENDED");
  const ids = new Set<string>(), slots = new Set<string>();
  for (const s of session.sets) {
    const slot = `${s.planExerciseId}:${s.setIndex}`;
    if (s.sessionId !== session.id || ids.has(s.id) || slots.has(slot)) fail("INVALID_CONTEXT");
    ids.add(s.id); slots.add(slot);
  }
}

/** "Last" means the highest confirmed slot of THIS exercise. Never infer an
 * exercise from array order, the selected plan, or an unconfirmed draft. */
export function resolveConfirmedSet(session: Session, selector: SetSelector): SetLog {
  current(session);
  if ("reference" in selector) {
    const r = referenceSchema.parse(selector.reference);
    const found = session.sets.find(s => s.id === r.recordId);
    if (r.sessionId !== session.id || !found || workoutCanonical(ref(found)) !== workoutCanonical(r)) fail("STALE_REFERENCE");
    if (found.status !== "done") fail("REFERENCE_NOT_DONE");
    return { ...found };
  }
  if (!session.prescription.exercises.some(e => e.id === selector.exerciseId)) fail("EXERCISE_NOT_FOUND");
  const sets = session.sets.filter(s => s.planExerciseId === selector.exerciseId && s.status === "done");
  const index = selector.target === "last" ? Math.max(0, ...sets.map(s => s.setIndex)) : selector.target;
  const found = sets.filter(s => s.setIndex === index);
  if (found.length !== 1) fail("TARGET_NOT_CONFIRMED");
  return { ...found[0] };
}

const patchSchema = z.strictObject({ weightKg: z.number().min(0).max(1000).nullable().optional(),
  reps: z.number().int().min(0).max(100).optional(), rpe: z.number().min(1).max(10).nullable().optional() })
  .refine(p => Object.keys(p).length > 0, "Empty patch");
type Patch = z.infer<typeof patchSchema>;
export type ReviewedSetDraft = { version: "confirmed-context-v1"; sessionId: string; owner: string;
  basis: string; references: ConfirmedSetReference[]; kind: "correct" | "inherit_weight" | "void";
  requests: StoredSet[] };
const basis = (s: Session) => workoutCanonical({ id: s.id, userId: s.userId, status: s.status,
  revision: s.revision, prescription: s.prescription, sets: [...s.sets].sort((a, b) => a.id.localeCompare(b.id)) });
function request(s: SetLog): StoredSet {
  return { ...storedSet(s), revision: s.revision + 1 };
}
function draft(session: Session, s: SetLog, kind: ReviewedSetDraft["kind"], req: StoredSet): ReviewedSetDraft {
  return { version: "confirmed-context-v1", sessionId: session.id, owner: session.userId, basis: basis(session),
    references: [ref(s)], kind, requests: [req] };
}

/** No write and no model values are inferred. Caller must first verify source
 * semantics/roles, show the patch, and retain the server-side immutable draft. */
export function previewSetCorrection(session: Session, selector: SetSelector, changes: Patch) {
  const patch = patchSchema.parse(changes), s = resolveConfirmedSet(session, selector);
  const updated = { ...request(s), ...patch };
  if ("weightKg" in patch) { updated.weightSource = patch.weightKg === null ? null : "user_entered"; updated.inputUnit = "kg"; }
  if ("reps" in patch) updated.repsSource = "user_entered";
  return draft(session, s, "correct", updated);
}

/** An explicit "same weight" is different from an omitted/unknown weight.
 * Inherit only the load; reps are independently supplied, RPE stays unknown. */
export function previewInheritedWeight(session: Session, exerciseId: string, id: string, reps: number) {
  z.uuid().parse(id); patchSchema.parse({ reps });
  const s = resolveConfirmedSet(session, { exerciseId, target: "last" });
  if (s.weightKg === null) fail("SOURCE_WEIGHT_UNKNOWN");
  if (session.sets.some(s => s.id === id)) fail("ID_ALREADY_USED");
  const count = session.prescription.exercises.find(e => e.id === exerciseId)!.sets;
  // Voided/skipped slots remain occupied; redo must have a fresh identity.
  const setIndex = Array.from({ length: count }, (_, i) => i + 1)
    .find(i => !session.sets.some(s => s.planExerciseId === exerciseId && s.setIndex === i));
  if (!setIndex) fail("NO_FREE_SLOT");
  return draft(session, s, "inherit_weight", { ...request(s), id, setIndex, revision: 1,
    reps, rpe: null, weightSource: "user_confirmed_prefill", repsSource: "user_entered" });
}

export function previewSetVoid(session: Session, selector: SetSelector) {
  const s = resolveConfirmedSet(session, selector);
  return draft(session, s, "void", { ...request(s), status: "voided" });
}

/** Pure final check, not a persistence API. The server must read/check/commit
 * in one transaction. Compare the exact retained preview, not client edits.
 * No auto-redo: replacement values require a separately reviewed new record. */
export function confirmReviewedSetDraft(session: Session, retained: ReviewedSetDraft, shown: ReviewedSetDraft,
  authorization: "confirm_preview"): StoredSet[] {
  if (authorization !== "confirm_preview") fail("CONFIRMATION_REQUIRED");
  if (workoutCanonical(retained) !== workoutCanonical(shown)) fail("PREVIEW_CHANGED");
  if (retained.owner !== session.userId || retained.sessionId !== session.id || retained.basis !== basis(session)) fail("STALE_CONTEXT");
  current(session);
  for (const reference of retained.references) resolveConfirmedSet(session, { reference });
  return retained.requests.map(r => ({ ...r }));
}
