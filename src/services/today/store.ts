import "server-only";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { startSessionSchema, endSessionSchema, setRequestSchema, localDateAt, type Session, type TodayData, type Prescription } from "@/lib/today";

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v !== null && typeof v === "object") return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  return JSON.stringify(v);
}
const hash = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
export class TodayConflict extends Error {}
const fail = (reason: string): never => { throw new TodayConflict(reason); };

export class TodayStore {
  constructor(private readonly pool: Pool, private readonly now = () => new Date()) {}
  private async tx<T>(user: string, work: (db: PoolClient) => Promise<T>) {
    z.uuid().parse(user);
    const db = await this.pool.connect();
    let broken = false;
    try {
      const role = (await db.query("select rolname,rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0];
      if (role.rolname !== "liftcut_workout" || role.rolsuper || role.rolbypassrls) throw new Error("UNSAFE_DATABASE_ROLE");
      await db.query("begin");
      await db.query("set local statement_timeout='10s'");
      await db.query("set local lock_timeout='5s'");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
      await db.query("select pg_advisory_xact_lock(hashtextextended($1,714))", [user]);
      const value = await work(db);
      await db.query("commit");
      return value;
    } catch (error) {
      await db.query("rollback").catch(() => { broken = true; });
      if (error && typeof error === "object" && "code" in error && ["40001", "23505"].includes(String(error.code))) fail("CONCURRENT_CHANGE");
      throw error;
    } finally { db.release(broken); }
  }
  private async read(db: PoolClient, id: string): Promise<Session> {
    const s = (await db.query("select *,local_date::text as day from public.workout_sessions where id=$1", [id])).rows[0];
    if (!s) return fail("NOT_FOUND");
    const sets = (await db.query("select payload,exercise_name,updated_at from public.set_logs where session_id=$1 order by plan_exercise_id,set_index", [id])).rows;
    return { id: s.id, userId: s.user_id, localDate: s.day, timezone: s.timezone, trainingPlanId: s.training_plan_id,
      weekNumber: s.week_number, dayNumber: s.day_number, status: s.status, revision: s.revision, prescription: s.prescription,
      startedAt: s.started_at.toISOString(), endedAt: s.ended_at?.toISOString() ?? null,
      sets: sets.map(r => ({ ...r.payload, exerciseName: r.exercise_name, updatedAt: r.updated_at.toISOString() })) };
  }
  private async event(db: PoolClient, user: string, session: string, record: string | null, type: string, data: unknown) {
    await db.query("insert into public.workout_session_events(user_id,session_id,set_log_id,type,data) values($1,$2,$3,$4,$5)",
      [user, session, record, type, JSON.stringify(data)]);
  }
  async history(user: string): Promise<Session[]> {
    return this.tx(user, async db => {
      const rows = (await db.query("select id from public.workout_sessions order by started_at desc")).rows;
      return Promise.all(rows.map(r => this.read(db, r.id)));
    });
  }
  async load(user: string): Promise<TodayData> {
    return this.tx(user, async db => {
      const active = (await db.query("select id from public.workout_sessions where status='active'")).rows[0];
      const days = (await db.query(`select d.id,w.week_number as "weekNumber",d.day_number as "dayNumber",d.title
        from public.training_plans p join public.training_plan_weeks w on w.training_plan_id=p.id
        join public.training_plan_days d on d.week_id=w.id where p.is_active order by w.week_number,d.day_number,d.id`)).rows;
      const rows = (await db.query(`select distinct on (name) name,weight,reps from (
        select l.exercise_name as name,l.weight_kg as weight,l.reps,l.updated_at as at,l.id::text as id
        from public.set_logs l join public.workout_sessions s on s.id=l.session_id
        where l.status='done' and s.status='ended'
        union all select e.name,e.actual_weight,e.actual_reps,w.created_at,e.id
        from public.workout_log_exercises e join public.workout_logs w on w.id=e.workout_log_id where e.completed
      ) history order by name,at desc,id desc`)).rows;
      return { session: active ? await this.read(db, active.id) : null, days,
        previous: Object.fromEntries(rows.map(r => [r.name, { weightKg: r.weight === null ? null : Number(r.weight), reps: r.reps }])) };
    });
  }
  async start(user: string, input: unknown): Promise<Session> {
    const req = startSessionSchema.parse(input), digest = hash(req);
    return this.tx(user, async db => {
      const old = (await db.query("select revision,request_hash from public.workout_sessions where id=$1", [req.id])).rows[0];
      if (old) {
        if (old.revision !== 1) return fail("STALE_REVISION");
        if (old.request_hash !== digest) return fail("CONTENT_CONFLICT");
        return this.read(db, req.id);
      }
      if ((await db.query("select id from public.workout_sessions where status='active'")).rowCount) return fail("ACTIVE_SESSION_EXISTS");
      const day = (await db.query(`select d.*,w.week_number,p.id as plan_id,
        (select jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'sets',e.sets,'repRange',e.rep_range,'targetRpe',e.target_rpe) order by e.id)
         from public.training_plan_exercises e where e.day_id=d.id) as exercises from public.training_plan_days d
        join public.training_plan_weeks w on d.week_id=w.id join public.training_plans p on w.training_plan_id=p.id
        where d.id=$1 and p.is_active`, [req.dayId])).rows[0];
      if (!day) return fail("PLAN_DAY_UNAVAILABLE");
      const exercises: Prescription["exercises"] = day.exercises ?? [];
      if (!exercises.length || exercises.some(e => e.sets < 1 || e.sets > 100)) return fail("INVALID_PRESCRIPTION");
      const at = this.now(), prescription = { title: day.title, exercises };
      await db.query(`insert into public.workout_sessions(id,user_id,local_date,timezone,training_plan_id,week_number,day_number,prescription,started_at,request_hash)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [req.id,user,localDateAt(at,req.timezone),req.timezone,day.plan_id,
        day.week_number,day.day_number,JSON.stringify(prescription),at,digest]);
      await this.event(db,user,req.id,null,"started",{ revision: 1, prescription });
      return this.read(db,req.id);
    });
  }
  async writeSet(user: string, input: unknown): Promise<Session> {
    const req = setRequestSchema.parse(input), digest = hash(req);
    return this.tx(user, async db => {
      const session = (await db.query("select status,prescription from public.workout_sessions where id=$1 for update", [req.sessionId])).rows[0];
      if (!session) return fail("NOT_FOUND");
      const old = (await db.query("select * from public.set_logs where id=$1", [req.id])).rows[0];
      if (old) {
        if (old.session_id !== req.sessionId || old.plan_exercise_id !== req.planExerciseId || old.set_index !== req.setIndex) return fail("CONTENT_CONFLICT");
        if (req.revision === old.revision) {
          if (old.request_hash !== digest) return fail("CONTENT_CONFLICT");
          return this.read(db,req.sessionId);
        }
        if (req.revision !== old.revision + 1) return fail("STALE_REVISION");
        if (old.status === "voided") return fail("SET_VOIDED");
      } else if (req.revision !== 1 || req.status === "voided") return fail("STALE_REVISION");
      if (session.status !== "active") return fail("SESSION_ENDED");
      const exercise = (session.prescription as Prescription).exercises.find(e => e.id === req.planExerciseId);
      if (!exercise || req.setIndex > exercise.sets) return fail("SET_NOT_IN_PRESCRIPTION");
      if (req.status === "voided" && old.status !== "done") return fail("NOT_COMPLETED");
      // Undo preserves the original actuals/source as evidence; it only excludes them from statistics.
      if (req.status === "voided" && hash({ ...old.payload, revision: req.revision, status: "voided" }) !== digest) return fail("CONTENT_CONFLICT");
      const values = [req.id,user,req.sessionId,req.planExerciseId,exercise.name,req.setIndex,req.weightKg,req.reps,req.rpe,
        req.inputUnit,req.weightSource,req.repsSource,req.status,req.revision,req.sourceRef,JSON.stringify(req),digest];
      if (old) await db.query(`update public.set_logs set weight_kg=$7,reps=$8,rpe=$9,input_unit=$10,weight_source=$11,
        reps_source=$12,status=$13,revision=$14,source_ref=$15,payload=$16,request_hash=$17,updated_at=now()
        where id=$1 and user_id=$2 and session_id=$3 and plan_exercise_id=$4 and exercise_name=$5 and set_index=$6`, values);
      else await db.query(`insert into public.set_logs(id,user_id,session_id,plan_exercise_id,exercise_name,set_index,weight_kg,reps,rpe,input_unit,
        weight_source,reps_source,status,revision,source_ref,payload,request_hash) values(${values.map((_,i) => `$${i+1}`).join(",")})`, values);
      await this.event(db,user,req.sessionId,req.id,req.status === "voided" ? "voided" : old ? "corrected" : "recorded",
        { before: old?.payload ?? null, after: req });
      return this.read(db,req.sessionId);
    });
  }
  async end(user: string, input: unknown): Promise<Session> {
    const req = endSessionSchema.parse(input), digest = hash(req);
    return this.tx(user, async db => {
      const s = (await db.query("select * from public.workout_sessions where id=$1 for update",[req.id])).rows[0];
      if (!s) return fail("NOT_FOUND");
      if (req.revision === s.revision && digest === s.request_hash) return this.read(db,req.id);
      if (req.revision !== s.revision + 1) return fail("STALE_REVISION");
      if (s.status !== "active") return fail("SESSION_ENDED");
      await db.query("update public.workout_sessions set status='ended',ended_at=$2,revision=$3,request_hash=$4 where id=$1",
        [req.id,this.now(),req.revision,digest]);
      await this.event(db,user,req.id,null,"ended",req);
      return this.read(db,req.id);
    });
  }
}
