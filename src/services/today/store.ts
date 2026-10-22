import "server-only";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { startSessionSchema, endSessionSchema, setRequestSchema, localDateAt, type Session, type TodayData, type Prescription, type StoredSet, type ExerciseHistory } from "@liftcut/core/today";

import { parseWorkoutLog } from "@liftcut/core/workout-log-parser";
import { bestOf } from "@liftcut/core/one-rep-max";
import { parseLogSchema, commandSchema, undoCommandSchema, type ParsePreview, type CommandReceipt, type SetChange } from "@liftcut/core/workout-commands";
import { workoutCanonical as canonical, storedSet as stored, workoutContext, workoutContextInput } from "@liftcut/core/workout-context";
import { replaceExerciseSchema, undoReplacementSchema, projectReplacement, projectReplacementUndo, ReplacementConflict } from "@liftcut/core/exercise-replacement";
import { verifyCoachProposal } from "@/services/ai/coach-proof";
import { beginOwnerTransaction } from "@/services/owner-transaction";
import { confirmReviewedSetDraft, type ReviewedSetDraft } from "@liftcut/core/confirmed-set-reference";
import { workoutReviewApprovalSchema, reviewBasis, referenceFor, type WorkoutReview, type WorkoutConversationState } from "@liftcut/core/workout-review";
import { resolveConfirmedSet } from "@liftcut/core/confirmed-set-reference";

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
      await beginOwnerTransaction(db,user,"liftcut_workout");
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
    const replacements = (await db.query(`select c.receipt,u.receipt as undo from public.workout_exercise_changes c
      left join public.workout_exercise_changes u on u.parent_id=c.id where c.session_id=$1 and c.parent_id is null
      order by c.created_at,c.id`,[id])).rows.map(r=>({...r.receipt,undo:r.undo??null}));
    return { id: s.id, userId: s.user_id, localDate: s.day, timezone: s.timezone, trainingPlanId: s.training_plan_id,
      weekNumber: s.week_number, dayNumber: s.day_number, status: s.status, revision: s.revision, prescription: s.prescription,
      startedAt: s.started_at.toISOString(), endedAt: s.ended_at?.toISOString() ?? null, replacements,
      sets: sets.map(r => ({ ...r.payload, exerciseName: r.exercise_name, updatedAt: r.updated_at.toISOString() })) };
  }
  private async event(db: PoolClient, user: string, session: string, record: string | null, type: string, data: unknown) {
    await db.query("insert into public.workout_session_events(user_id,session_id,set_log_id,type,data) values($1,$2,$3,$4,$5)",
      [user, session, record, type, JSON.stringify(data)]);
  }
  /**
   * Engine input for every exercise of the active plan and session, so a session started
   * offline already has it: the last 8 ended sessions per name and all-time bests.
   */
  private async exerciseHistory(db: PoolClient, session: Session | null): Promise<Record<string, ExerciseHistory>> {
    const planned = (await db.query(`select distinct e.name from public.training_plans p join public.training_plan_weeks w on w.training_plan_id=p.id
      join public.training_plan_days d on d.week_id=w.id join public.training_plan_exercises e on e.day_id=d.id where p.is_active`)).rows;
    const names = [...new Set([...(session?.prescription.exercises.map(e => e.name) ?? []), ...planned.map(r => r.name as string)])];
    const recent = (await db.query(`select s.local_date::text as date,e->>'name' as name,coalesce(jsonb_agg(jsonb_build_object(
        'setIndex',l.set_index,'status',l.status,'weightKg',l.weight_kg,'reps',l.reps) order by l.set_index) filter (where l.id is not null),'[]') as sets
      from public.workout_sessions s cross join lateral jsonb_array_elements(s.prescription->'exercises') e
      left join public.set_logs l on l.session_id=s.id and l.plan_exercise_id=e->>'id'
      where s.status='ended' and e->>'name'=any($1::text[])
      group by s.id,s.local_date,s.started_at,e->>'id',e->>'name' order by s.local_date,s.started_at,s.id`,[names])).rows;
    const lifts = (await db.query(`select l.exercise_name as name,l.weight_kg as weight,l.reps from public.set_logs l
      join public.workout_sessions s on s.id=l.session_id where l.status='done' and s.status='ended' and l.exercise_name=any($1::text[])
      union all select e.name,e.actual_weight,e.actual_reps from public.workout_log_exercises e
      join public.workout_logs w on w.id=e.workout_log_id where e.completed and e.name=any($1::text[])`,[names])).rows;
    return Object.fromEntries(names.map(name => [name, {
      sessions: recent.filter(r => r.name === name).slice(-8).map(r => ({ date: r.date, sets: r.sets })),
      best: bestOf(lifts.filter(r => r.name === name).map(r => ({ date: "", weightKg: r.weight === null ? null : Number(r.weight), reps: r.reps }))),
    }]));
  }
  async history(user: string): Promise<Session[]> {
    return this.tx(user, async db => {
      const rows = (await db.query("select id from public.workout_sessions order by started_at desc")).rows;
      // This transaction owns one pg client. Pipelining separate session reads
      // on that client is deprecated; keep its queries ordered and awaited.
      const sessions: Session[] = [];
      for (const row of rows) sessions.push(await this.read(db, row.id));
      return sessions;
    });
  }
  async trace(user: string, setId: string) {
    z.uuid().parse(setId);
    return this.tx(user, async db => {
      if (!(await db.query("select id from public.set_logs where id=$1",[setId])).rowCount) return fail("NOT_FOUND");
      const events = (await db.query(`select sequence::text,type,data,created_at from public.workout_session_events
        where set_log_id=$1 order by sequence`,[setId])).rows;
      const sources = [...new Set(events.flatMap(e=>[e.data.before?.sourceRef,e.data.after?.sourceRef]).filter(Boolean))];
      const commands = (await db.query("select receipt from public.workout_commands where id::text=any($1::text[])",[sources])).rows.map(r=>r.receipt);
      const reviews=(await db.query(`select payload,applied_at from public.workout_coach_reviews
        where status='applied' and payload->'requests' @> $1::jsonb order by applied_at`,[JSON.stringify([{id:setId}])])).rows;
      return {setId,events:events.map(e=>({...e,created_at:e.created_at.toISOString()})),commands,
        reviews:reviews.map(r=>({review:r.payload,appliedAt:r.applied_at.toISOString()}))};
    });
  }
  async current(user:string):Promise<Session|null>{
    return this.tx(user,async db=>{
      const active=(await db.query("select id from public.workout_sessions where status='active'")).rows[0];
      return active?this.read(db,active.id):null;
    });
  }
  /** Invalidate the old confirmation card before starting another model request.
   * Persisted focus comes only from a successfully committed preview. */
  async beginConversation(user:string, conversationId:string, requestId:string) {
    z.uuid().parse(conversationId); z.uuid().parse(requestId);
    return this.tx(user,async db=>{
      await db.query("select pg_advisory_xact_lock(hashtextextended($1,717))",[conversationId]);
      if((await db.query("select id from public.coach_conversations where id=$1 and deleted_at is not null",[conversationId])).rowCount)return fail("CONVERSATION_DELETED");
      const active=(await db.query("select id from public.workout_sessions where status='active'")).rows[0];
      if(!active)return null;
      const session=await this.read(db,active.id);
      const old=(await db.query("select * from public.workout_coach_contexts where conversation_id=$1",[conversationId])).rows[0];
      const state:WorkoutConversationState=old?.session_id===session.id?old.state:{focus:null,pendingText:null};
      await db.query("update public.workout_coach_reviews set status='superseded' where conversation_id=$1 and status='pending'",[conversationId]);
      await db.query(`insert into public.workout_coach_contexts(user_id,conversation_id,request_id,session_id,state)
        values($1,$2,$3,$4,$5) on conflict(user_id,conversation_id) do update
        set request_id=excluded.request_id,session_id=excluded.session_id,state=excluded.state,updated_at=now()`,
        [user,conversationId,requestId,session.id,JSON.stringify(state)]);
      return {session,state};
    });
  }
  async holdConversation(user:string, conversationId:string, requestId:string, text:string) {
    return this.tx(user,async db=>{
      const row=(await db.query("select state from public.workout_coach_contexts where conversation_id=$1 and request_id=$2",[conversationId,requestId])).rows[0];
      if(!row)return fail("STALE_CONVERSATION");
      await db.query("update public.workout_coach_contexts set state=$2,updated_at=now() where conversation_id=$1",
        [conversationId,JSON.stringify({...row.state,pendingText:text.slice(0,400)})]);
    });
  }
  async prepareReview(user:string, preview:WorkoutReview) {
    return this.tx(user,async db=>{
      const row=(await db.query("select request_id,session_id from public.workout_coach_contexts where conversation_id=$1",[preview.conversationId])).rows[0];
      if(!row||row.request_id!==preview.requestId||row.session_id!==preview.sessionId)return fail("STALE_CONVERSATION");
      const session=await this.read(db,preview.sessionId);
      if(session.status!=="active"||preview.basis!==reviewBasis(session))return fail("STALE_CONTEXT");
      for(const reference of preview.references)resolveConfirmedSet(session,{reference});
      await db.query(`insert into public.workout_coach_reviews(id,user_id,conversation_id,session_id,request_id,payload)
        values($1,$2,$3,$4,$5,$6)`,[preview.id,user,preview.conversationId,preview.sessionId,preview.requestId,JSON.stringify(preview)]);
      await db.query("update public.workout_coach_contexts set state=jsonb_set(state,'{pendingText}',$2::jsonb),updated_at=now() where conversation_id=$1",
        [preview.conversationId,JSON.stringify(preview.text)]);
      return preview;
    });
  }
  async approveReview(user:string,input:unknown) {
    const req=workoutReviewApprovalSchema.parse(input);
    return this.tx(user,async db=>{
      const row=(await db.query("select * from public.workout_coach_reviews where id=$1 and conversation_id=$2 and session_id=$3",
        [req.id,req.conversationId,req.sessionId])).rows[0];
      if(!row)return fail("NOT_FOUND");
      const preview=row.payload as WorkoutReview, session=await this.read(db,req.sessionId);
      // Exact retry is harmless; replay after any affected record changed is not.
      if(row.status==="applied"){
        if(!preview.requests.every(r=>session.sets.some(s=>canonical(stored(s))===canonical(r))))return fail("STALE_CONTEXT");
        return this.commandResult(db,req.sessionId);
      }
      const context=(await db.query("select request_id from public.workout_coach_contexts where conversation_id=$1",[req.conversationId])).rows[0];
      if(row.status!=="pending"||context?.request_id!==preview.requestId)return fail("PREVIEW_SUPERSEDED");
      if(preview.basis!==reviewBasis(session)||session.status!=="active")return fail("STALE_CONTEXT");
      for(const reference of preview.references)resolveConfirmedSet(session,{reference});
      for(const request of preview.requests)await this.writeSetInTransaction(db,user,request,false,
        {version:"confirmed-context-v1",kind:preview.kind,references:preview.references},true);
      const last=preview.requests.at(-1)!;
      const state:WorkoutConversationState={focus:last.status==="done"?referenceFor(last):null,pendingText:null};
      await db.query("update public.workout_coach_reviews set status='applied',applied_at=now() where id=$1",[req.id]);
      await db.query("update public.workout_coach_contexts set state=$2,updated_at=now() where conversation_id=$1",[req.conversationId,JSON.stringify(state)]);
      return this.commandResult(db,req.sessionId);
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
      const session = active ? await this.read(db, active.id) : null;
      return { session, days, receipts: await this.receipts(db),
        previous: Object.fromEntries(rows.map(r => [r.name, { weightKg: r.weight === null ? null : Number(r.weight), reps: r.reps }])),
        history: await this.exerciseHistory(db, session) };
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
    const tap = setRequestSchema.parse(input);
    return this.tx(user, async db => {
      let req: StoredSet = tap;
      const existing=(await db.query("select payload from public.set_logs where id=$1 and session_id=$2",[tap.id,tap.sessionId])).rows[0]?.payload;
      // A repetition/RPE edit must not erase a per-hand load that the legacy
      // scalar tap form cannot represent. An explicit new total load replaces it.
      if(existing?.perHandLoad&&tap.weightKg===null&&tap.status==="done")
        req={...tap,perHandLoad:existing.perHandLoad,weightSource:null};
      if (tap.status === "voided") {
        const old = existing;
        if (old && (old.planExerciseId !== tap.planExerciseId || old.setIndex !== tap.setIndex)) return fail("CONTENT_CONFLICT");
        if (old && ["weightKg","reps","rpe"].every(k => old[k] === tap[k as keyof typeof tap])) {
          req = { ...old, revision: tap.revision, status: "voided" };
        }
      }
      await this.writeSetInTransaction(db,user,req);
      return this.read(db,req.sessionId);
    });
  }
  /** Experimental internal port, deliberately NOT exposed by an HTTP route.
   * retained must come from trusted server memory after source validation, never
   * from request JSON. Uses the same owner lock, write validation and event log. */
  async confirmReviewedSet(user: string, retained: ReviewedSetDraft, shown: ReviewedSetDraft,
    authorization: "confirm_preview"): Promise<Session> {
    return this.tx(user, async db => {
      const session = await this.read(db, retained.sessionId);
      if (authorization !== "confirm_preview" || canonical(retained) !== canonical(shown)
          || retained.owner !== user || retained.requests.length !== 1) return fail("INVALID_APPROVAL");
      const req = retained.requests[0];
      // Exact retry after a lost response is idempotent. A changed or voided
      // result cannot be resurrected by replaying an earlier approval.
      const old = session.sets.find(s => s.id === req.id);
      if (old && canonical(stored(old)) === canonical(req)) return session;
      const requests = confirmReviewedSetDraft(session, retained, shown, authorization);
      for (const request of requests) await this.writeSetInTransaction(db, user, request, false,
        {version:retained.version,kind:retained.kind,references:retained.references});
      return this.read(db, session.id);
    });
  }
  private async writeSetInTransaction(db: PoolClient, user: string, req: StoredSet, compensating = false,
    approval?: {version:string;kind:string;references:ReviewedSetDraft["references"]}, reviewedExtra = false) {
    // Same numeric/business contract for every entry point. Speech provenance is server-derived.
    const {perHandLoad,...base}=req;
    if(perHandLoad){z.strictObject({value:z.number().min(0).max(1000),unit:z.enum(["kg","lb"])}).parse(perHandLoad);
      if(req.weightKg!==null||req.weightSource!==null) return fail("LOAD_BASIS_CONFLICT");}
    setRequestSchema.parse({ ...base, inputUnit: "kg", sourceRef: "today-tap",
      weightSource: req.weightSource === "user_said" ? "user_entered" : req.weightSource,
      repsSource: req.repsSource === "user_said" ? "user_entered" : req.repsSource });
    const digest = hash(req);
    const session = (await db.query("select status,prescription from public.workout_sessions where id=$1 for update", [req.sessionId])).rows[0];
    if (!session) return fail("NOT_FOUND");
    const old = (await db.query("select * from public.set_logs where id=$1", [req.id])).rows[0];
    if (old) {
      if (old.session_id !== req.sessionId || old.plan_exercise_id !== req.planExerciseId || old.set_index !== req.setIndex) return fail("CONTENT_CONFLICT");
      if (req.revision === old.revision) {
        if (old.request_hash !== digest) return fail("CONTENT_CONFLICT");
        return;
      }
      if (req.revision !== old.revision + 1) return fail("STALE_REVISION");
      if (old.status === "voided") return fail("SET_VOIDED");
    } else if (req.revision !== 1 || req.status === "voided") return fail("STALE_REVISION");
    if (session.status !== "active" && !compensating) return fail("SESSION_ENDED");
    const exercise = (session.prescription as Prescription).exercises.find(e => e.id === req.planExerciseId);
    if (!exercise || req.setIndex > exercise.sets && !reviewedExtra && !old) return fail("SET_NOT_IN_PRESCRIPTION");
    if (req.status === "voided" && !["done", "skipped"].includes(old.status)) return fail("NOT_COMPLETED");
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
      { before: old?.payload ?? null, after: req, ...(approval?{approval}:{}) });
    return;
  }
  private context(session: Session, selectedExerciseId?: string) {
    return workoutContext(session,selectedExerciseId);
  }
  private contextHash(session: Session) {
    return hash(workoutContextInput(session));
  }
  private async receipts(db: PoolClient): Promise<CommandReceipt[]> {
    const rows = (await db.query(`select c.receipt,u.receipt as undo from public.workout_commands c
      left join public.workout_commands u on u.parent_id=c.id where c.parent_id is null
      order by c.created_at desc,c.id desc limit 20`)).rows;
    return rows.map(r => ({...r.receipt, undo:r.undo ?? null}));
  }
  private async commandResult(db: PoolClient, sessionId: string) {
    return { session:await this.read(db,sessionId), receipts:await this.receipts(db) };
  }
  async preview(user: string, input: unknown): Promise<ParsePreview> {
    const req = parseLogSchema.parse(input);
    return this.tx(user, async db => {
      const session = await this.read(db,req.sessionId);
      if (session.status !== "active") return fail("SESSION_ENDED");
      return { result:parseWorkoutLog(req.text,this.context(session,req.selectedExerciseId)),
        contextHash:this.contextHash(session), parser:"rules-v1" };
    });
  }
  async command(user: string, input: unknown) {
    const req = commandSchema.parse(input), digest = hash(req);
    return this.tx(user, async db => {
      const old = (await db.query("select * from public.workout_commands where id=$1",[req.id])).rows[0];
      if (old) {
        if (old.request_hash !== digest || old.parent_id) return fail("CONTENT_CONFLICT");
        return this.commandResult(db,old.session_id); // Includes any compensation; never reapply.
      }
      let model;
      if(req.modelProof){const {modelProof,...binding}=req;try{model=verifyCoachProposal(user,binding,modelProof);}catch{return fail("MODEL_PROPOSAL_INVALID_OR_EXPIRED");}}
      await db.query("select id from public.workout_sessions where id=$1 for update",[req.sessionId]);
      const session = await this.read(db,req.sessionId);
      if (session.status !== "active") return fail("SESSION_ENDED");
      if (this.contextHash(session) !== req.contextHash) return fail("STALE_CONTEXT");
      const parsed = parseWorkoutLog(req.text,this.context(session,req.selectedExerciseId));
      if (parsed.status !== "draft") return fail("NEEDS_CLARIFICATION");
      const draft = parsed.draft;
      if (draft.kind === "end") return fail("END_REQUIRES_CONFIRMATION");
      const count = draft.kind === "correct" ? 0 : draft.kind === "record" ? draft.sets.length : 1;
      if (req.setIds.length !== count) return fail("CONTENT_CONFLICT");
      const changes: SetChange[] = [];
      const exercise = session.prescription.exercises.find(e => e.id === draft.exerciseId)!;
      if (draft.kind === "correct") {
        const before = stored(session.sets.find(s => s.id === draft.recordId)!);
        changes.push({before,after:{...before,revision:before.revision+1,reps:draft.changes.reps,
          repsSource:"user_said",sourceRef:req.id},exerciseName:exercise.name});
      } else {
        const sets = draft.kind === "record" ? draft.sets : [{setIndex:draft.setIndex,weightKg:null,reps:null,rpe:null,inputUnit:null}];
        sets.forEach((s,i) => changes.push({before:null,exerciseName:exercise.name,after:{
          id:req.setIds[i],sessionId:session.id,planExerciseId:exercise.id,setIndex:s.setIndex,revision:1,
          status:draft.kind === "skip" ? "skipped" : "done",weightKg:s.weightKg,reps:s.reps,rpe:s.rpe,
          weightSource:s.weightKg===null?null:"user_said",repsSource:s.reps===null?null:"user_said",
          inputUnit:s.inputUnit ?? "kg",sourceRef:req.id }}));
      }
      // Deliberately one PoolClient/transaction, including all events and the receipt.
      for (const change of changes) await this.writeSetInTransaction(db,user,change.after);
      const receipt: CommandReceipt = {id:req.id,sessionId:session.id,text:req.originalText??req.text,draft,changes,...(model?{model}:{}),
        createdAt:this.now().toISOString(),undo:null};
      await db.query(`insert into public.workout_commands(id,user_id,session_id,version,request_hash,receipt)
        values($1,$2,$3,1,$4,$5)`,[req.id,user,session.id,digest,JSON.stringify(receipt)]);
      return this.commandResult(db,session.id);
    });
  }
  async undoCommand(user: string, input: unknown) {
    const req = undoCommandSchema.parse(input), digest = hash(req);
    return this.tx(user, async db => {
      const old = (await db.query("select * from public.workout_commands where id=$1",[req.id])).rows[0];
      if (old) {
        if (old.request_hash !== digest || old.parent_id !== req.commandId) return fail("CONTENT_CONFLICT");
        return this.commandResult(db,old.session_id);
      }
      const row = (await db.query("select * from public.workout_commands where id=$1 and parent_id is null",[req.commandId])).rows[0];
      if (!row) return fail("NOT_FOUND");
      if ((await db.query("select id from public.workout_commands where parent_id=$1",[req.commandId])).rowCount) return fail("ALREADY_UNDONE");
      const receipt = row.receipt as CommandReceipt;
      await db.query("select id from public.workout_sessions where id=$1 for update",[row.session_id]);
      const changes: SetChange[] = [];
      for (const original of receipt.changes) {
        const current = (await db.query("select payload from public.set_logs where id=$1",[original.after.id])).rows[0]?.payload;
        if (hash(current ?? null) !== hash(original.after)) return fail("STALE_REVISION");
        const after: StoredSet = original.before ? {...original.before,revision:current.revision+1}
          : {...current,revision:current.revision+1,status:"voided"};
        await this.writeSetInTransaction(db,user,after,true);
        changes.push({before:current,after,exerciseName:original.exerciseName});
      }
      const undo = {id:req.id,createdAt:this.now().toISOString(),changes};
      await db.query(`insert into public.workout_commands(id,user_id,session_id,version,request_hash,parent_id,receipt)
        values($1,$2,$3,1,$4,$5,$6)`,[req.id,user,row.session_id,digest,req.commandId,JSON.stringify(undo)]);
      await this.event(db,user,row.session_id,null,"command_compensated",{commandId:req.commandId,undoId:req.id});
      return this.commandResult(db,row.session_id);
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
  async replaceExercise(user:string,input:unknown,undo=false):Promise<Session> {
    const req=(undo?undoReplacementSchema:replaceExerciseSchema).parse(input),digest=hash(req);
    return this.tx(user,async db=>{
      const old=(await db.query("select * from public.workout_exercise_changes where id=$1",[req.id])).rows[0];
      const parent="replacementId" in req?req.replacementId:null;
      if(old) {
        if(old.request_hash!==digest || old.parent_id!==parent) return fail("CONTENT_CONFLICT");
        return this.read(db,old.session_id); // Return current state and original receipt, including any later undo.
      }
      await db.query("select id from public.workout_sessions where id=$1 for update",[req.sessionId]);
      const session=await this.read(db,req.sessionId);
      if(this.contextHash(session)!==req.contextHash)return fail("STALE_CONTEXT");
      let projected:Session;
      try {projected=undo?projectReplacementUndo(session,req,this.now().toISOString()):projectReplacement(session,req,this.now().toISOString());}
      catch(error) {if(error instanceof ReplacementConflict)return fail(error.message);throw error;}
      const receipt=parent?projected.replacements!.find(r=>r.id===parent)!.undo!:projected.replacements!.find(r=>r.id===req.id)!;
      await db.query("update public.workout_sessions set prescription=$2,revision=$3,request_hash=$4 where id=$1",
        [session.id,JSON.stringify(projected.prescription),projected.revision,digest]);
      await db.query(`insert into public.workout_exercise_changes(id,user_id,session_id,version,request_hash,parent_id,new_exercise_id,receipt)
        values($1,$2,$3,1,$4,$5,$6,$7)`,[req.id,user,session.id,digest,parent,req.newExerciseId,JSON.stringify(receipt)]);
      await this.event(db,user,session.id,null,undo?"exercise_replacement_compensated":"exercise_replaced",{receiptId:req.id,parentId:parent,before:receipt.before,after:receipt.after});
      return this.read(db,session.id);
    });
  }
}
