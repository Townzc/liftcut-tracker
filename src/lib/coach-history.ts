import { z } from "zod";
import type { CoachSource } from "./coach-model";

export const coachTurnSchema=z.object({
  id:z.uuid(),text:z.string().min(1).max(400),at:z.iso.datetime(),
  reply:z.enum(["help","noSession","invalid","plan","progress","receipts","longTerm","replace","clarify","draft","closed","queued","failed","data","personal","personalQueued"]),
  lines:z.array(z.string().max(6000)).max(8).optional(),reason:z.string().max(80).optional(),model:z.string().max(120).optional(),
  pending:z.boolean().optional(),interrupted:z.boolean().optional(),
}).strict().refine(v=>new TextEncoder().encode(JSON.stringify(v)).length<=20000);
export type SavedCoachTurn=z.infer<typeof coachTurnSchema>;
export type CoachTurn=SavedCoachTurn&{sources?:CoachSource[]};
export const historyItemSchema=z.object({turn:coachTurnSchema,revision:z.number().int().min(1).max(1000000)}).strict();
export type HistoryItem=z.infer<typeof historyItemSchema>;
export const historySaveSchema=z.object({conversationId:z.uuid(),items:z.array(historyItemSchema).min(1).max(10)}).strict();
export const historyCursorSchema=z.object({at:z.iso.datetime(),id:z.uuid()}).strict();
export type HistoryCursor=z.infer<typeof historyCursorSchema>;
export type ConversationSummary={id:string;title:string;updatedAt:string};
export type ConversationList={items:ConversationSummary[];next:HistoryCursor|null};
export type ConversationPage={items:HistoryItem[];next:HistoryCursor|null};

/** History stores prose, never executable drafts, signed proofs or copied record rows. */
export function savedCoachTurn(turn:CoachTurn):SavedCoachTurn{
  const {id,text,at,reply,reason,model,pending,interrupted}=turn;
  return coachTurnSchema.parse({id,text,at,reply,reason,model,pending,interrupted,...(!pending&&turn.lines?{lines:turn.lines}:{} )});
}
export function restoredCoachTurn(turn:SavedCoachTurn,en=false):CoachTurn{
  if(turn.pending)return {...turn,pending:false,interrupted:true,lines:[en?"Generation was interrupted by a reload. Please resend; no changes were confirmed.":"刷新中断了这条回复，请重新发送. 没有自动确认任何修改."]};
  return turn;
}
export function mergeHistory(local:HistoryItem[],remote:HistoryItem[]):HistoryItem[]{
  const map=new Map(remote.map(i=>[i.turn.id,i]));
  for(const item of local){const other=map.get(item.turn.id);if(!other||item.revision>=other.revision)map.set(item.turn.id,item);}
  return [...map.values()].sort((a,b)=>a.turn.at.localeCompare(b.turn.at)||a.turn.id.localeCompare(b.turn.id));
}
