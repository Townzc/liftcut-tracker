"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
import {useLocale} from "next-intl";
import {ArrowLeft} from "lucide-react";
import {usePersonalRecords} from "@/components/agent/personal-records-provider";
import {Button} from "@/components/ui/button";
import {RecordSyncStatus} from "@/components/agent/personal-entry";
import {memoryFacts,type MemoryFact} from "@/lib/fitness-memory";
import {preferenceKeySchema,preferenceLabel} from "@/lib/personal-records";
import type {CoachSource} from "@/lib/coach-model";

function label(f:MemoryFact,en:boolean){
  if(f.metric==="weight")return en?"Weight":"体重";
  if(f.metric==="waist")return en?"Waist":"腰围";
  if(f.exerciseName)return f.exerciseName;
  const key=preferenceKeySchema.safeParse(f.metric.replace("preference:",""));
  return key.success?preferenceLabel(key.data,en):f.metric;
}
export function FitnessMemoryPage(){
  const en=useLocale()==="en",personal=usePersonalRecords();
  const [remote,setRemote]=useState<MemoryFact[]>([]),[error,setError]=useState(false),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
  const [confirm,setConfirm]=useState<string|null>(null),[busy,setBusy]=useState(false);
  const [truncated,setTruncated]=useState(false);
  useEffect(()=>{
    if(!personal.owner){setLoading(false);return;}
    const controller=new AbortController();setLoading(true);setError(false);
    void fetch("/api/coach-memory",{headers:{"X-Workout-Owner":personal.owner},cache:"no-store",signal:controller.signal})
      .then(async r=>{if(!r.ok)throw new Error("read");const data:CoachSource=await r.json();setRemote(data.rows as MemoryFact[]);setTruncated(data.truncated);})
      .catch(()=>{if(!controller.signal.aborted)setError(true);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[personal.owner,personal.records,refresh]);
  const facts=personal.guest?memoryFacts(personal.records):remote;
  return <div className="mx-auto max-w-2xl space-y-6 pt-6" data-testid="fitness-memory">
    <Link href="/settings" className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4"/>{en?"Settings":"设置"}</Link>
    <h1 className="text-3xl font-medium tracking-tight">{en?"Memory":"记忆"}.</h1>
    <p className="text-sm leading-6 text-muted-foreground">{en?"Your latest confirmed measurements and fitness preferences, with their original dates. Earlier records remain queryable in Agent. A new chat does not erase them.":"这里显示最近确认的身体数据、动作重量和健身偏好，并保留原始日期. 更早的记录仍可向 Agent 按日期查询，新对话不会清空这些数据."}</p>
    <p className="text-xs text-muted-foreground">{personal.guest?(en?"Saved on this browser. Sign in and confirm import for cloud storage.":"当前保存在本机. 登录并确认导入后可长期同步保存."):(en?"Saved to your account. Chat messages become memory only after you confirm an entry.":"记录保存在账号中. 聊天内容只有经你确认保存，才会成为记忆.")}</p>
    <RecordSyncStatus/>
    {truncated&&!personal.guest&&<p className="text-xs text-muted-foreground">{en?"Showing the first 100 latest facts. Ask Agent for a specific exercise to look further.":"先显示 100 项最新记忆. 可以向 Agent 指定动作名称，查询更多记录."}</p>}
    {loading&&!personal.guest?<p role="status">{en?"Loading…":"正在读取…"}</p>:error?<div role="alert"><p>{en?"Memory could not be loaded. This does not mean it is empty.":"暂时无法读取记忆，不代表没有记录."}</p><Button variant="outline" onClick={()=>setRefresh(x=>x+1)}>{en?"Retry":"重试"}</Button></div>:<div className="divide-y rounded-3xl bg-muted/30 px-5">
      {!facts.length&&<p className="py-8 text-sm text-muted-foreground">{en?"No confirmed memory yet. Tell Agent a measurement or a preference, then confirm its preview.":"还没有已确认的记忆. 可以告诉 Agent 一项数据或偏好，再确认保存."}</p>}
      {facts.map(f=><div key={f.metric} className="space-y-2 py-5" data-testid="memory-fact">
        <div className="flex items-start justify-between gap-4"><div className="space-y-1"><p className="text-xs text-muted-foreground">{label(f,en)}</p><p className="break-words text-base">{f.value}{f.unit?` ${f.unit}`:""}</p></div>
          {f.recordId&&<Button variant="ghost" size="sm" disabled={busy||personal.pending.length>0} onClick={()=>setConfirm(f.recordId)}>{en?"Undo":"撤销"}</Button>}</div>
        <p className="text-xs text-muted-foreground">{f.date} · {f.source==="workout"?(en?"Actual workout":"实际训练"):f.source==="conversation"?(en?"Confirmed in Agent":"Agent 对话确认"):(en?"Manual entry":"手动记录")}</p>
        {confirm===f.recordId&&<div className="space-y-3 rounded-xl border p-3 text-sm"><p>{en?"Undo this entire entry? It will no longer be used as memory; an earlier confirmed value may become the latest. The undo remains in history.":"撤销这整条记录？它将不再作为记忆使用；更早的已确认记录可能成为最新值. 撤销操作会保留在历史中."}</p><div className="flex gap-2"><Button size="sm" disabled={busy} onClick={async()=>{if(!f.recordId)return;setBusy(true);try{if(await personal.submit({action:"undo",id:crypto.randomUUID(),recordId:f.recordId}))setConfirm(null);}finally{setBusy(false);}}}>{en?"Confirm undo":"确认撤销"}</Button><Button size="sm" variant="ghost" onClick={()=>setConfirm(null)}>{en?"Cancel":"取消"}</Button></div></div>}
      </div>)}
    </div>}
    <Link href="/agent" className="inline-block min-h-11 py-3 text-sm underline underline-offset-4">{en?"Ask Agent to record or update a fact":"告诉 Agent 补充或更新数据"}</Link>
  </div>;
}
