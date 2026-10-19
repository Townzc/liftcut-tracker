import { ZodError } from "zod";
import { requireApiUser } from "@/app/api/ai/_lib";
import { workoutOwnerMismatch } from "@/lib/workout-owner";
import { agentPool } from "@/services/agent/database";
import { boundedJson, errorResponse, sameOrigin } from "@/services/agent/http";
import { AgentStore } from "@/services/agent/store";
import { callAiProviderForJson } from "@/services/ai/client";
import { getAiProviderConfig } from "@/services/ai/config";
import { CoachReadError, CoachStore } from "@/services/ai/coach-store";
import { reviewRequestSchema, reviewWorkout } from "@/services/ai/workout-review";
import { todayEnabled, todayPool } from "@/services/today/database";

export const runtime = "nodejs";
/** Post-workout review, only when the user asks: one model call counted against the coach quota, never a write. */
export async function POST(request: Request) {
  if (!todayEnabled()) return Response.json({ error: "NOT_OPEN" }, { status: 404 });
  if (!sameOrigin(request)) return Response.json({ error: "ORIGIN_REJECTED" }, { status: 403 });
  if (!getAiProviderConfig()) return Response.json({ error: "AI_UNAVAILABLE" }, { status: 503 });
  try {
    const auth = await requireApiUser();
    if (auth.errorResponse) return auth.errorResponse;
    const mismatch = workoutOwnerMismatch(request, auth.user.id);
    if (mismatch) return mismatch;
    const body = reviewRequestSchema.parse(await boundedJson(request));
    // The request key reserves one model call: a retry with the same key is refused instead of paying twice.
    await new CoachStore(todayPool()).reserve(auth.user.id, body.requestKey);
    const outcome = await reviewWorkout(auth.user.id, body, { pool: todayPool(), agent: new AgentStore(agentPool()),
      model: async ({ system, user }) => (await callAiProviderForJson({ systemPrompt: system, userPrompt: user })).json });
    return Response.json(outcome, { status: outcome.status === "invalid" ? 422 : outcome.status === "unavailable" ? 409 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    if (error instanceof CoachReadError) return Response.json({ error: error.message }, { status: error.message === "RATE_LIMITED" ? 429 : 409 });
    return errorResponse(error);
  }
}
