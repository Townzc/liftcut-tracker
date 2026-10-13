import "server-only";
import { Pool } from "pg";

let pool: Pool | undefined;
export function agentPool(): Pool {
  const connectionString = process.env.AGENT_DATABASE_URL;
  if (!connectionString) throw new Error("AGENT_DATABASE_UNCONFIGURED");
  // Dedicated non-owner/non-BYPASSRLS login. Never expose this URL to the browser/model.
  if (!pool) {
    pool = new Pool({ connectionString, max: 4, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000, application_name: "liftcut-p1" });
    // A lost idle socket must not crash the server or leak the URL/error payload.
    pool.on("error", () => console.error("P1 idle database connection closed"));
  }
  return pool;
}
