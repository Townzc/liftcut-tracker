import { setRequestSchema, type SetRequest, type StoredSet } from "./today";

/**
 * The one tap-to-record write, shared by the web and mobile clients. Provenance
 * follows what the user saw: an untouched value that was already saved stays
 * user_entered, an untouched prefill from the last session becomes
 * user_confirmed_prefill, anything typed is user_entered. A skip carries no
 * actuals, and RPE is never prefilled by the caller.
 */
export function tapSetRequest(input: { id: string; sessionId: string; planExerciseId: string; setIndex: number;
  saved?: StoredSet; prefilled: boolean; changed: { weight: boolean; reps: boolean };
  status: "done" | "skipped"; weightKg: number | null; reps: number | null; rpe: number | null }) {
  const skip = input.status === "skipped", weightKg = skip ? null : input.weightKg, reps = skip ? null : input.reps;
  const source = (key: "weight" | "reps", value: number | null): SetRequest["weightSource"] => value === null ? null
    : input.saved && !input.changed[key] ? "user_entered" : input.prefilled && !input.changed[key] ? "user_confirmed_prefill" : "user_entered";
  return setRequestSchema.safeParse({ id: input.id, sessionId: input.sessionId, planExerciseId: input.planExerciseId, setIndex: input.setIndex,
    revision: (input.saved?.revision ?? 0) + 1, status: input.status, weightKg, reps, rpe: skip ? null : input.rpe,
    weightSource: source("weight", weightKg), repsSource: source("reps", reps), inputUnit: "kg", sourceRef: "today-tap" });
}

/** Undo is a compensating write: the same values at the next revision, marked voided. */
export function voidSetRequest(saved: StoredSet): SetRequest {
  const original = setRequestSchema.strip().parse({ ...saved, inputUnit: "kg", sourceRef: "today-tap",
    weightSource: saved.weightKg === null ? null : "user_entered", repsSource: saved.reps === null ? null : "user_entered" });
  return { ...original, status: "voided", revision: saved.revision + 1 };
}
