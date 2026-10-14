"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RunView, Binding } from "@/lib/agent/contracts";
import { PlanPreview } from "./plan-preview";
import { useTrackerStore } from "@/store/use-tracker-store";
import { planChanges } from "@/lib/agent/plan-changes";

async function api<T>(path:string,body?:unknown):Promise<T>{
  const response=await fetch(`/api/agent/runs${path}`,{cache:"no-store",...(body===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
  const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||"OUTCOME_UNKNOWN");return result.value;
}
const bind=(r:RunView):Binding=>({proposalId:r.proposal!.proposalId,contentHash:r.proposal!.contentHash,contextRevision:r.proposal!.contextRevision});
export function CoachPlans({owner,fresh,en,locked,onSelect,onBusy}:{owner:string;fresh:RunView|null;en:boolean;locked:boolean;onSelect:(id:string|undefined)=>void;onBusy:(value:boolean)=>void}){
  const [runs,setRuns]=useState<RunView[]>([]),[selected,setSelected]=useState<string|null>(null),[error,setError]=useState("");
  const [busy,setBusy]=useState(false),flight=useRef(false),mounted=useRef(true),listRequest=useRef(0);
  const refreshUserData=useTrackerStore(s=>s.refreshUserData);
  useEffect(()=>{mounted.current=true;let alive=true;const request=++listRequest.current;
    void api<RunView[]>("").then(values=>{if(alive&&request===listRequest.current){setRuns(values);const pending=values.find(r=>["awaiting_approval","approved"].includes(r.status));if(pending)setSelected(pending.id);}}).catch(()=>{if(alive&&request===listRequest.current)setError(en?"Plan history could not be read. Try refreshing.":"暂时无法读取计划提案，可以刷新重试。");});
    return()=>{alive=false;mounted.current=false;};
  },[owner,en]);
  useEffect(()=>{if(fresh){const request=++listRequest.current;setRuns(previous=>[fresh,...previous.filter(r=>r.id!==fresh.id)].slice(0,5));setSelected(fresh.id);setError("");
    void api<RunView[]>("").then(values=>{if(mounted.current&&request===listRequest.current)setRuns(values);}).catch(()=>{});
  }},[fresh]);
  useEffect(()=>{onSelect(selected??undefined);},[selected,onSelect]);
  const run=runs.find(r=>r.id===selected);
  const changes=run?.proposal?planChanges(run.baseline,run.proposal.plan,en):[];
  const received=(value:RunView)=>{if(mounted.current)setRuns(previous=>previous.map(r=>r.id===value.id?value:r));};
  async function act(action:"apply"|"decline"|"refresh"){
    if(!run||flight.current||locked)return;flight.current=true;setBusy(true);onBusy(true);setError("");
    try{
      let current=await api<RunView>(`/${run.id}`);received(current);
      if(action==="refresh"||current.status==="applied")return;
      if(!current.proposal||!run.proposal||current.proposal.contentHash!==run.proposal.contentHash||current.proposal.proposalId!==run.proposal.proposalId)throw new Error("VERSION_CONFLICT");
      if(action==="decline"){
        current=await api<RunView>(`/${current.id}/user-events`,{action:"decline",expectedRevision:current.revision,binding:bind(current)});received(current);return;
      }
      if(current.status==="awaiting_approval"){
        current=await api<RunView>(`/${current.id}/user-events`,{action:"approve",expectedRevision:current.revision,binding:bind(current)});received(current);
      }
      if(current.status!=="approved")throw new Error("NEW_PREVIEW_REQUIRED");
      await api(`/${current.id}/execute`,{binding:bind(current),approvalId:current.approvalId,idempotencyKey:current.proposal!.proposalId});
      received(await api<RunView>(`/${current.id}`));
      // Receipt is the authoritative success; refreshing the optional client cache
      // is independent and cannot turn a committed plan into a failed write.
      void refreshUserData().catch(()=>{});
    }catch(e){if(mounted.current)setError(en?`Result not confirmed (${e instanceof Error?e.message:"unknown"}). Refresh status before retrying.`:
      `结果尚未确认（${e instanceof Error?e.message:"unknown"}）。请先刷新状态，再决定是否重试；不会自动重复应用。`);
    }finally{flight.current=false;if(mounted.current){setBusy(false);onBusy(false);}}
  }
  if(!runs.length&&!error)return null;
  return <section className="space-y-3" aria-label={en?"Plans in this conversation":"对话中的计划"}>
    {runs.length>0&&<details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-2">{en?"Recent plan previews & receipts":"最近的计划预览与回执"} · {runs.length}</summary><div className="flex flex-wrap gap-2 py-2">{runs.map(r=><Button key={r.id} size="sm" variant="outline" disabled={busy||locked} onClick={()=>setSelected(r.id)}>{r.proposal?.plan.plan_name??(en?"Plan":"计划")}</Button>)}</div></details>}
    {run?.proposal&&<div className="space-y-4 rounded-2xl border bg-background p-4 sm:p-5" data-testid="coach-plan">
      <p className="text-xs text-muted-foreground">{en?"AI generated · ":"AI 生成 · "}{run.kind==="training"?(en?"Training plan":"训练计划"):(en?"Nutrition plan":"饮食计划")}</p>
      <p>{run.baseline.length?(en?`Will replace: ${run.baseline.map(p=>p.name).join(", ")}`:`确认后替换：${run.baseline.map(p=>p.name).join("、")}`):(en?"Creates a new active plan after confirmation.":"确认后将成为新的当前计划。")}</p>
      {run.kind==="training"&&<p className="text-xs text-muted-foreground">{en?"Constraints":"本次约束"}：{run.context.weeklyDays} {en?"days/week":"天/周"} · {run.context.sessionMinutes} {en?"min/session":"分钟/次"} · {run.context.equipment.join("、")|| (en?"No equipment specified":"未指定器械")}{run.context.notes&&` · ${run.context.notes}`}</p>}
      <PlanPreview plan={run.proposal.plan} en={en}/>
      {!!changes.length&&<details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-2">{en?"Compare exercises & menu":"对比动作、目标与菜单"} · {changes.length}</summary><ul className="space-y-2">{changes.map((change,i)=><li key={i}>{change}</li>)}</ul><p className="mt-2">{en?"Review the full preview above for notes, rest times and alternatives.":"说明、休息时间和替代选项请核对上方完整预览。"}</p></details>}
      {run.status==="applied"&&run.receipt?<p role="status" data-testid="plan-receipt">{en?"Applied once. You can ask me to adjust it again.":"已应用，保存一次。还想调整，可以继续告诉我。"}</p>:
        <p role="status">{["awaiting_approval","approved"].includes(run.status)?(en?"Not applied. Review all days before confirming.":"尚未应用，请展开各天安排核对后确认。"):
          run.status==="stale"?(en?"Your plan or settings changed. Ask for a fresh preview.":"计划或个人设置已变化，请在对话里重新生成预览。"):
          en?"This preview is closed and cannot be applied.":"此预览已关闭，不能继续应用。"}</p>}
      <div className="flex flex-wrap gap-2">
        {["awaiting_approval","approved"].includes(run.status)&&<><Button disabled={busy||locked} onClick={()=>void act("apply")}>{en?"Confirm & apply":"确认并应用"}</Button><Button variant="outline" disabled={busy||locked} onClick={()=>void act("decline")}>{en?"Discard preview":"放弃此方案"}</Button></>}
        <Button variant="ghost" disabled={busy||locked} onClick={()=>void act("refresh")}>{en?"Refresh status":"刷新状态"}</Button>
      </div>
      {run.receipt&&<details className="text-xs text-muted-foreground"><summary className="cursor-pointer py-2">{en?"Receipt":"查看回执"}</summary><p className="break-all">{run.receipt.id} · {new Date(run.receipt.committedAt).toLocaleString()}</p></details>}
    </div>}
    {error&&<p role="alert" className="text-sm">{error}</p>}
  </section>;
}
