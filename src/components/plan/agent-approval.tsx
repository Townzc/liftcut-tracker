"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useTrackerStore } from "@/store/use-tracker-store";
import { ownerLifecycle } from "@/lib/owner-lifecycle";
import { contextSchema, planSchema, isNutritionPlan, type Binding, type Context, type Execution, type RunView } from "@liftcut/core/agent-contracts";

const labels: Record<RunView["status"], string> = {
  planning: "请生成新的预览", awaiting_approval: "等待你批准当前预览", approved: "已批准，尚未写入",
  revoked: "批准已撤销，不能执行此预览", declined: "你已拒绝本次提案", applied: "计划已保存",
  stale: "资料已改变，请更新约束并重新预览", budget_exhausted: "本次运行已达到执行尝试上限",
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/agent/runs${path}`, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.error || "OUTCOME_UNKNOWN");
  return result.value as T;
}
function binding(run: RunView): Binding {
  const p = run.proposal!;
  return { proposalId: p.proposalId, contentHash: p.contentHash, contextRevision: p.contextRevision };
}

export function AgentApproval() {
  const { user, authMode } = useAuth();
  if (authMode !== "authenticated" || !user) return <Card><CardContent className="p-6">请<Link href="/login" className="underline">登录</Link>后查看和批准计划。访客预览不会写入账户。</CardContent></Card>;
  return <AgentApprovalPanel key={user.id} userId={user.id} />;
}
function AgentApprovalPanel({ userId }: { userId: string }) {
  const router = useRouter();
  const refreshUserData = useTrackerStore(state => state.refreshUserData);
  const [run, setRun] = useState<RunView | null>(null);
  const [resumeId, setResumeId] = useState("");
  const [json, setJson] = useState("");
  const [context, setContext] = useState<Context>({ weeklyDays: 3, sessionMinutes: 60, equipment: [], notes: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const startRequest = useRef<{ requestKey: string; context: Context } | null>(null);
  const execution = useRef<Execution | null>(null);
  const key = `liftcut-p1-${userId}`;
  useEffect(() => {
    // A pending create request retains its key/body so a lost response cannot create a second run.
    // Once acknowledged, only the opaque run ID remains. Reads always check ownership.
    const id = userId ? localStorage.getItem(`liftcut-p1-${userId}`) : null;
    setRun(null); setResumeId(id ?? ""); execution.current = null;
    const pending = userId ? localStorage.getItem(`liftcut-p1-${userId}-pending`) : null;
    try { startRequest.current = pending ? JSON.parse(pending) : null; } catch { startRequest.current = null; }
    const draftKey=`liftcut-p1-draft:${userId}`,draft = sessionStorage.getItem(draftKey);
    if (draft) { setJson(draft); sessionStorage.removeItem(draftKey); }
  }, [userId]);
  async function act(work: () => Promise<void>) {
    if(!ownerLifecycle.active(userId))return;
    setBusy(true); setMessage("");
    try { await ownerLifecycle.run(userId,work); } catch (error) {
      const code = error instanceof Error ? error.message : "OUTCOME_UNKNOWN";
      setMessage(`操作未确认（${code}）。请查询当前运行状态；不要重新创建运行。`);
    } finally { setBusy(false); }
  }
  function received(value: RunView) {
    if(!ownerLifecycle.active(userId))return;
    setRun(value); setContext(value.context); setResumeId(value.id);
    localStorage.setItem(key, value.id); localStorage.removeItem(`${key}-pending`);
  }
  async function refresh() { received(await api<RunView>(`/${resumeId || run?.id}`)); }
  async function decide(action: "approve" | "revoke" | "decline") {
    if (!run) return;
    received(await api<RunView>(`/${run.id}/user-events`, { action, expectedRevision: run.revision, binding: binding(run) }));
    execution.current = null;
  }
  return <div className="space-y-5">
    <Card><CardHeader><CardTitle>计划预览与批准</CardTitle></CardHeader><CardContent className="space-y-4">
      <p>导入你检查过的训练计划。只有明确批准当前版本并执行后，才会保存为正在使用的计划。</p>
      <div className="flex gap-2"><Input aria-label="运行编号" placeholder="运行编号，可恢复之前的操作" value={resumeId} onChange={e => setResumeId(e.target.value)} />
        <Button disabled={busy || !resumeId} onClick={() => act(refresh)}>查询 / 恢复</Button></div>
      <div className="grid gap-3 sm:grid-cols-2"><Label className="flex-col items-start">每周最多训练天数<Input type="number" min={1} max={7} value={context.weeklyDays} onChange={e => setContext({ ...context, weeklyDays: Number(e.target.value) })} /></Label>
        <Label className="flex-col items-start">每次最多分钟<Input type="number" min={15} max={180} value={context.sessionMinutes} onChange={e => setContext({ ...context, sessionMinutes: Number(e.target.value) })} /></Label></div>
      <Label className="flex-col items-start">器械（逗号分隔）<Input value={context.equipment.join(",")} onChange={e => setContext({ ...context, equipment: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} /></Label>
      <Label className="flex-col items-start">补充约束<Textarea value={context.notes} onChange={e => setContext({ ...context, notes: e.target.value })} /></Label>
      {!run ? <Button disabled={busy || Boolean(resumeId)} onClick={() => act(async () => {
        startRequest.current ??= { requestKey: crypto.randomUUID(), context: contextSchema.parse(context) };
        localStorage.setItem(`${key}-pending`, JSON.stringify(startRequest.current));
        received(await api<RunView>("", startRequest.current));
      })}>创建预览流程</Button> : <Button disabled={busy || ["applied", "declined", "budget_exhausted"].includes(run.status)} onClick={() => act(async () => {
        received(await api<RunView>(`/${run.id}/user-events`, { action: "context", expectedRevision: run.revision, context: contextSchema.parse(context) }));
        execution.current = null;
      })}>更新约束（使旧批准失效）</Button>}
      <Label className="flex-col items-start">训练计划 JSON<Textarea rows={8} value={json} onChange={e => setJson(e.target.value)} /></Label>
      <p className="text-sm text-muted-foreground">当前自动检查天数、时长和结构。器械及身体状况是否适合，仍需你逐项检查。</p>
      <Button disabled={busy || !run || ["applied", "declined", "stale", "budget_exhausted"].includes(run.status)} onClick={() => act(async () => {
        received(await api<RunView>(`/${run!.id}/proposals`, { expectedRevision: run!.revision, plan: planSchema.parse(JSON.parse(json)) }));
        execution.current = null;
      })}>生成不可变预览</Button>
    </CardContent></Card>
    {message && <p role="alert">{message}</p>}
    {run && <Card><CardHeader><CardTitle>{labels[run.status]}</CardTitle></CardHeader><CardContent className="space-y-4">
      <p>运行 {run.id} · 约束版本 {run.contextRevision} · 执行尝试 {run.attempts}</p>
      <p>本次已保存约束：每周 {run.context.weeklyDays} 天，每次 {run.context.sessionMinutes} 分钟；器械 {run.context.equipment.join("、") || "未填写"}；{run.context.notes || "无补充"}</p>
      {run.proposal && !isNutritionPlan(run.proposal.plan) && <><h3 className="font-semibold">预览版本 {run.proposal.version}：{run.proposal.plan.plan_name}</h3>
        {run.proposal.contextRevision !== run.contextRevision && <p>此预览对应旧约束，已失效。请重新生成。</p>}
        <p>{run.proposal.plan.summary}</p>
        {run.proposal.plan.reasoning_summary && <p>{run.proposal.plan.reasoning_summary}</p>}
        {run.proposal.plan.warnings.map((warning, i) => <p key={i} className="text-sm">提示：{warning}</p>)}
        {run.proposal.plan.weeks.map(week => <section key={week.week_number} className="space-y-3 rounded border p-3">
          <h4 className="font-semibold">第 {week.week_number} 周 · {week.focus}</h4>
          {week.days.map(day => <div key={day.day_number} className="space-y-2">
            <p className="font-medium">第 {day.day_number} 天 · {day.title} · {day.estimated_duration_minutes} 分钟</p>
            {day.notes && <p className="text-sm">{day.notes}</p>}
            <ul className="list-disc space-y-1 pl-5 text-sm">{day.exercises.map((ex, i) => <li key={i}>
              {ex.name}：{ex.sets} 组 × {ex.rep_range}，RPE {ex.target_rpe}，休息 {ex.rest_seconds} 秒
              {ex.notes && <span>；{ex.notes}</span>}{ex.alternative_exercises.length > 0 && <span>；替代：{ex.alternative_exercises.join("、")}</span>}
            </li>)}</ul>
          </div>)}
        </section>)}
        <details><summary>查看完整计划数据</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded border p-3 text-sm">{JSON.stringify(run.proposal.plan, null, 2)}</pre></details>
        <p className="break-all text-xs text-muted-foreground">内容指纹：{run.proposal.contentHash}</p>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || run.status !== "awaiting_approval"} onClick={() => act(() => decide("approve"))}>批准此版本</Button>
          <Button disabled={busy || !["awaiting_approval", "approved"].includes(run.status)} variant="outline" onClick={() => act(() => decide("revoke"))}>撤销批准</Button>
          <Button disabled={busy || !["awaiting_approval", "approved", "revoked"].includes(run.status)} variant="outline" onClick={() => act(() => decide("decline"))}>拒绝本次提案</Button>
          <Button disabled={busy || run.status !== "approved"} onClick={() => act(async () => {
            execution.current ??= { binding: binding(run), approvalId: run.approvalId!, idempotencyKey: crypto.randomUUID() };
            await api(`/${run.id}/execute`, execution.current);
            received(await api<RunView>(`/${run.id}`));
          })}>执行 / 重试同一操作</Button>
        </div></>}
      {run.receipt && <div><p role="status">已保存一次。计划编号 {run.receipt.planId} · 回执 {run.receipt.id}。</p>
        <Button variant="outline" disabled={busy} onClick={() => act(async () => {
          // The old training page reads a client cache: refresh it after the independent API write.
          await refreshUserData();
          const state = useTrackerStore.getState();
          if (state.userId !== userId || state.error) throw new Error("PLAN_VIEW_REFRESH_FAILED");
          router.push("/plan");
        })}>查看计划</Button></div>}
      {["applied", "declined", "budget_exhausted"].includes(run.status) && <Button variant="outline" disabled={busy} onClick={() => {
        setRun(null); setResumeId(""); startRequest.current = null; execution.current = null;
        localStorage.removeItem(key); localStorage.removeItem(`${key}-pending`);
      }}>另建一次计划流程</Button>}
      <p className="text-sm text-muted-foreground">撤销阻止尚未提交的操作。已经保存的计划不会因撤销而自动删除。遇到网络问题，先查询本次运行，再重试。</p>
      <details><summary>查看操作与来源记录</summary><pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify(run.events, null, 2)}</pre></details>
    </CardContent></Card>}
  </div>;
}
