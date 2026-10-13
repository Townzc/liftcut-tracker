import type { Pool } from "pg";
import { snapshot as applicationSnapshot } from "../p1-application/evidence";

export async function snapshot(db: Pool, owner: string, run: string) {
  const data = await applicationSnapshot(db, owner, run);
  // pg converts timestamptz columns to JavaScript Date (milliseconds). The Store
  // hashes to_jsonb(s), which retains PostgreSQL microseconds. Preserve BOTH;
  // never weaken profile-integrity checks by dropping the time fields.
  data.settings_json = (await db.query("select to_jsonb(s) as original from public.user_settings s where user_id=$1", [owner])).rows[0].original;
  return data;
}
