import { requireApiUser } from "@/app/api/ai/_lib";
import { todayEnabled, todayPool } from "@/services/today/database";
import { TodayConflict, TodayStore } from "@/services/today/store";
import { boundedJson, errorResponse, sameOrigin } from "@/services/agent/http";

export const runtime = "nodejs";
export async function GET() {
  if (!todayEnabled()) return Response.json({ error: "NOT_OPEN" }, { status: 404 });
  try {
    const auth = await requireApiUser();
    if (auth.errorResponse) return auth.errorResponse;
    return Response.json(await new TodayStore(todayPool()).load(auth.user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  if (!todayEnabled()) return Response.json({ error: "NOT_OPEN" }, { status: 404 });
  if (!sameOrigin(request)) return Response.json({ error: "ORIGIN_REJECTED" }, { status: 403 });
  try {
    const auth = await requireApiUser();
    if (auth.errorResponse) return auth.errorResponse;
    const store = new TodayStore(todayPool());
    const body = await boundedJson(request);
    const action = new URL(request.url).searchParams.get("action");
    const session = action === "start" ? await store.start(auth.user.id,body) : action === "set" ? await store.writeSet(auth.user.id,body)
      : action === "end" ? await store.end(auth.user.id,body) : null;
    if (!session) return Response.json({ error: "INVALID_REQUEST" }, { status: 400 });
    return Response.json(session, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TodayConflict) return Response.json({ error: error.message }, { status: error.message === "NOT_FOUND" ? 404 : 409 });
    return errorResponse(error);
  }
}
