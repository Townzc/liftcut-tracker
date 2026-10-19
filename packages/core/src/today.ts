import { z } from "zod";
import type { WorkoutLog } from "./types";
import type { Best } from "./one-rep-max";
import type { ExerciseSession } from "./progression";
import type { CommandReceipt } from "./workout-commands";
import type { ReplacementReceipt } from "./exercise-replacement";

export function localDateAt(at: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
const timezone = z.string().max(100).refine(value => {
  try { localDateAt(new Date(), value); return true; } catch { return false; }
}, "Invalid timezone");
export const startSessionSchema = z.object({ id: z.uuid(), timezone, dayId: z.string().min(1).max(150) }).strict();
export const endSessionSchema = z.object({ id: z.uuid(), revision: z.number().int().min(2), status: z.literal("ended") }).strict();
const source = z.enum(["user_entered", "user_confirmed_prefill"]).nullable();
export const setRequestSchema = z.object({
  id: z.uuid(), sessionId: z.uuid(), planExerciseId: z.string().min(1).max(150), setIndex: z.number().int().min(1).max(100),
  revision: z.number().int().min(1), status: z.enum(["done", "skipped", "voided"]),
  weightKg: z.number().min(0).max(1000).nullable(), reps: z.number().int().min(0).max(100).nullable(),
  rpe: z.number().min(1).max(10).nullable(), weightSource: source, repsSource: source,
  inputUnit: z.literal("kg"), sourceRef: z.literal("today-tap"),
}).strict().refine(r => r.status !== "done" || r.reps !== null, "Reps required")
  .refine(r => (r.weightKg === null) === (r.weightSource === null) && (r.reps === null) === (r.repsSource === null), "Value/source mismatch")
  .refine(r => r.status !== "skipped" || [r.weightKg, r.reps, r.rpe].every(v => v === null), "Skip cannot report actuals");
export type SetRequest = z.infer<typeof setRequestSchema>;
// Internal records can carry speech provenance. The public tap schema stays narrower.
export type StoredSet = Omit<SetRequest, "weightSource" | "repsSource" | "inputUnit" | "sourceRef"> & {
  weightSource: SetRequest["weightSource"] | "user_said"; repsSource: SetRequest["repsSource"] | "user_said";
  inputUnit: "kg" | "lb"; sourceRef: string;
};
export type SetLog = StoredSet & { exerciseName: string; updatedAt: string };
export type PrescriptionExercise = { id: string; name: string; sets: number; repRange: string; targetRpe: number;
  originalPlanExerciseId?:string; catalogId?:string };
export type Prescription = { title: string; exercises: PrescriptionExercise[] };
export type Session = { id: string; userId: string; localDate: string; timezone: string; trainingPlanId: string;
  weekNumber: number; dayNumber: number; status: "active" | "ended" | "cancelled"; revision: number;
  prescription: Prescription; startedAt: string; endedAt: string | null; sets: SetLog[]; replacements?:ReplacementReceipt[] };
/** Confirmed history of one exercise name: recent ended sessions (every set status) and all-time bests. */
export type ExerciseHistory = { sessions: ExerciseSession[]; best: Best };
export type TodayData = { session: Session | null; days: { id: string; weekNumber: number; dayNumber: number; title: string }[];
  previous: Record<string, { weightKg: number | null; reps: number | null }>; receipts?: CommandReceipt[];
  history?: Record<string, ExerciseHistory> };

// One completed set is one actual row. Skipped, voided and unreported sets never
// enter legacy statistics; prescription totals are not multiplied into actuals.
export function sessionsToWorkoutLogs(sessions: Session[]): WorkoutLog[] {
  return sessions.filter(s => s.status !== "cancelled" && s.sets.some(r => r.status === "done")).map(s => ({
    id: s.id, source: "session", userId: s.userId, date: s.localDate, trainingPlanId: s.trainingPlanId,
    weekNumber: s.weekNumber, dayNumber: s.dayNumber, completed: s.status === "ended", notes: "",
    durationMinutes: s.endedAt ? Math.max(1, Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 60000)) : 0,
    createdAt: s.startedAt,
    exercises: s.sets.filter(r => r.status === "done").map(r => ({ id: r.id, workoutLogId: s.id,
      exercisePlanId: r.planExerciseId, name: r.exerciseName, actualWeight: r.weightKg, actualReps: r.reps,
      actualRpe: r.rpe, completed: true, recordedSets: 1, setIndex: r.setIndex })),
  }));
}
