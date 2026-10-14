import { requireApiUser } from "@/app/api/ai/_lib";
import { workoutOwnerMismatch } from "@/lib/workout-owner";
import { todayPool } from "@/services/today/database";
import { TodayConflict, TodayStore } from "@/services/today/store";
import { errorResponse } from "@/services/agent/http";

export const runtime = "nodejs";
export async function GET(request:Request) {
  try {
    const auth=await requireApiUser();if(auth.errorResponse)return auth.errorResponse;
    const mismatch=workoutOwnerMismatch(request,auth.user.id);if(mismatch)return mismatch;
    const result=await new TodayStore(todayPool()).trace(auth.user.id,new URL(request.url).searchParams.get("setId")??"");
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  }catch(e){if(e instanceof TodayConflict)return Response.json({error:e.message},{status:404});return errorResponse(e);}
}
