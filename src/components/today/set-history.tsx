"use client";
import { useState } from "react";
import { useLocale } from "next-intl";
import { useAuth } from "@/components/auth/auth-provider";
import type { StoredSet } from "@/lib/today";
type Trace = {events:{sequence:string;type:string;created_at:string;data:{before:StoredSet|null;after:StoredSet}}[];commands:{id:string;text:string}[]};
export function SetHistory({id}:{id:string}) {
  const en=useLocale()==="en",{user}=useAuth(),[trace,setTrace]=useState<Trace|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(false);
  async function load(){
    setLoading(true);setError(false);
    try{const response=await fetch(`/api/workout-sessions/trace?setId=${encodeURIComponent(id)}`,{headers:{"X-Workout-Owner":user?.id??""},cache:"no-store"});
      if(!response.ok)throw Error();setTrace(await response.json());
    }catch{setError(true);}finally{setLoading(false);}
  }
  const names:Record<string,string>=en?{recorded:"Recorded",corrected:"Corrected",voided:"Voided"}:{recorded:"记录",corrected:"更正",voided:"撤销"};
  return <details className="text-xs text-muted-foreground" onToggle={e=>{if(e.currentTarget.open)void load();}} data-testid={`trace-${id}`}>
    <summary className="w-fit min-h-8 py-2">{en?"View record source":"查看记录来源"}</summary>
    {loading?<p>{en?"Loading…":"正在读取…"}</p>:error?<p>{en?"Source not available yet. Sync the entry, then reopen.":"来源暂时无法读取，请同步后重新展开。"}</p>:trace && <ol className="space-y-3 border-l pl-4">{trace.events.map(e=><li key={e.sequence}>
      <p>{names[e.type]??e.type} · v{e.data.after.revision} · {new Date(e.created_at).toLocaleString(en?"en":"zh-CN")}</p>
      <p className="mt-1">{e.data.after.weightKg??"—"} kg × {e.data.after.reps??"—"} · RPE {e.data.after.rpe??"—"}</p>
      <p className="mt-1">{e.data.after.sourceRef==="today-tap"?(en?"Manual confirmation":"手动确认"):(en?"Conversation confirmation":"对话确认")}</p>
      {trace.commands.filter(c=>c.id===e.data.after.sourceRef).map(c=><p key={c.id} className="mt-1 whitespace-pre-wrap break-words">“{c.text}”</p>)}
    </li>)}</ol>}
  </details>;
}
