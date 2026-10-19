import { test, expect, request as http, type APIRequestContext } from "@playwright/test";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
const db = new Pool({ connectionString: process.env.W1B_TEST_DATABASE_URL });
const first = "11111111-1111-4111-8111-111111111111", second = "22222222-2222-4222-8222-222222222222";
const plans = { [first]: { plan: randomUUID(), day: randomUUID(), exercise: randomUUID() }, [second]: { plan: randomUUID(), day: randomUUID(), exercise: randomUUID() } };
const authUrl = `http://127.0.0.1:${process.env.AUTH_FIXTURE_PORT || "55440"}`;
let api: APIRequestContext; // No cookies: this is what the native app sends.
const tokens: Record<string, string> = {};
test.beforeAll(async () => {
  for (const [user, p] of Object.entries(plans)) {
    await db.query("insert into auth.users values($1) on conflict do nothing", [user]);
    await db.query("update public.training_plans set is_active=false where user_id=$1", [user]);
    await db.query("insert into public.training_plans(id,user_id,name,is_active) values($1,$2,'Bearer synthetic plan',true)", [p.plan, user]);
    await db.query("insert into public.training_plan_weeks values($1,$2,1)", [p.plan + "w", p.plan]);
    await db.query("insert into public.training_plan_days(id,week_id,day_number,title) values($1,$2,1,'训练 M')", [p.day, p.plan + "w"]);
    await db.query("insert into public.training_plan_exercises(id,day_id,name,sets,rep_range,target_rpe) values($1,$2,'Bearer 卧推',2,'5',8)", [p.exercise, p.day]);
  }
  api = await http.newContext({ baseURL: "http://localhost:3103" });
  for (const [user, email] of [[first, "p1-fixture@example.invalid"], [second, "offline-second@example.invalid"]]) {
    const login = await api.post(`${authUrl}/auth/v1/token?grant_type=password`, { data: { email, password: "p1-fixture-password" } });
    tokens[user] = (await login.json()).access_token;
  }
});
test.afterAll(async () => {
  for (const [user, p] of Object.entries(plans)) {
    await db.query("delete from workout_sessions where user_id=$1 and training_plan_id=$2", [user, p.plan]);
    await db.query("delete from training_plans where user_id=$1 and id=$2", [user, p.plan]);
  }
  await api.dispose(); await db.end();
});
const as = (user: string, extra: Record<string, string> = {}) => ({ Authorization: `Bearer ${tokens[user]}`, ...extra });
const set = (sessionId: string, exercise: string, id = randomUUID()) => ({ id, sessionId, planExerciseId: exercise, setIndex: 1, revision: 1, status: "done",
  weightKg: 60, reps: 5, rpe: null, weightSource: "user_entered", repsSource: "user_entered", inputUnit: "kg", sourceRef: "today-tap" });

test("a bearer token alone reads and writes only its owner's workout, idempotently, without an Origin header", async () => {
  expect((await api.get("/api/workout-sessions")).status()).toBe(401);
  const today = await api.get("/api/workout-sessions", { headers: as(first) });
  expect(today.status()).toBe(200);
  expect((await today.json()).days.map((d: { id: string }) => d.id)).toEqual([plans[first].day]);
  const start = { id: randomUUID(), dayId: plans[first].day, timezone: "Asia/Shanghai" };
  const started = await api.post("/api/workout-sessions?action=start", { headers: as(first), data: start });
  expect(started.status()).toBe(200);
  const write = set(start.id, plans[first].exercise);
  for (let i = 0; i < 2; i++) expect((await api.post("/api/workout-sessions?action=set", { headers: as(first), data: write })).status()).toBe(200);
  expect((await db.query("select count(*)::int as n from set_logs where session_id=$1", [start.id])).rows[0].n).toBe(1);
  expect((await api.post("/api/workout-sessions?action=set", { headers: as(first), data: { ...write, reps: 6 } })).status()).toBe(409);

  // The second user's token cannot see, write into or trace the first user's session.
  const theirs = await (await api.get("/api/workout-sessions", { headers: as(second) })).json();
  expect(theirs.session).toBeNull(); expect(theirs.days.map((d: { id: string }) => d.id)).toEqual([plans[second].day]);
  expect((await api.post("/api/workout-sessions?action=set", { headers: as(second), data: set(start.id, plans[first].exercise) })).status()).toBe(404);
  const foreignDay = await api.post("/api/workout-sessions?action=start", { headers: as(second), data: { ...start, id: randomUUID() } });
  expect([foreignDay.status(), (await foreignDay.json()).error]).toEqual([409, "PLAN_DAY_UNAVAILABLE"]);
  expect((await db.query("select count(*)::int as n from workout_sessions where user_id=$1 and training_plan_id=$2", [second, plans[first].plan])).rows[0].n).toBe(0);
  expect((await api.get(`/api/workout-sessions/trace?setId=${write.id}`, { headers: as(second) })).status()).toBe(404);
  expect((await api.get(`/api/workout-sessions/trace?setId=${write.id}`, { headers: as(first) })).status()).toBe(200);
  expect((await api.get("/api/workout-sessions", { headers: as(first, { "X-Workout-Owner": second }) })).status()).toBe(409);
  expect((await db.query("select count(*)::int as n from set_logs where session_id=$1", [start.id])).rows[0].n).toBe(1);
  expect((await api.post("/api/workout-sessions?action=end", { headers: as(first), data: { id: start.id, revision: 2, status: "ended" } })).status()).toBe(200);
});

test("bad bearer tokens fail closed and never fall back to a browser session", async ({ page }) => {
  const forged = tokens[first].replace(/\.[^.]+$/, ".invalid-signature");
  for (const headers of [{ Authorization: `Bearer ${forged}` }, { Authorization: "Bearer not-a-jwt" }, { Authorization: "Basic abc" }])
    expect((await api.get("/api/workout-sessions", { headers })).status(), JSON.stringify(headers)).toBe(401);
  expect((await api.post("/api/workout-sessions?action=start", { headers: { Authorization: `Bearer ${forged}` }, data: { id: randomUUID(), dayId: plans[first].day, timezone: "UTC" } })).status()).toBe(401);
  expect((await api.post("/api/workout-sessions?action=start", { headers: as(first, { "Content-Type": "text/plain" }), data: "{}" })).status()).toBe(403);
  // Signed in as the second user in a browser: an explicit header decides, cookies are ignored.
  await page.goto("http://localhost:3103/login");
  await page.locator("#email").fill("offline-second@example.invalid"); await page.locator("#password").fill("p1-fixture-password");
  await page.locator('button[type="submit"]').click(); await page.waitForURL(/\/(?:onboarding)?$/);
  expect((await (await page.request.get("/api/workout-sessions")).json()).days.map((d: { id: string }) => d.id)).toEqual([plans[second].day]);
  expect((await page.request.get("/api/workout-sessions", { headers: { Authorization: `Bearer ${forged}` } })).status()).toBe(401);
  expect((await (await page.request.get("/api/workout-sessions", { headers: as(first) })).json()).days.map((d: { id: string }) => d.id)).toEqual([plans[first].day]);
  // Cookie writes still need the same-origin browser checks.
  expect((await page.request.post("/api/workout-sessions?action=start", { headers: { Origin: "https://evil.example" }, data: { id: randomUUID(), dayId: plans[second].day, timezone: "UTC" } })).status()).toBe(403);
});

test("other bearer routes resolve the same identity", async () => {
  expect((await api.get("/api/coach/history", { headers: as(first) })).status()).toBe(200);
  expect((await api.get("/api/coach/history")).status()).toBe(401);
  expect((await api.get("/api/agent/runs", { headers: as(second) })).status()).not.toBe(401);
});
