import "server-only";
import { Pool } from "pg";
let pool: Pool | undefined;
export const todayEnabled = () => process.env.FEATURE_TODAY_SESSION === "true";
export function todayPool(): Pool {
  if (!process.env.WORKOUT_DATABASE_URL) throw new Error("WORKOUT_DATABASE_UNCONFIGURED");
  if (!pool) {
    pool = new Pool({ connectionString: process.env.WORKOUT_DATABASE_URL, max: 4, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000, application_name: "liftcut-today" });
    pool.on("error", () => console.error("Today idle database connection closed"));
  }
  return pool;
}
