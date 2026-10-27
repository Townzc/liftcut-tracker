import { z } from "zod";

export const apiBase = (process.env.EXPO_PUBLIC_API_URL || "https://www.liftcuttracker.com").replace(/\/+$/, "");
type Credentials = { access_token: string; user: { id: string } };

/** A retained queue may refresh its token, but must never borrow another account's. */
export function accountAuth(owner: string | undefined, current: () => Credentials | null) {
  return () => { const auth = current(); return owner && auth?.user.id === owner ? auth : null; };
}

/** Same API and write semantics as the web app; the native app identifies itself with a bearer token. */
export function apiHeaders(session: Credentials, json = false): Record<string, string> {
  return { Authorization: `Bearer ${session.access_token}`, "X-Workout-Owner": session.user.id, ...(json ? { "Content-Type": "application/json" } : {}) };
}
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    throw new ApiError(response.status, typeof body.error === "string" ? body.error : `HTTP_${response.status}`);
  }
  return schema.parse(await response.json());
}
export async function getJson<T>(path: string, session: Credentials, schema: z.ZodType<T>, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<T> {
  return parse(await fetcher(`${apiBase}${path}`, { headers: apiHeaders(session), cache: "no-store", signal }), schema);
}
// Checks the fields the app relies on; loose objects keep the rest, because the offline
// outbox stores and projects the server's full snapshot.
const source = z.enum(["user_entered", "user_confirmed_prefill", "user_said"]).nullable();
const set = z.looseObject({ id: z.string(), sessionId: z.string(), planExerciseId: z.string(), setIndex: z.number().int(), revision: z.number().int(),
  status: z.enum(["done", "skipped", "voided"]), weightKg: z.number().nullable(), reps: z.number().int().nullable(), rpe: z.number().nullable(),
  weightSource: source, repsSource: source, inputUnit: z.enum(["kg", "lb"]), sourceRef: z.string(), exerciseName: z.string(), updatedAt: z.string() });
const exercise = z.looseObject({ id: z.string(), name: z.string(), sets: z.number().int(), repRange: z.string(), targetRpe: z.number(),
  originalPlanExerciseId: z.string().optional() });
export const sessionSchema = z.looseObject({
  id: z.string(), userId: z.string(), status: z.enum(["active", "ended", "cancelled"]), revision: z.number().int(),
  prescription: z.object({ title: z.string(), exercises: z.array(exercise) }), sets: z.array(set),
});
const actual = z.object({ setIndex: z.number().int(), status: z.enum(["done", "skipped", "voided"]), weightKg: z.number().nullable(), reps: z.number().int().nullable() });
export const todaySchema = z.looseObject({
  days: z.array(z.object({ id: z.string(), weekNumber: z.number().int(), dayNumber: z.number().int(), title: z.string() })),
  session: sessionSchema.nullable(),
  previous: z.record(z.string(), z.object({ weightKg: z.number().nullable(), reps: z.number().int().nullable() })).default({}),
  history: z.record(z.string(), z.object({ sessions: z.array(z.object({ date: z.string(), sets: z.array(actual) })) })).optional(),
});
export type TodaySummary = z.infer<typeof todaySchema>;
export type WorkoutSession = z.infer<typeof sessionSchema>;
