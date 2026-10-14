// Loopback-only Supabase HTTP CONTRACT DOUBLE for UI/API tests; NOT GoTrue evidence.
// The new transaction routes still authenticate with auth.getUser() over HTTP.
// Identity/profile and the legacy PostgREST read protocol are doubled; plan rows and all P1 writes use real Postgres.
import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { Pool } from "pg";
const user = { id: "11111111-1111-4111-8111-111111111111", email: "p1-fixture@example.invalid", aud: "authenticated",
  role: "authenticated", app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-10-13T00:00:00Z" };
const settings = { user_id: user.id, gender: "male", age: 25, height: 170, current_weight: 65,
  target_weight: 65, weekly_training_days: 3, session_duration_minutes: 60, available_equipment: ["bodyweight"] };
const profile = { id: user.id, email: user.email, display_name: "P1 synthetic user", preferred_language: "zh-CN" };
const part = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
const jwt = `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: user.id, exp: Math.floor(Date.now()/1000)+7200, aud: "authenticated", role: "authenticated" })}`;
const token = `${jwt}.${createHmac("sha256", "p1-local-fixture-not-a-production-key").update(jwt).digest("base64url")}`;
async function main() {
  const url = process.env.P1_TEST_DATABASE_URL;
  if (!url || !["localhost", "127.0.0.1"].includes(new URL(url).hostname) || !new URL(url).pathname.startsWith("/liftcut_p1_")) throw new Error("Local test database required");
  const db = new Pool({ connectionString: url });
  await db.query("insert into auth.users values($1) on conflict do nothing", [user.id]);
  await db.query("insert into public.user_settings(user_id) values($1) on conflict do nothing", [user.id]);
  createServer(async (req, res) => {
    const allowed = ["http://localhost:3101", "http://localhost:3103", "http://localhost:3104"];
    res.setHeader("Access-Control-Allow-Origin", allowed.includes(req.headers.origin ?? "") ? req.headers.origin! : allowed[0]);
    res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "authorization, apikey, content-type, x-client-info, prefer, x-supabase-api-version");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,HEAD,OPTIONS");
    res.setHeader("Content-Type", "application/json");
    if (req.method === "OPTIONS") { res.end(); return; }
    const parsed = new URL(req.url!, "http://localhost"), path = parsed.pathname;
    if (path === "/auth/v1/token") {
      let body = ""; for await (const chunk of req) body += chunk;
      const login = JSON.parse(body);
      if (login.email !== user.email || login.password !== "p1-fixture-password") { res.statusCode=401; res.end('{}'); return; }
      res.end(JSON.stringify({ access_token: token, token_type: "bearer", refresh_token: "local-fixture", expires_in: 7200, user })); return;
    }
    if (req.headers.authorization !== `Bearer ${token}`) { res.statusCode=401; res.end(JSON.stringify({ message: "Invalid fixture token" })); return; }
    if (path === "/auth/v1/user") { res.end(JSON.stringify(user)); return; }
    // Existing app bootstrap/profile reads only. Never substitute P1 transaction endpoints.
    if (path.startsWith("/rest/v1/")) {
      const table = path.slice("/rest/v1/".length);
      // Existing plan UI reads actual rows written by the P1 API, through this HTTP test adapter.
      // These constant queries expose only the synthetic test user's rows; no arbitrary SQL.
      const reads: Record<string,string> = {
        training_plans: "select * from public.training_plans where user_id=$1 order by is_active desc,id",
        training_plan_weeks: "select w.* from public.training_plan_weeks w join public.training_plans p on p.id=w.training_plan_id where p.user_id=$1 order by w.id",
        training_plan_days: "select d.* from public.training_plan_days d join public.training_plan_weeks w on w.id=d.week_id join public.training_plans p on p.id=w.training_plan_id where p.user_id=$1 order by d.id",
        training_plan_exercises: "select e.* from public.training_plan_exercises e join public.training_plan_days d on d.id=e.day_id join public.training_plan_weeks w on w.id=d.week_id join public.training_plans p on p.id=w.training_plan_id where p.user_id=$1 order by e.id",
      };
      if (req.method === "GET" && Object.hasOwn(reads, table)) {
        let rows = (await db.query(reads[table], [user.id])).rows;
        for (const [field, filter] of parsed.searchParams) {
          if (filter.startsWith("eq.")) rows = rows.filter(row => String(row[field]) === filter.slice(3));
          if (filter.startsWith("in.(")) {
            const values = filter.slice(4, -1).split(",").map(value => value.replace(/^"|"$/g, ""));
            rows = rows.filter(row => values.includes(String(row[field])));
          }
        }
        const limit = parsed.searchParams.get("limit");
        if (limit) rows = rows.slice(0, Number(limit));
        res.end(JSON.stringify(req.headers.accept?.includes("vnd.pgrst.object") ? rows[0] ?? null : rows)); return;
      }
      const row = path.endsWith("/profiles") ? profile : path.endsWith("/user_settings") ? settings : null;
      const single = req.headers.accept?.includes("vnd.pgrst.object");
      res.end(JSON.stringify(single ? row : row ? [row] : [])); return;
    }
    res.statusCode=404; res.end('{}');
  }).listen(Number(process.env.AUTH_FIXTURE_PORT ?? 55439), "127.0.0.1", () => console.log("Synthetic auth/profile fixture listening on loopback; not real Supabase Auth"));
}
main().catch(error => { console.error(error); process.exitCode=1; });
