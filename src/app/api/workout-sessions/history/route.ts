import { requireApiUser } from "@/app/api/ai/_lib";
import { todayPool } from "@/services/today/database";
import { TodayStore } from "@/services/today/store";
import { errorResponse } from "@/services/agent/http";
import { sessionsToWorkoutLogs } from "@/lib/today";
export const runtime = "nodejs";
export async function GET() {
  try {
    const auth = await requireApiUser();
    if (auth.errorResponse) return auth.errorResponse;
    // Existing installations remain usable before migration/configuration. Once
    // configured, historical data stays visible even when new sessions are disabled.
    const logs = process.env.WORKOUT_DATABASE_URL ? sessionsToWorkoutLogs(await new TodayStore(todayPool()).history(auth.user.id)) : [];
    return Response.json(logs, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
