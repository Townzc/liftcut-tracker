import "server-only";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { z } from "zod";
import { personalCommandSchema, parsePersonalEntry, type PersonalRecord } from "@/lib/personal-records";
import { workoutCanonical } from "@liftcut/core/workout-context";
import { TodayConflict } from "./store";
import { verifyCoachProposal } from "@/services/ai/coach-proof";

export class PersonalRecordStore {
  constructor(private readonly pool: Pool) {}
  private async tx<T>(user: string, work: (db: import("pg").PoolClient) => Promise<T>) {
    z.uuid().parse(user);
    const db = await this.pool.connect(); let broken = false;
    try {
      const role = (await db.query("select rolname,rolsuper,rolbypassrls from pg_roles where rolname=current_user")).rows[0];
      if (role.rolname !== "liftcut_workout" || role.rolsuper || role.rolbypassrls) throw new Error("UNSAFE_DATABASE_ROLE");
      await db.query("begin");
      await db.query("set local statement_timeout='10s'");
      await db.query("set local lock_timeout='5s'");
      await db.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);
      await db.query("select pg_advisory_xact_lock(hashtextextended($1,715))",[user]);
      const result = await work(db); await db.query("commit"); return result;
    } catch (error) { await db.query("rollback").catch(() => {broken = true;});
      if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new TodayConflict("CONTENT_CONFLICT");
      throw error;
    } finally { db.release(broken); }
  }
  async list(user: string): Promise<PersonalRecord[]> {
    return this.tx(user, async db => (await db.query(`select e.id,e.request,e.receipt,e.created_at,u.id as undo_id,u.created_at as undo_at
      from public.personal_record_events e left join public.personal_record_events u on u.parent_id=e.id
      where e.user_id=$1 and e.parent_id is null order by e.created_at desc,e.id`,[user])).rows.map(r => ({
        id:r.id,entry:r.request.entry,source:r.request.source,text:r.request.text,createdAt:r.created_at.toISOString(),
        undo:r.undo_id ? {id:r.undo_id,createdAt:r.undo_at.toISOString()} : null,
        ...(r.receipt.model?{model:r.receipt.model}:{}),
      })));
  }
  async command(user: string, input: unknown) {
    const req = personalCommandSchema.parse(input), canonical = workoutCanonical(req);
    const digest = createHash("sha256").update(canonical).digest("hex");
    return this.tx(user, async db => {
      const old = (await db.query("select request_hash,receipt from public.personal_record_events where id=$1",[req.id])).rows[0];
      if (old) { if (old.request_hash !== digest) throw new TodayConflict("CONTENT_CONFLICT"); return old.receipt; }
      let model;
      if(req.action==="create"){
        if(req.modelProof){
          const {modelProof,...binding}=req;
          if(req.source!=="conversation")throw new TodayConflict("DRAFT_MISMATCH");
          try{model=verifyCoachProposal(user,binding,modelProof);}catch{throw new TodayConflict("MODEL_PROPOSAL_INVALID_OR_EXPIRED");}
        }else if(req.source==="conversation"&&workoutCanonical(parsePersonalEntry(req.text,req.anchorDate))!==workoutCanonical(req.entry))throw new TodayConflict("DRAFT_MISMATCH");
      }
      if (req.action === "undo") {
        const original = (await db.query("select id from public.personal_record_events where id=$1 and parent_id is null",[req.recordId])).rows[0];
        if (!original) throw new TodayConflict("NOT_FOUND");
        if ((await db.query("select id from public.personal_record_events where parent_id=$1",[req.recordId])).rowCount) throw new TodayConflict("ALREADY_VOIDED");
      }
      const receipt = {id:req.id,action:req.action,recordId:req.action === "create" ? req.id : req.recordId,createdAt:new Date().toISOString(),...(model?{model}:{})};
      await db.query(`insert into public.personal_record_events(id,user_id,parent_id,request_hash,request,receipt,created_at)
        values($1,$2,$3,$4,$5,$6,$7)`,[req.id,user,req.action === "undo" ? req.recordId : null,digest,req,receipt,receipt.createdAt]);
      return receipt;
    });
  }
}
