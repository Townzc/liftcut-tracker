import { requireApiUser } from "@/app/api/ai/_lib";
import { todayEnabled, todayPool } from "@/services/today/database";
import { TodayConflict, TodayStore } from "@/services/today/store";
import { boundedJson, errorResponse, sameOrigin } from "@/services/agent/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!todayEnabled()) return Response.json({error:"NOT_OPEN"},{status:404});
  if (!sameOrigin(request)) return Response.json({error:"ORIGIN_REJECTED"},{status:403});
  try {
    const auth = await requireApiUser();
    if (auth.errorResponse) return auth.errorResponse;
    const store = new TodayStore(todayPool()), body = await boundedJson(request);
    const action = new URL(request.url).searchParams.get("action");
    const result = action === "apply" ? await store.command(auth.user.id,body)
      : action === "undo" ? await store.undoCommand(auth.user.id,body) : null;
    if (!result) return Response.json({error:"INVALID_REQUEST"},{status:400});
    return Response.json(result,{headers:{"Cache-Control":"no-store"}});
  } catch (error) {
    if (error instanceof TodayConflict) return Response.json({error:error.message},{status:error.message === "NOT_FOUND" ? 404 : 409});
    return errorResponse(error);
  }
}
