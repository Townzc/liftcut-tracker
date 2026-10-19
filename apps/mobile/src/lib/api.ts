import { z } from "zod";

export const apiBase = (process.env.EXPO_PUBLIC_API_URL || "https://www.liftcuttracker.com").replace(/\/+$/, "");
type Credentials = { access_token: string; user: { id: string } };

/** Same API and write semantics as the web app; the native app identifies itself with a bearer token. */
export function apiHeaders(session: Credentials, json = false): Record<string, string> {
  return { Authorization: `Bearer ${session.access_token}`, "X-Workout-Owner": session.user.id, ...(json ? { "Content-Type": "application/json" } : {}) };
}
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) { super(code); }
}
export async function getJson<T>(path: string, session: Credentials, schema: z.ZodType<T>, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(`${apiBase}${path}`, { headers: apiHeaders(session), cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    throw new ApiError(response.status, typeof body.error === "string" ? body.error : `HTTP_${response.status}`);
  }
  return schema.parse(await response.json());
}

// Read-only subset of GET /api/workout-sessions used by the skeleton; unknown fields are dropped.
const exercise = z.object({ id: z.string(), name: z.string(), sets: z.number().int(), repRange: z.string(), targetRpe: z.number() });
export const todaySchema = z.object({
  days: z.array(z.object({ id: z.string(), weekNumber: z.number().int(), dayNumber: z.number().int(), title: z.string() })),
  session: z.object({
    id: z.string(), status: z.enum(["active", "ended", "cancelled"]),
    prescription: z.object({ title: z.string(), exercises: z.array(exercise) }),
    sets: z.array(z.object({ status: z.enum(["done", "skipped", "voided"]) })),
  }).nullable(),
});
export type TodaySummary = z.infer<typeof todaySchema>;
