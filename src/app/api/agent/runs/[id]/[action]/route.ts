import { requireApiUser } from "@/app/api/ai/_lib";
import { agentPool } from "@/services/agent/database";
import { AgentStore } from "@/services/agent/store";
import { boundedJson, errorResponse, outcomeResponse, sameOrigin } from "@/services/agent/http";

export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string; action: string }> }) {
  if (!sameOrigin(request)) return Response.json({ ok: false, error: "ORIGIN_REJECTED" }, { status: 403 });
  try {
    const auth = await requireApiUser();
    if (auth.errorResponse) return auth.errorResponse;
    const { id, action } = await context.params;
    const store = new AgentStore(agentPool());
    const body = await boundedJson(request);
    if (action === "proposals") return outcomeResponse(await store.publish(auth.user.id, id, body));
    if (action === "user-events") return outcomeResponse(await store.userEvent(auth.user.id, id, body));
    if (action === "execute") return outcomeResponse(await store.execute(auth.user.id, id, body));
    return Response.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
  } catch (error) { return errorResponse(error); }
}
