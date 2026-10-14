import type { Session, SetLog, StoredSet } from "@/lib/today";

// Keep the existing server serialization byte-for-byte: persisted hashes already
// use the trailing brace. This is a stable format, not JSON to be parsed.
export function workoutCanonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(workoutCanonical).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${workoutCanonical(x)}`).join(",")}}`;
  return JSON.stringify(v);
}
export function storedSet(s: SetLog): StoredSet {
  const result = { ...s } as Partial<SetLog>;
  delete result.exerciseName; delete result.updatedAt;
  return result as StoredSet;
}
export function workoutContext(session: Session, selectedExerciseId?: string) {
  return { exercises: session.prescription.exercises.map(e => ({ id:e.id, name:e.name, setCount:e.sets })),
    actuals: session.sets.map(s => ({ id:s.id, exerciseId:s.planExerciseId, setIndex:s.setIndex, revision:s.revision,
      status:s.status, weightKg:s.weightKg, reps:s.reps, rpe:s.rpe })), selectedExerciseId };
}
export function workoutContextInput(session: Session) {
  return { id:session.id, status:session.status, revision:session.revision, prescription:session.prescription,
    sets:session.sets.map(storedSet) };
}
export async function localContextHash(session: Session) {
  const bytes = new TextEncoder().encode(workoutCanonical(workoutContextInput(session)));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2,"0")).join("");
}
