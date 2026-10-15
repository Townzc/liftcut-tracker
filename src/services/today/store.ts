import "server-only";
import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { startSessionSchema, endSessionSchema, setRequestSchema, localDateAt, type Session, type TodayData, type Prescription, type StoredSet } from "@/lib/today";

import { parseWorkoutLog } from "@/lib/workout-log-parser";
import { parseLogSchema, commandSchema, undoCommandSchema, type ParsePreview, type CommandReceipt, type SetChange } from "@/lib/workout-commands";
import { workoutCanonical as canonical, storedSet as stored, workoutContext, workoutContextInput } from "@/lib/workout-context";
import { replaceExerciseSchema, undoReplacementSchema, projectReplacement, projectReplacementUndo, ReplacementConflict } from "@/lib/exercise-replacement";
import { verifyCoachProposal } from "@/services/ai/coach-proof";
import { beginOwnerTransaction } from "@/services/owner-transaction";

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
      return {setId,events:events.map(e=>({...e,created_at:e.created_at.toISOString()})),commands};
    });
  }
  async current(user:string):Promise<Session|null>{
    return this.tx(user,async db=>{
      const active=(await db.query("select id from public.workout_sessions where status='active'")).rows[0];
      return active?this.read(db,active.id):null;
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
      return { session: active ? await this.read(db, active.id) : null, days, receipts: await this.receipts(db),
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
    const tap = setRequestSchema.parse(input);
    return this.tx(user, async db => {
      let req: StoredSet = tap;
      if (tap.status === "voided") {
        const old = (await db.query("select payload from public.set_logs where id=$1 and session_id=$2", [tap.id,tap.sessionId])).rows[0]?.payload;
        if (old && (old.planExerciseId !== tap.planExerciseId || old.setIndex !== tap.setIndex)) return fail("CONTENT_CONFLICT");
        if (old && ["weightKg","reps","rpe"].every(k => old[k] === tap[k as keyof typeof tap])) {
          req = { ...old, revision: tap.revision, status: "voided" };
        }
      }
      await this.writeSetInTransaction(db,user,req);
      return this.read(db,req.sessionId);
    });
  }
  private async writeSetInTransaction(db: PoolClient, user: string, req: StoredSet, compensating = false) {
    // Same numeric/business contract for every entry point. Speech provenance is server-derived.
    setRequestSchema.parse({ ...req, inputUnit: "kg", sourceRef: "today-tap",
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
    if (!exercise || req.setIndex > exercise.sets) return fail("SET_NOT_IN_PRESCRIPTION");
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
      { before: old?.payload ?? null, after: req });
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
