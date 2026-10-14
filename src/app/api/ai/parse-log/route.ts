import { requireApiUser } from "@/app/api/ai/_lib";
import { workoutOwnerMismatch } from "@/lib/workout-owner";
import { todayEnabled, todayPool } from "@/services/today/database";
import { TodayConflict, TodayStore } from "@/services/today/store";
import { boundedJson, errorResponse, sameOrigin } from "@/services/agent/http";

export const runtime = "nodejs";
// Read-only rules preview. No provider calls, tools, writes or client-supplied context.
export async function POST(request: Request) {
  if (!todayEnabled()) return Response.json({ error:"NOT_OPEN" }, { status:404 });
  if (!sameOrigin(request)) return Response.json({ error:"ORIGIN_REJECTED" }, { status:403 });
  try {
    const auth = await requireApiUser();
    if (auth.errorResponse) return auth.errorResponse;
    const mismatch = workoutOwnerMismatch(request,auth.user.id);
    if (mismatch) return mismatch;
    const result = await new TodayStore(todayPool()).preview(auth.user.id,await boundedJson(request));
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    if (error instanceof TodayConflict) return Response.json({error:error.message},{status:error.message === "NOT_FOUND" ? 404 : 409});
    return errorResponse(error);
  }
}
