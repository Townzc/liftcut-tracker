import "server-only";
import type { PoolClient } from "pg";

/** Two wire round trips, with no role/identity cache across pooled connections.
 * Only static SQL is batched. The owner remains a bound transaction-local value.
 * Callers must rollback on failure and must not run work before this resolves. */
export async function beginOwnerTransaction(db:PoolClient,owner:string,expected:"liftcut_workout"|"liftcut_agent"){
  await db.query("begin; set local statement_timeout='10s'; set local lock_timeout='5s'");
  const role=(await db.query(`select rolname,rolsuper,rolbypassrls,set_config('request.jwt.claim.sub',$1,true)
    from pg_roles where rolname=current_user`,[owner])).rows[0];
  if(!role||role.rolname!==expected||role.rolsuper||role.rolbypassrls)throw new Error("UNSAFE_DATABASE_ROLE");
}
