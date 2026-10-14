import { requireApiUser } from "@/app/api/ai/_lib";
import { agentPool } from "@/services/agent/database";
import { AgentStore } from "@/services/agent/store";
import { boundedJson, errorResponse, outcomeResponse, sameOrigin } from "@/services/agent/http";

export const runtime = "nodejs";
export async function GET() {
  try {
    const auth = await requireApiUser();
    if (auth.errorResponse) return auth.errorResponse;
    return outcomeResponse(await new AgentStore(agentPool()).recent(auth.user.id));
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ ok: false, error: "ORIGIN_REJECTED" }, { status: 403 });
  try {
    const auth = await requireApiUser();
    if (auth.errorResponse) return auth.errorResponse;
    return outcomeResponse(await new AgentStore(agentPool()).create(auth.user.id, await boundedJson(request)));
  } catch (error) { return errorResponse(error); }
}
