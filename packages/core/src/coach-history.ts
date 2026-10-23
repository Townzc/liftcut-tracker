import { z } from "zod";
import type { CoachSource, CoachProposal } from "./coach-contract";

const utf8Size=(s:string)=>{let n=0;for(const c of s){const p=c.codePointAt(0)!;n+=p<=0x7f?1:p<=0x7ff?2:p<=0xffff?3:4;}return n;};

export const coachTurnSchema=z.object({
  id:z.uuid(),text:z.string().min(1).max(400),at:z.iso.datetime(),
  reply:z.enum(["help","noSession","invalid","plan","progress","receipts","longTerm","replace","clarify","draft","closed","queued","failed","data","personal","personalQueued"]),
  lines:z.array(z.string().max(6000)).max(256).optional(),reason:z.string().max(80).optional(),model:z.string().max(120).optional(),
  pending:z.boolean().optional(),interrupted:z.boolean().optional(),
}).strict().refine(v=>utf8Size(JSON.stringify(v))<=20000);
export type SavedCoachTurn=z.infer<typeof coachTurnSchema>;
export type CoachTurn=SavedCoachTurn&{sources?:CoachSource[]; proposal?:CoachProposal; live?:string; error?:string};
export const historyItemSchema=z.object({turn:coachTurnSchema,revision:z.number().int().min(1).max(1000000)}).strict();
export type HistoryItem=z.infer<typeof historyItemSchema>;
export const historySaveSchema=z.object({conversationId:z.uuid(),items:z.array(historyItemSchema).min(1).max(10)}).strict();
export const historyCursorSchema=z.object({at:z.iso.datetime(),id:z.uuid()}).strict();
export type HistoryCursor=z.infer<typeof historyCursorSchema>;
export type ConversationSummary={id:string;title:string;updatedAt:string};
export type ConversationList={items:ConversationSummary[];next:HistoryCursor|null};
export type ConversationPage={items:HistoryItem[];next:HistoryCursor|null};
export const conversationListSchema=z.object({items:z.array(z.object({id:z.uuid(),title:z.string(),updatedAt:z.string()})),next:historyCursorSchema.nullable()});
export const conversationPageSchema=z.object({items:z.array(historyItemSchema),next:historyCursorSchema.nullable()});

/** History stores prose, never executable drafts, signed proofs or copied record rows. */
export function savedCoachTurn(turn:CoachTurn):SavedCoachTurn{
  const {id,text,at,reply,reason,model,pending,interrupted}=turn;
  const lines:string[]=[];let remaining=14000,shortened=false;
  // Rule-mode progress can contain hundreds of actual sets. Keep the live reply
  // intact; bound only the stored copy and explicitly mark a shortened snapshot.
  if(!pending&&turn.lines)for(const line of turn.lines){
    if(lines.length>=255||remaining<2){shortened=true;break;}
    const length=utf8Size(JSON.stringify(line));if(length<=remaining&&line.length<=6000){lines.push(line);remaining-=length;continue;}
    let kept="",bytes=2;for(const char of line){const size=utf8Size(JSON.stringify(char))-2;if(bytes+size>remaining||kept.length+char.length>6000){shortened=true;break;}kept+=char;bytes+=size;}
    lines.push(kept);remaining-=bytes;
  }
  if(shortened)lines.push("历史内容已缩略，请重新查询完整记录. History shortened; ask again for complete current records.");
  return coachTurnSchema.parse({id,text,at,reply,reason,model,pending,interrupted,...(!pending&&turn.lines?{lines}:{} )});
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
