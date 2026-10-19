import { requireApiUser } from "@/app/api/ai/_lib";
import { todayPool } from "@/services/today/database";
import { TodayStore } from "@/services/today/store";
import { errorResponse } from "@/services/agent/http";
import { sessionsToWorkoutLogs } from "@liftcut/core/today";
import { workoutOwnerMismatch } from "@/lib/workout-owner";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const auth = await requireApiUser();
    if (auth.errorResponse) return auth.errorResponse;
    const mismatch = workoutOwnerMismatch(request, auth.user.id);
    if (mismatch) return mismatch;
    // Existing installations remain usable before migration/configuration. Once
    // configured, historical data stays visible even when new sessions are disabled.
    const logs = process.env.WORKOUT_DATABASE_URL ? sessionsToWorkoutLogs(await new TodayStore(todayPool()).history(auth.user.id)) : [];
    return Response.json(logs, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
