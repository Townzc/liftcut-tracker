import { requireApiUser } from "@/app/api/ai/_lib";
import { workoutOwnerMismatch } from "@/lib/workout-owner";
import { todayEnabled, todayPool } from "@/services/today/database";
import { PersonalRecordStore } from "@/services/today/personal-record-store";
import { TodayConflict } from "@/services/today/store";
import { boundedJson, errorResponse, sameOrigin } from "@/services/agent/http";

export const runtime = "nodejs";
async function handle(request: Request, write: boolean) {
  if (write && !todayEnabled()) return Response.json({error:"NOT_OPEN"},{status:404});
  if (write && !sameOrigin(request)) return Response.json({error:"ORIGIN_REJECTED"},{status:403});
  try {
    const auth = await requireApiUser(); if (auth.errorResponse) return auth.errorResponse;
    const mismatch = workoutOwnerMismatch(request,auth.user.id); if (mismatch) return mismatch;
    if (!process.env.WORKOUT_DATABASE_URL) return Response.json({error:"NOT_CONFIGURED"},{status:503,headers:{"Cache-Control":"no-store"}});
    const store = new PersonalRecordStore(todayPool());
    const result = write ? await store.command(auth.user.id,await boundedJson(request)) : await store.list(auth.user.id);
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    if (error instanceof TodayConflict) return Response.json({error:error.message},{status:error.message === "NOT_FOUND" ? 404 : 409});
    return errorResponse(error);
  }
}
export async function GET(request: Request) { return handle(request,false); }
export async function POST(request: Request) { return handle(request,true); }
