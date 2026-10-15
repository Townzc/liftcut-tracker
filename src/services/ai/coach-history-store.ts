import "server-only";
import { z } from "zod";
import type { Pool,PoolClient } from "pg";
import { historySaveSchema,historyItemSchema,type HistoryCursor,type ConversationList,type ConversationPage } from "@/lib/coach-history";
import { beginOwnerTransaction } from "@/services/owner-transaction";

export class CoachHistoryError extends Error {}
export class CoachHistoryStore {
  constructor(private readonly pool:Pool){}
  private async tx<T>(owner:string,work:(db:PoolClient)=>Promise<T>):Promise<T>{
    z.uuid().parse(owner);const db=await this.pool.connect();let broken=false;
    try{await beginOwnerTransaction(db,owner,"liftcut_workout");const value=await work(db);await db.query("commit");return value;}
    catch(e){await db.query("rollback").catch(()=>{broken=true;});throw e;}finally{db.release(broken);}
  }
  async list(owner:string,before?:HistoryCursor):Promise<ConversationList>{return this.tx(owner,async db=>{
    const rows=(await db.query(`select id,title,updated_at from public.coach_conversations where user_id=$1 and deleted_at is null
      and ($2::timestamptz is null or (updated_at,id)<($2::timestamptz,$3::uuid)) order by updated_at desc,id desc limit 41`,[owner,before?.at??null,before?.id??null])).rows;
    const items=rows.slice(0,40).map(r=>({id:r.id,title:r.title,updatedAt:r.updated_at.toISOString()}));
    return {items,next:rows.length>40?{at:items.at(-1)!.updatedAt,id:items.at(-1)!.id}:null};
  });}
  async load(owner:string,id:string,before?:HistoryCursor):Promise<ConversationPage>{z.uuid().parse(id);return this.tx(owner,async db=>{
    if(!(await db.query("select id from public.coach_conversations where id=$1 and user_id=$2 and deleted_at is null",[id,owner])).rowCount)throw new CoachHistoryError("NOT_FOUND");
    const rows=(await db.query(`select payload,revision,at,id from public.coach_turns where user_id=$1 and conversation_id=$2
      and ($3::timestamptz is null or (at,id)<($3::timestamptz,$4::uuid)) order by at desc,id desc limit 51`,[owner,id,before?.at??null,before?.id??null])).rows;
    const page=rows.slice(0,50),last=page.at(-1);
    return {items:page.reverse().map(r=>historyItemSchema.parse({turn:r.payload,revision:r.revision})),next:rows.length>50?{at:last.at.toISOString(),id:last.id}:null};
  });}
  async save(owner:string,raw:unknown){const input=historySaveSchema.parse(raw);return this.tx(owner,async db=>{
    // Serialize even the first insert: both unique indexes can otherwise deadlock
    // under concurrent retries. Deletion uses the same conversation lock.
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,717))",[input.conversationId]);
    await db.query("insert into public.coach_conversations(id,user_id,title) values($1,$2,$3) on conflict(id) do nothing",[input.conversationId,owner,input.items[0].turn.text.slice(0,80)]);
    const thread=(await db.query("select deleted_at from public.coach_conversations where id=$1 and user_id=$2 for update",[input.conversationId,owner])).rows[0];
    if(!thread||thread.deleted_at)throw new CoachHistoryError("NOT_FOUND");
    for(const {turn,revision} of input.items){
      const changed=await db.query(`insert into public.coach_turns(id,conversation_id,user_id,at,revision,payload) values($1,$2,$3,$4,$5,$6::jsonb)
        on conflict(id) do update set revision=excluded.revision,payload=excluded.payload
        where coach_turns.user_id=excluded.user_id and coach_turns.conversation_id=excluded.conversation_id
        and coach_turns.at=excluded.at and (coach_turns.revision<excluded.revision or (coach_turns.revision=excluded.revision and coach_turns.payload=excluded.payload)) returning id`,
        [turn.id,input.conversationId,owner,turn.at,revision,JSON.stringify(turn)]);
      if(!changed.rowCount)throw new CoachHistoryError("HISTORY_CONFLICT");
    }
    await db.query("update public.coach_conversations set updated_at=clock_timestamp() where id=$1 and user_id=$2",[input.conversationId,owner]);
    return {saved:true};
  });}
  async remove(owner:string,id:string){z.uuid().parse(id);return this.tx(owner,async db=>{
    await db.query("select pg_advisory_xact_lock(hashtextextended($1,717))",[id]);
    // Keep an empty tombstone so a delayed offline upload cannot recreate a deleted chat.
    await db.query("insert into public.coach_conversations(id,user_id,title,deleted_at) values($1,$2,'',now()) on conflict(id) do nothing",[id,owner]);
    await db.query("update public.coach_conversations set title='',deleted_at=coalesce(deleted_at,now()) where id=$1 and user_id=$2",[id,owner]);
    await db.query("delete from public.coach_turns where conversation_id=$1 and user_id=$2",[id,owner]);
    return {deleted:true};
  });}
}
