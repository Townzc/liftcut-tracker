"use client";
import { useState } from "react";
import { History,Plus,Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogTitle,DialogDescription } from "@/components/ui/dialog";
import { useCoachMemory } from "./coach-memory-provider";

export function CoachHistoryControls({en,locked,beforeChange}:{en:boolean;locked:boolean;beforeChange:()=>void}){
  const {history,snapshot}=useCoachMemory();
  const [open,setOpen]=useState(false),[deleteId,setDeleteId]=useState<string|null>(null);
  return <>
    <Button variant="ghost" size="icon" aria-label={en?"Chat history":"历史对话"} onClick={()=>{setOpen(true);void history.refreshList();}}><History className="size-5"/></Button>
    <Button variant="ghost" size="icon" disabled={locked} aria-label={en?"New conversation":"新对话"} onClick={()=>{beforeChange();history.newConversation();}}><Plus className="size-5"/></Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>{en?"Chat history":"历史对话"}</DialogTitle>
      <DialogDescription>{en?"Saved to your account. Open a conversation to continue it.":"对话保存在你的账号中，打开后可以继续聊."}</DialogDescription>
      <div className="max-h-[55dvh] space-y-1 overflow-y-auto" data-testid="coach-history-list">{snapshot.threads.map(chat=><div key={chat.id} className="flex items-center gap-1 rounded-xl hover:bg-muted">
        <button className="min-h-12 min-w-0 flex-1 truncate px-3 py-3 text-left" disabled={locked} onClick={async()=>{beforeChange();await history.select(chat.id);setOpen(false);}}>{chat.title}</button>
        <Button variant="ghost" size="icon" disabled={locked} aria-label={en?`Delete conversation ${chat.title}`:`删除对话 ${chat.title}`} onClick={()=>setDeleteId(chat.id)}><Trash2 className="size-4"/></Button>
      </div>)}</div>
      {!snapshot.threads.length&&<p className="text-sm text-muted-foreground">{en?"No saved conversations yet.":"还没有已保存的对话."}</p>}
      {snapshot.next&&<Button variant="ghost" disabled={snapshot.loading} onClick={()=>void history.refreshList(true)}>{en?"Load more":"加载更多"}</Button>}
      {snapshot.error&&<p role="status" className="text-xs">{en?"History could not sync. Reconnect and retry.":"历史暂未同步成功，请联网后重试."}<Button size="sm" variant="ghost" onClick={()=>{void history.refreshList();void history.flush();}}>{en?"Retry":"重试"}</Button></p>}
      <Dialog open={!!deleteId} onOpenChange={value=>{if(!value)setDeleteId(null);}}><DialogContent><DialogTitle>{en?"Delete this conversation?":"删除这段对话？"}</DialogTitle>
        <DialogDescription>{en?"This removes its chat history. Confirmed records, plans and receipts remain in your account.":"将删除这段聊天记录. 已确认的身体、饮食、训练记录和计划回执会保留."}</DialogDescription>
        <div className="flex gap-2"><Button disabled={locked} onClick={async()=>{if(!deleteId)return;if(deleteId===snapshot.id)beforeChange();await history.remove(deleteId);setDeleteId(null);}}>{en?"Confirm deletion":"确认删除"}</Button><Button variant="outline" onClick={()=>setDeleteId(null)}>{en?"Cancel":"取消"}</Button></div>
      </DialogContent></Dialog>
    </DialogContent></Dialog>
  </>;
}
