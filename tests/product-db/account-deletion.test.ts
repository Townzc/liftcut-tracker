import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";

// Real PostgreSQL, synthetic Auth/session/Storage metadata. This does NOT test
// GoTrue revocation, Storage file removal, HTTP confirmation, or native clients.
const configured = process.env.ACCOUNT_DELETION_TEST_DATABASE_URL;
const migration = "20261027065932_account_deletion_boundary.sql";
for (const installation of ["fresh", "upgrade"] as const) {
  test(`account deletion boundary: ${installation}`, { skip: !configured }, async t => {
    const url = new URL(configured!);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    const name = url.pathname.slice(1) + "_" + installation;
    assert.match(name, /^liftcut_p1_deletion_[a-z0-9_]+$/);
    const adminUrl = new URL(url); adminUrl.pathname = "/postgres";
    const cluster = new Pool({ connectionString: adminUrl.toString() });
    // Never reset an existing database. Cleanup is restricted to this new name.
    await cluster.query(`create database "${name}"`);
    url.pathname = "/" + name;
    const db = new Pool({ connectionString: url.toString() });
    const a = randomUUID(), b = randomUUID(), sa = randomUUID(), sb = randomUUID(), request = randomUUID();
    const ledger = ["runs", "proposals", "events", "execution_keys", "receipts"];
    const publicRows = ["user_settings", "training_plans", "coach_conversations", "coach_turns", "workout_sessions", "workout_coach_reviews", "personal_record_events"];
    async function role<T>(name: "authenticated" | "anon" | "service_role" | "liftcut_agent" | "liftcut_workout", owner: string, session: string | null, work: (c: PoolClient) => Promise<T>) {
      const c = await db.connect();
      try {
        await c.query("begin; set local statement_timeout='5s'");
        await c.query(`set local role ${name}`);
        await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: owner, session_id: session })]);
        const value = await work(c); await c.query("commit"); return value;
      } catch (error) { await c.query("rollback"); throw error; } finally { c.release(); }
    }
    const begin = (owner = a, id = request, session: string | null = owner === a ? sa : sb) => role("service_role", owner, null, c => c.query("select public.begin_account_deletion($1,$2,$3) result", [owner, id, session]));
    const status = (owner: string) => role("service_role", owner, null, c => c.query("select public.account_deletion_status($1) result", [owner]));
    const upload = (owner = a, session: string | null = sa) => role("authenticated", owner, session, c => c.query("insert into storage.objects values($1,'avatars',$2)", [randomUUID(), `${owner}/${randomUUID()}.png`]));
    const denied = (work: () => Promise<unknown>) => assert.rejects(work, { code: "42501" });
    const count = async (table: string, owner: string) => Number((await db.query(`select count(*) from ${table} where user_id=$1`, [owner])).rows[0].count);
    async function seed(owner: string, session: string) {
      await db.query("insert into auth.users values($1)", [owner]);
      await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [session, owner]);
      await db.query("insert into public.profiles(id,email) values($1,'synthetic@example.invalid')", [owner]);
      await db.query("insert into public.user_settings(user_id) values($1)", [owner]);
      await db.query("insert into public.training_plans(id,user_id,name) values($1,$2,'Synthetic')", [owner, owner]);
      await db.query("insert into public.coach_conversations(id,user_id,title) values($1,$1,'Synthetic')", [owner]);
      await db.query("insert into public.coach_turns(id,conversation_id,user_id,at,revision,payload) values($1,$1,$1,now(),1,'{}')", [owner]);
      await db.query(`insert into public.workout_sessions(id,user_id,local_date,timezone,training_plan_id,week_number,day_number,prescription,started_at,request_hash)
        values($1,$1,current_date,'UTC',$2,1,1,'{}',now(),'synthetic')`, [owner, owner]);
      await db.query(`insert into public.workout_coach_reviews(id,user_id,conversation_id,session_id,request_id,payload,status)
        values($1,$1,$1,$1,$1,'{}','applied')`, [owner]);
      await db.query(`insert into public.personal_record_events(id,user_id,request_hash,request,receipt)
        values($1,$1,repeat('a',64),'{"action":"create"}','{}')`, [owner]);
      await db.query(`insert into agent_private.runs(id,user_id,request_key,request_hash,version,context,profile_hash,status)
        values($1,$1,$1,repeat('a',64),'p1-app-v1','{}','synthetic','applied')`, [owner]);
      await db.query(`insert into agent_private.proposals(id,user_id,run_id,version,context_revision,content_hash,plan)
        values($1,$1,$1,1,0,repeat('a',64),'{}')`, [owner]);
      await db.query("update agent_private.runs set current_proposal=$1 where id=$1", [owner]);
      await db.query("insert into agent_private.events(user_id,run_id,type,actor,data) values($1,$1,'applied','user','{}')", [owner]);
      await db.query("insert into agent_private.execution_keys(user_id,key,run_id,intent_hash) values($1,$1,$1,repeat('a',64))", [owner]);
      await db.query("insert into agent_private.receipts(id,user_id,run_id,proposal_id,receipt) values($1,$1,$1,$1,'{}')", [owner]);
    }
    async function waiting(pid: number) {
      for (let i = 0; i < 100; i++) {
        if ((await db.query("select 1 from pg_locks where pid=$1 and locktype='advisory' and not granted", [pid])).rowCount) return;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.fail("Expected an owner advisory-lock wait");
    }
    try {
      await db.query(await readFile("tests/agent-db/bootstrap.sql", "utf8"));
      await db.query("do $$begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if; end$$");
      await db.query(await readFile("supabase/schema.sql", "utf8"));
      for (const file of (await readdir("supabase/migrations")).sort()) {
        if ([migration, "20261014002316_today_session.sql", "20261014181717_coach_model_access.sql"].includes(file) || file.endsWith("explicit_legacy_api_grants.sql")) continue;
        await db.query(await readFile(`supabase/migrations/${file}`, "utf8"));
      }
      if (installation === "upgrade") { await seed(a, sa); await seed(b, sb); }
      await db.query(await readFile(`supabase/migrations/${migration}`, "utf8"));
      if (installation === "fresh") { await seed(a, sa); await seed(b, sb); }
      // Synthetic equivalent of Storage's admin path; does not grant runtime access.
      await db.query(`grant usage on schema storage to authenticated,anon,service_role;
        grant select,insert,update,delete on storage.objects to authenticated;
        grant select on storage.objects to anon;
        grant select,delete on storage.objects to service_role;
        create policy fixture_storage_admin on storage.objects to service_role using(true) with check(true);`);

      await t.test("migration preserves existing data; all remaining Auth FKs cascade except the handled ledger", async () => {
        for (const table of [...ledger.map(x => `agent_private.${x}`), ...publicRows.map(x => `public.${x}`)]) assert.equal(await count(table, a), 1);
        const refs = await db.query("select conrelid::regclass::text name from pg_constraint where contype='f' and confrelid='auth.users'::regclass and confdeltype<>'c'");
        assert.deepEqual(refs.rows.map(r => r.name), ["agent_private.runs"]);
      });
      await t.test("only service_role can begin; no ordinary ledger or lifecycle DELETE grants", async () => {
        for (const name of ["anon", "authenticated", "liftcut_agent", "liftcut_workout"] as const) {
          await denied(() => role(name, a, sa, c => c.query("select public.begin_account_deletion($1,$2)", [b, request])));
          await denied(() => role(name, a, sa, c => c.query("select public.account_deletion_status($1)", [b])));
          await denied(() => role(name, a, sa, c => c.query("delete from account_private.deletions")));
          for (const table of ledger) await denied(() => role(name, a, sa, c => c.query(`delete from agent_private.${table} where user_id=$1`, [a])));
        }
        await denied(() => role("service_role", a, null, c => c.query("insert into account_private.deletions(user_id,request_id) values($1,$2)", [a, request])));
        await denied(() => begin(a, request, null)); await denied(() => begin(a, request, sb));
        const revoked = randomUUID();
        await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [revoked, a]);
        await db.query("delete from auth.sessions where id=$1", [revoked]);
        await denied(() => begin(a, request, revoked));
        assert.equal((await status(a)).rows[0].result, null);
      });
      await t.test("live owner session required; revoked, expired, absent and foreign sessions denied", async () => {
        await upload(); await upload(b, sb);
        await denied(() => upload(a, null)); await denied(() => upload(a, sb)); await denied(() => upload(a, randomUUID()));
        await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [sa]);
        await denied(() => upload()); await denied(() => begin());
        await db.query("update auth.sessions set not_after=null where id=$1", [sa]);
        assert.ok((await role("anon", a, null, c => c.query("select * from storage.objects"))).rowCount! >= 2);
      });
      await t.test("begin waits for in-flight upload; retries are bound to owner and request", async () => {
        const writer = await db.connect(), starter = await db.connect(); let pending: Promise<unknown> | undefined;
        try {
          await writer.query("begin; set local role authenticated");
          await writer.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: a, session_id: sa })]);
          await writer.query("insert into storage.objects values($1,'avatars',$2)", [randomUUID(), `${a}/in-flight.png`]);
          await starter.query("begin; set local statement_timeout='5s'; set local role service_role");
          const pid = (await starter.query("select pg_backend_pid() pid")).rows[0].pid;
          pending = starter.query("select public.begin_account_deletion($1,$2,$3)", [a, request, sa]);
          await waiting(pid); await writer.query("commit"); await pending; await starter.query("commit");
        } finally { await writer.query("rollback"); await starter.query("rollback"); await pending?.catch(() => {}); writer.release(); starter.release(); }
        assert.deepEqual((await begin()).rows[0].result, { requestId: request, status: "pending" });
        assert.deepEqual((await begin(a, request, null)).rows[0].result, { requestId: request, status: "pending" });
        assert.deepEqual((await status(a)).rows[0].result, { requestId: request, status: "pending" });
        await denied(() => begin(a, request, randomUUID()));
        await assert.rejects(() => begin(a, randomUUID()), { code: "23505" });
        await assert.rejects(() => begin(b, request), { code: "23505" });
        await denied(() => upload()); await upload(b, sb);
        assert.equal((await role("authenticated", a, sa, c => c.query("update storage.objects set name=name where name like $1", [`${a}/%`]))).rowCount, 0);
        assert.equal((await role("authenticated", a, sa, c => c.query("delete from storage.objects where name like $1", [`${a}/%`]))).rowCount, 0);
      });
      await t.test("an upload waiting behind deletion observes the committed barrier", async () => {
        const owner = randomUUID(), session = randomUUID(), starter = await db.connect(), writer = await db.connect();
        let pending: Promise<unknown> | undefined;
        try {
          await db.query("insert into auth.users values($1)", [owner]);
          await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [session, owner]);
          await starter.query("begin; set local role service_role");
          await starter.query("select public.begin_account_deletion($1,$2,$3)", [owner, randomUUID(), session]);
          await writer.query("begin; set local statement_timeout='5s'; set local role authenticated");
          await writer.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: owner, session_id: session })]);
          const pid = (await writer.query("select pg_backend_pid() pid")).rows[0].pid;
          pending = assert.rejects(writer.query("insert into storage.objects values($1,'avatars',$2)", [randomUUID(), `${owner}/late.png`]), { code: "42501" });
          await waiting(pid); await starter.query("commit"); await pending;
        } finally { await writer.query("rollback"); await starter.query("rollback"); await pending?.catch(() => {}); writer.release(); starter.release(); }
        await db.query("delete from auth.users where id=$1", [owner]);
      });
      await t.test("Auth deletion refuses remaining avatar metadata; Storage admin cleanup stays possible", async () => {
        await assert.rejects(() => db.query("delete from auth.users where id=$1", [a]), { code: "23503" });
        assert.equal(await count("agent_private.receipts", a), 1);
        // Fixture metadata removal only: production MUST use the Storage API.
        const removed = await role("service_role", a, null, c => c.query("delete from storage.objects where name like $1", [`${a}/%`]));
        assert.ok(removed.rowCount! >= 2);
      });
      await t.test("cleanup failure rolls Auth and every ledger deletion back", async () => {
        await db.query(`create function account_private.fixture_failure() returns trigger language plpgsql as $$begin raise exception 'injected'; end$$;
          create trigger fixture_failure before delete on agent_private.runs for each row execute function account_private.fixture_failure()`);
        await assert.rejects(() => db.query("delete from auth.users where id=$1", [a]), /injected/);
        await db.query("drop trigger fixture_failure on agent_private.runs; drop function account_private.fixture_failure()");
        for (const table of ledger) assert.equal(await count(`agent_private.${table}`, a), 1);
        assert.equal((await db.query("select current_proposal from agent_private.runs where id=$1", [a])).rows[0].current_proposal, a);
        assert.equal(await count("account_private.deletions", a), 1);
      });
      await t.test("hard delete removes approved graph and owned records only; stale JWT cannot upload", async () => {
        await db.query("delete from auth.users where id=$1", [a]);
        for (const table of [...ledger.map(x => `agent_private.${x}`), ...publicRows.map(x => `public.${x}`)]) {
          assert.equal(await count(table, a), 0); assert.equal(await count(table, b), 1);
        }
        assert.equal(await count("auth.sessions", a), 0); assert.equal(await count("account_private.deletions", a), 0);
        assert.equal((await db.query("select 1 from public.profiles where id=$1", [a])).rowCount, 0);
        await denied(() => upload()); await upload(b, sb);
        await assert.rejects(() => begin(), { code: "23503" });
        assert.equal((await db.query("delete from auth.users where id=$1", [a])).rowCount, 0);
      });
    } finally {
      await db.end();
      await cluster.query(`drop database "${name}"`);
      await cluster.end();
    }
  });
}
