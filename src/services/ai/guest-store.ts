import "server-only";
import {createHash} from "node:crypto";
import type {Pool,PoolClient} from "pg";
import {z} from "zod";
import {beginOwnerTransaction} from "@/services/owner-transaction";
import {guestFactsSchema} from "@/lib/personal-records";
import { workoutCanonical } from "@liftcut/core/workout-context";

export const GUEST_DAILY_LIMIT=10;
export class GuestError extends Error{}
export const guestImportSchema=z.object({workspaceId:z.uuid(),records:guestFactsSchema.min(1),confirm:z.literal(true)}).strict();
export class GuestStore{
  constructor(private pool:Pool){}
  private async tx<T>(scope:string,work:(db:PoolClient)=>Promise<T>){
    z.uuid().parse(scope);const db=await this.pool.connect();let broken=false;
    try{await beginOwnerTransaction(db,scope,"liftcut_workout");const result=await work(db);await db.query("commit");return result;}
    catch(e){await db.query("rollback").catch(()=>{broken=true;});if(e&&typeof e==="object"&&"code" in e&&e.code==="23505")throw new GuestError("IMPORT_CONFLICT");throw e;}
    finally{db.release(broken);}
  }
  async quota(guest:string){return this.tx(guest,async db=>{
    const {count}=(await db.query("select count(*)::int as count from coach_private.guest_ai_usage where guest_id=$1 and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'",[guest])).rows[0];
    return {remaining:Math.max(0,GUEST_DAILY_LIMIT-count),limit:GUEST_DAILY_LIMIT};
  });}
  async reserve(guest:string,network:string,id:string){
    z.uuid().parse(id);z.string().regex(/^[0-9a-f]{64}$/).parse(network);
    return this.tx(guest,async db=>{
      // The lock protects all three cost budgets from simultaneous requests.
      // It is held only for this short transaction, never while calling a model.
      await db.query("select pg_advisory_xact_lock(78130429)");
      if((await db.query("select 1 from coach_private.guest_ai_usage where request_id=$1",[id])).rowCount)throw new GuestError("REQUEST_ALREADY_USED");
      const c=(await db.query(`select count(*)::int as total,
        count(*) filter(where guest_id=$1)::int as guest,
        count(*) filter(where network_hash=$2)::int as network,
        count(*) filter(where guest_id=$1 and created_at>now()-interval '1 minute')::int as burst,
        count(*) filter(where network_hash=$2 and created_at>now()-interval '1 minute')::int as network_burst
        from coach_private.guest_ai_usage where created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'`,[guest,network])).rows[0];
      if(c.guest>=GUEST_DAILY_LIMIT||c.network>=40||c.total>=500)throw new GuestError("GUEST_DAILY_LIMIT");
      if(c.burst>=6||c.network_burst>=12)throw new GuestError("GUEST_RATE_LIMITED");
      await db.query("insert into coach_private.guest_ai_usage(request_id,guest_id,network_hash) values($1,$2,$3)",[id,guest,network]);
      return {remaining:GUEST_DAILY_LIMIT-c.guest-1,limit:GUEST_DAILY_LIMIT};
    });
  }
  async import(owner:string,guest:string,input:unknown){
    z.uuid().parse(guest);const req=guestImportSchema.parse(input);
    const canonical=workoutCanonical({...req,records:[...req.records].sort((a,b)=>a.id.localeCompare(b.id))});
    const hash=createHash("sha256").update(canonical).digest("hex");
    return this.tx(owner,async db=>{
      await db.query("select pg_advisory_xact_lock(hashtextextended($1,715))",[owner]);
      const receipt={workspaceId:req.workspaceId,count:req.records.length,recordIds:req.records.map(r=>r.id),createdAt:new Date().toISOString()};
      const inserted=await db.query(`insert into coach_private.guest_imports(workspace_id,guest_id,user_id,request_hash,receipt)
        values($1,$2,$3,$4,$5) on conflict(workspace_id) do nothing returning workspace_id`,[req.workspaceId,guest,owner,hash,receipt]);
      if(!inserted.rowCount){
        const old=(await db.query("select guest_id,request_hash,receipt from coach_private.guest_imports where workspace_id=$1",[req.workspaceId])).rows[0];
        if(!old||old.request_hash!==hash)throw new GuestError("IMPORT_CONFLICT");
        return old.receipt as typeof receipt;
      }
      for(const fact of req.records){
        const command={action:"create",id:fact.id,entry:fact.entry,source:fact.source,text:fact.text,anchorDate:fact.entry.date};
        const recordReceipt={id:fact.id,action:"create",recordId:fact.id,createdAt:fact.createdAt,importedFrom:"guest",importedAt:receipt.createdAt};
        await db.query(`insert into public.personal_record_events(id,user_id,parent_id,request_hash,request,receipt,created_at)
          values($1,$2,null,$3,$4,$5,$6)`,[fact.id,owner,createHash("sha256").update(workoutCanonical(command)).digest("hex"),command,recordReceipt,fact.createdAt]);
      }
      return receipt;
    });
  }
}
