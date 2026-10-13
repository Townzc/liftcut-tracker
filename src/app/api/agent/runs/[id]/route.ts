import { requireApiUser } from "@/app/api/ai/_lib";
import { agentPool } from "@/services/agent/database";
import { AgentStore } from "@/services/agent/store";
import { errorResponse, outcomeResponse } from "@/services/agent/http";

export const runtime = "nodejs";
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireApiUser();
    if (auth.errorResponse) return auth.errorResponse;
    return outcomeResponse(await new AgentStore(agentPool()).get(auth.user.id, (await context.params).id));
  } catch (error) { return errorResponse(error); }
}
