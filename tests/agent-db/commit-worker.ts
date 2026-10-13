// Synthetic DB test child. Deliberately stays alive after COMMIT without delivering a receipt.
import { Pool } from "pg";
import { AgentStore } from "../../src/services/agent/store";
process.once("message", async (request: { user: string; runId: string; execution: unknown; url: string }) => {
  const target = new URL(request.url);
  if (target.hostname !== "127.0.0.1" || !target.pathname.startsWith("/liftcut_p1_")) throw new Error("Test DB only");
  const pool = new Pool({ connectionString: request.url });
  const result = await new AgentStore(pool).execute(request.user, request.runId, request.execution);
  process.send?.({ committed: result.ok });
  setInterval(() => {}, 1000); // Parent terminates this process, simulating a server loss.
});
