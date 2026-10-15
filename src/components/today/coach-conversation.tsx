"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUp, Ellipsis, MessageCircle, Plus, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TodayData } from "@/lib/today";
import { coachIntent } from "@/lib/coach-conversation";
import { localContextHash, workoutCanonical, workoutContextInput } from "@/lib/workout-context";
import { exerciseLabel } from "@/lib/exercise-catalog";
import type { WorkoutOperation } from "@/lib/workout-outbox";
import { ExerciseReplacement } from "./exercise-replacement";
import { useTrackerStore } from "@/store/use-tracker-store";
import { answerDataQuestion } from "@/lib/agent-data";
import { parsePersonalEntry, type PersonalRecord } from "@/lib/personal-records";
import { toDateString } from "@/lib/date";
import { usePersonalRecords } from "@/components/agent/personal-records-provider";
import { EntryPreview } from "@/components/agent/personal-entry";
import { fetchUserDataBundle } from "@/services/data-repository";
import { COACH_CONSENT_VERSION, conversationHistory, type CoachStatus, type CoachResponse, type CoachSource } from "@/lib/coach-model";
import { CoachSources } from "@/components/agent/coach-sources";
import { CoachPlans } from "@/components/agent/coach-plans";
import { COACH_STREAM_TYPE, consumeCoachStream } from "@/lib/coach-stream";
import { useCoachMemory,type CoachWorkoutProposal as Proposal } from "@/components/agent/coach-memory-provider";
import type { CoachTurn } from "@/lib/coach-history";
import { CoachHistoryControls } from "@/components/agent/coach-history-controls";

type Reply = CoachTurn["reply"];
type Props = {data: TodayData; busy: boolean; pendingCount: number; submit: (p: WorkoutOperation) => Promise<boolean>; workoutPanel?:ReactNode; receiptsPanel?:ReactNode; onPlanApplied?:()=>void;initialStatus?:CoachStatus};

export function CoachConversation({data, busy, pendingCount, submit,workoutPanel,receiptsPanel,onPlanApplied,initialStatus}: Props) {
  const t = useTranslations("coach"), ts = useTranslations("today.sentence"), tt = useTranslations("today"), locale = useLocale();
  const memory=useCoachMemory();
  const {history,snapshot,text,setText,selected,setSelected,turns,setTurns,proposal,setProposal,working,setWorking,flight,
    planRun,setPlanRun,planRunId,setPlanRunId,planWorking,setPlanWorking,streamStage,setStreamStage,modelRequest,
    personalProposal,setPersonalProposal,resolveText,setResolveText,replace,setReplace}=memory;
  const personal = usePersonalRecords(), en = locale === "en";
  const [modelStatus,setModelStatus]=useState<CoachStatus|null>(initialStatus??null),[modelEnabled,setModelEnabled]=useState(false);
  const [consentError,setConsentError]=useState(false);
  const [optionsOpen,setOptionsOpen]=useState(false),[panel,setPanel]=useState<"workout"|"receipts"|null>(null);
  const consentKey=personal.owner?`liftcut-coach-consent:${personal.owner}`:null;
  const transcript = useRef<HTMLDivElement>(null);
  const followStream=useRef(true);
  const session = data.session, active = session?.status === "active" ? session : null;
  const chosen = active?.prescription.exercises.some(e => e.id === selected) ? selected : "";
  const locked = busy || working || planWorking || !snapshot.ready || snapshot.loading;
  const stale = !!proposal && (!active || workoutCanonical(workoutContextInput(proposal.session)) !== workoutCanonical(workoutContextInput(active)));
  useEffect(() => {
    // Scroll only the transcript after a reply, never the whole page/composer.
    const element = transcript.current;
    if (element&&followStream.current) element.scrollTop = element.scrollHeight;
  }, [turns]);
  useEffect(() => {
    const prompt = new URLSearchParams(window.location.search).get("prompt");
    history.activate();
    const timer=window.setTimeout(()=>{if(prompt)setText(prompt.slice(0,400));},0); // URL text is only a draft.
    return()=>window.clearTimeout(timer);
  }, [history,setText]);
  useEffect(()=>{
    let alive=true;
    try{setModelEnabled(!!consentKey&&localStorage.getItem(consentKey)===COACH_CONSENT_VERSION);}catch{setModelEnabled(false);}
    if(!initialStatus)void fetch("/api/ai/coach",{cache:"no-store"}).then(r=>r.ok?r.json():null).then((status:CoachStatus|null)=>{
      if(!alive)return;setModelStatus(status);
    }).catch(()=>{});
    return()=>{alive=false;};
  },[consentKey,initialStatus]);
  function toggleModel(enabled:boolean){
    if(!consentKey)return;
    try{if(enabled)localStorage.setItem(consentKey,COACH_CONSENT_VERSION);else localStorage.removeItem(consentKey);
      setModelEnabled(enabled);setConsentError(false);if(!enabled){modelRequest.current?.abort();closeDraft();}
    }catch{setConsentError(true);}
  }
  const update = (id: string, reply: Reply) => setTurns(xs => xs.map(x => x.id === id ? {...x, reply,
    lines:reply==="queued"||reply==="personalQueued"?undefined:x.lines} : x));
  function closeDraft() {
    if (proposal) update(proposal.turnId, "closed");
    if (personalProposal) update(personalProposal.turnId,"closed");
    setPersonalProposal(null);
    setProposal(null); setResolveText(null); setReplace(null);
  }
  async function send(input = text, exerciseId = chosen) {
    if (flight.current || locked || !input.trim()) return;
    flight.current = true; setWorking(true); closeDraft(); setPanel(null); setText("");
    const id = crypto.randomUUID(), at = new Date().toISOString();
    followStream.current=true;
    setStreamStage("connecting");
    setTurns(xs=>[...xs,{id,text:input,reply:"data" as const,at,pending:true}]);
    let interrupted=false;
    let reply: Reply = "failed", lines: string[] | undefined, reason: string | undefined, model:string|undefined,sources:CoachSource[]|undefined;
    try {
      const anchorDate=toDateString(new Date());
      const entry=parsePersonalEntry(input,anchorDate);
      const localIntent=coachIntent(input,active,exerciseId||undefined);
      const localAction=["receipts","replace"].includes(localIntent.kind)||(localIntent.kind==="parse"&&localIntent.result.status==="draft");
      const answer=answerDataQuestion(input,useTrackerStore.getState(),personal.records,active,en,new Date(),personal.owner??undefined);
      if(/^(?:开始(?:今天的|本次)?训练|我要开始训练|开始练|start (?:a |my )?workout)[。.!?？]*$/i.test(input.trim())){
        reply="data";setPanel("workout");lines=[workoutPanel?(active?(en?"Your current workout is ready below.":"这是你的本次训练."):(en?"Choose a day and confirm to start.":"选择这次要练的安排，确认后开始.")):(en?"Sign in to start a workout.":"登录后就可以开始训练.")];
      }else if(localIntent.kind==="receipts"){
        reply="data";setPanel("receipts");lines=[en?"Here are your saved changes and receipts.":"这是已保存的修改和回执."];
      }else if (entry) {
        reply="personal";
        setPersonalProposal({turnId:id,command:{action:"create",id:crypto.randomUUID(),entry,source:"conversation",text:input,anchorDate}});
      } else if(modelEnabled&&modelStatus?.available&&personal.owner&&!localAction){
        reply="data";
        if(!navigator.onLine){lines=[en?"Model chat needs a connection. You can still use explicit entry phrases or manual entry offline.":"模型对话需要联网。离线时仍可使用明确的记录句式或手动补录。"];}else{
          const controller=new AbortController();modelRequest.current=controller;
          try{
            const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(55000)]);
            const response=await fetch("/api/ai/coach",{method:"POST",headers:{"Content-Type":"application/json","Accept":COACH_STREAM_TYPE,"X-Workout-Owner":personal.owner},
              body:JSON.stringify({id,text:input,history:conversationHistory(turns),locale:en?"en":"zh",timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
                consent:COACH_CONSENT_VERSION,...(exerciseId?{selectedExerciseId:exerciseId}:{}),...(planRunId?{planRunId}:{})}),signal});
            if(!response.ok){
              interrupted=true;
              lines=[response.status===429?(en?"You've reached the conversation limit. Please try again later; manual entry is still available.":"本轮对话次数已达上限，请稍后再试。手动补录仍可使用。"):
                response.status===401?(en?"Please sign in again to continue.":"登录已过期，请重新登录后继续。"):
                en?"Model chat is temporarily unavailable. No records or active plans were changed. Refresh to recover any plan preview.":"模型对话暂时不可用，记录和当前计划未修改。计划预览可刷新恢复，也可以重试或手动补录。"];
            }else{
              const result:CoachResponse=response.headers.get("Content-Type")?.includes(COACH_STREAM_TYPE)?await consumeCoachStream(response,id,event=>{
                if(controller.signal.aborted||modelRequest.current!==controller)return;
                if(event.type==="status")setStreamStage(event.stage);
                if(event.type==="text"){
                  if(event.text)setStreamStage("answering");
                  setTurns(xs=>xs.map(x=>x.id===id?{...x,lines:event.text?[event.text]:undefined,model:modelStatus.model??undefined}:x));
                }
              },signal):await response.json();
              signal.throwIfAborted();model=result.model;sources=result.sources;lines=[result.message];
              if(pendingCount||personal.pending.length)lines.unshift(en?"Some entries are still waiting to sync and may not appear in these results.":"部分记录尚待同步，可能还未计入这次查询。" );
              if(result.proposal?.kind==="personal"){reply="personal";setPersonalProposal({turnId:id,command:result.proposal.command});}
              if(result.proposal?.kind==="workout"){reply="draft";setProposal({turnId:id,...result.proposal});}
              if(result.proposal?.kind==="plan"){setPlanRun(result.proposal.run);}
            }
          }catch(error){interrupted=true;lines=[controller.signal.aborted?(en?"Stopped. The incomplete answer was discarded. Records and active plans were not changed. Refresh to recover a plan preview.":"已停止，未完成的回答已丢弃，记录和当前计划未修改。如已生成计划预览，可以刷新恢复。"):
            error instanceof Error&&error.message==="RATE_LIMITED"?(en?"Conversation limit reached. Please try again later.":"本轮对话次数已达上限，请稍后再试。"):
            en?"The response was interrupted or temporarily unavailable. The incomplete answer was discarded. Records and active plans were not changed. Refresh or retry.":"回复中断或模型暂时不可用，未完成的回答已丢弃，记录和当前计划未修改。可以刷新恢复预览或重试。"];
          }finally{modelRequest.current=null;}
        }
      } else if (answer) {
        reply="data";lines=answer.lines;
        if (personal.owner && !answer.guidance) {
          try {
            if (!navigator.onLine) throw new Error("offline");
            // A saved receipt can precede the background store refresh. Read for
            // this question; never pass a stale cache or an error fallback off as history.
            const owner = personal.owner;
            const [bundle, records] = await Promise.all([
              fetchUserDataBundle(owner,{strict:true}),
              (async():Promise<PersonalRecord[]> => {
                if (answer.topic !== "body" && answer.topic !== "food") return [];
                const response=await fetch("/api/personal-records",{headers:{"X-Workout-Owner":owner},cache:"no-store",signal:AbortSignal.timeout(15000)});
                if (!response.ok) throw new Error("history_unavailable");
                return response.json();
              })(),
            ]);
            lines=answerDataQuestion(input,bundle.snapshot,records,active,en,new Date(),owner)!.lines;
            if ((answer.topic === "workout" && pendingCount) || ((answer.topic === "body" || answer.topic === "food") && personal.pending.length))
              lines=[en?"Some entries are waiting to sync; they may not be included in this saved history.":"部分记录正在等待同步，可能尚未计入以下已保存历史。",...lines];
          } catch {
            lines=[en?"Your full history could not be read. Connect and try again; a failed read does not mean you have no records.":"暂时无法读取完整记录，请联网后重试。读取失败不代表没有记录。"];
          }
        }
      } else if (/体重|腰围|午餐|早餐|晚餐|饮食|蛋白质|weight|waist|breakfast|lunch|dinner|protein/i.test(input)) {
        reply="data";lines=[en?"Please include explicit numbers and units, e.g. ‘log weight 72.5 kg’ or ‘log lunch rice 600 kcal protein 25 g’. I won't estimate missing values.":"请写出明确的数值和单位，例如「记下体重 72.5 公斤」，或「记录午餐 鸡肉饭 600 千卡 蛋白质 25 克」。不知道的数值可以不写。"];
      } else {
      const intent = coachIntent(input, active, exerciseId || undefined);
      if (intent.kind !== "parse") {
        reply = intent.kind;
        if (intent.kind === "plan" && active) lines = active.prescription.exercises.map(e =>
          `${exerciseLabel(e.name, locale)} · ${tt("target", {sets: e.sets, reps: e.repRange, rpe: e.targetRpe})}`);
        if (intent.kind === "progress" && active) lines = [tt("progress", {
          done: active.sets.filter(s => s.status === "done").length,
          total: active.prescription.exercises.reduce((n, e) => n + e.sets, 0)}),
          ...active.sets.map(s => `${exerciseLabel(s.exerciseName, locale)} · ${tt("set", {number: s.setIndex})}: ${s.weightKg ?? "—"} kg × ${s.reps ?? "—"} · RPE ${s.rpe ?? "—"} · ${tt(s.status)}`)];
        if (intent.kind === "replace" && active) setReplace({session: active.id, exerciseId: intent.exerciseId});
      } else if (intent.result.status === "clarify") {
        reply = "clarify"; reason = intent.result.reason;
        if (reason === "exercise_not_unique") setResolveText(input);
      } else if (active) {
        reply = "draft";
        const draft = intent.result.draft, hash = await localContextHash(active);
        const operation: WorkoutOperation = draft.kind === "end"
          ? {action: "end", body: {id: active.id, revision: active.revision + 1, status: "ended"}}
          : {action: "apply", body: {id: crypto.randomUUID(), sessionId: active.id, text: input,
            ...(exerciseId ? {selectedExerciseId: exerciseId} : {}), version: 1, contextHash: hash,
            setIds: Array.from({length: draft.kind === "record" ? draft.sets.length : draft.kind === "skip" ? 1 : 0}, () => crypto.randomUUID()),
            authorization: "confirm_preview"}};
        setProposal({turnId: id, session: structuredClone(active), hash, draft, operation});
      }
      }
    } catch {reply = "failed";}
    finally {
      setTurns(xs => xs.map(x=>x.id===id?{id,text:input,reply,lines,reason,at,model,sources,interrupted}:x));
      setWorking(false); flight.current = false;
    }
  }
  async function confirm() {
    if (!proposal || stale || !active || flight.current || busy) return;
    flight.current = true; setWorking(true);
    try {
      if (await localContextHash(active) !== proposal.hash) {update(proposal.turnId, "closed"); return;}
      update(proposal.turnId, await submit(proposal.operation) ? "queued" : "failed");
    } catch {update(proposal.turnId, "failed");}
    finally {setProposal(null); setWorking(false); flight.current = false;}
  }
  function draftView(p: Proposal) {
    const d = p.draft;
    const name = d.kind === "end" ? "" : p.session.prescription.exercises.find(e => e.id === d.exerciseId)?.name ?? "";
    return <div className="mt-3 space-y-2 rounded-xl border bg-background p-3" data-testid="coach-draft">
      <strong>{(p.operation.body as {modelProof?:string}).modelProof?(en?"Review entry · AI interpreted":"确认记录 · AI 理解"):ts("rulesDraft")}{name && ` · ${exerciseLabel(name, locale)}`}</strong>
      {d.kind === "record" && d.sets.map(s => <p key={s.setIndex}>{ts("set", {n: s.setIndex})}: {s.reportedWeight ?? "—"} {s.inputUnit ?? "kg"} × {s.reps} · RPE {s.rpe ?? "—"}</p>)}
      {d.kind === "correct" && <p>{ts("correction", {n: d.setIndex, before: p.session.sets.find(s => s.id === d.recordId)?.reps ?? "—", after: d.changes.reps})}</p>}
      {d.kind === "skip" && <p>{ts("skip", {n: d.setIndex})}</p>}
      {d.kind === "end" && <p>{ts("endHint")}</p>}
      <p className="text-xs text-muted-foreground">{ts("unknown")}</p>
      {stale && <p role="status">{t("stale")}</p>}
      <div className="flex flex-wrap gap-2">
        <Button disabled={locked || stale} onClick={() => void confirm()}>{ts(d.kind === "end" ? "confirmEnd" : "confirm")}</Button>
        <Button variant="outline" disabled={locked} onClick={closeDraft}>{t("cancel")}</Button>
      </div>
    </div>;
  }
  return <section className="space-y-5" aria-label={t("conversation")} data-testid="coach-conversation">
    <div className="flex items-center justify-between pt-4"><h1 className="text-lg font-medium">Agent</h1><div className="flex items-center gap-1">
      <CoachHistoryControls en={en} locked={locked} beforeChange={()=>{closeDraft();setPlanRun(null);setPlanRunId(undefined);setPanel(null);}}/>
      <Button variant="ghost" size="icon" aria-label={en?"Conversation options":"对话选项"} aria-expanded={optionsOpen} onClick={()=>setOptionsOpen(!optionsOpen)}><Ellipsis className="size-5"/></Button></div></div>
    {!turns.length && <div className="py-8 text-center sm:py-16">
      <MessageCircle className="mx-auto mb-6 size-7" strokeWidth={1.4} />
      <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">{en?"What's on your mind?":"今天，想聊点什么."}</h2>
      <p className="mt-4 text-sm text-muted-foreground">{en?"Your records, workouts and meals. All here.":"查记录、记变化、安排训练和饮食."}</p>
    </div>}
    {snapshot.older&&<Button variant="ghost" size="sm" disabled={locked} onClick={()=>{followStream.current=false;void history.older();}}>{en?"Earlier messages":"查看更早的消息"}</Button>}
    <div ref={transcript} onScroll={e=>{const el=e.currentTarget;followStream.current=el.scrollHeight-el.scrollTop-el.clientHeight<64;}} className="max-h-[54dvh] space-y-8 overflow-y-auto overscroll-contain px-1 py-2" role="log" aria-label={t("messages")} aria-live="polite" aria-relevant="additions text">
      {turns.map(turn => <div key={turn.id} className="space-y-2" data-testid="coach-turn" aria-busy={!!turn.pending}>
        <div className="ml-auto w-fit max-w-[85%] rounded-3xl bg-muted px-5 py-3 text-sm"><p className="whitespace-pre-wrap break-words">{turn.text}</p></div>
        <div className="mr-3 py-4 text-sm leading-7">
          <p className="mb-3 text-xs font-medium">Agent <span className="ml-2 font-normal text-muted-foreground">{turn.model?`${en?"AI generated":"AI 生成"} · ${turn.model}`:new Date(turn.at).toLocaleTimeString(locale,{hour:"2-digit",minute:"2-digit"})}</span></p>
          {(turn.reply==="personal"&&personalProposal?.turnId!==turn.id)||(turn.reply==="draft"&&proposal?.turnId!==turn.id)?<p>{en?"This is an earlier draft. Resend your request for a fresh confirmation card; viewing history never applies it.":"这是历史草稿. 如需继续，请重新发送生成确认卡；查看历史不会自动应用."}</p>:turn.reply === "data" ? null : turn.reply === "personal" ? <p>{en?"Here's your entry. Confirm to save it.":"整理好了，确认一下就能记入你的数据。"}</p>
            : turn.reply === "personalQueued" ? <p>{en?"Queued. Check sync status and the receipt below.":"已加入补录队列，保存状态和回执会显示在下方。"}</p>
            : <p>{turn.reply === "clarify" ? ts(`clarify.${turn.reason}`) : t(`replies.${turn.reply}`)}</p>}
          {turn.lines?.map((line, i) => <p className="mt-1 whitespace-pre-wrap break-words" key={i}>{line}</p>)}
          {turn.pending&&<span className="inline-block size-1.5 animate-pulse rounded-full bg-foreground motion-reduce:animate-none" aria-hidden="true"/>}
          {!!turn.sources?.length&&<CoachSources sources={turn.sources} />}
          {(turn.reply === "plan" || turn.reply === "progress") && <p className="mt-2 text-xs text-muted-foreground">{t("snapshot")}</p>}
          {turn.reply === "longTerm" && <Link className="underline" href="/plan">{tt("plan")}</Link>}
          {proposal?.turnId === turn.id && draftView(proposal)}
          {personalProposal?.turnId === turn.id && <div className="mt-3 space-y-4 rounded-2xl border p-4" data-testid="personal-draft">
            <EntryPreview entry={personalProposal.command.entry} /><p className="text-xs text-muted-foreground">{en?"Unreported values stay blank. No nutritional estimates.":"未提供的数值保持空白，不估算营养数据。"}</p>
            <div className="flex gap-2"><Button disabled={locked || !personal.owner || !!personal.pending.length} onClick={async()=>{
              if(flight.current)return;flight.current=true;setWorking(true);
              try{if(await personal.submit(personalProposal.command)){update(turn.id,"personalQueued");setPersonalProposal(null);}}finally{flight.current=false;setWorking(false);}
            }}>{en?"Confirm entry":"确认补录"}</Button><Button variant="ghost" disabled={locked} onClick={closeDraft}>{t("cancel")}</Button></div>
            {!personal.owner && <Link href="/login" className="underline">{en?"Sign in to save":"登录后保存"}</Link>}
          </div>}
        </div>
      </div>)}
    </div>
    {panel&&<div className="space-y-3 rounded-2xl border p-4" data-testid={`conversation-${panel}`}><div className="flex justify-end"><Button variant="ghost" size="icon" aria-label={en?"Close":"收起"} onClick={()=>setPanel(null)}><X className="size-4"/></Button></div>{panel==="workout"?workoutPanel:receiptsPanel}</div>}
    {personal.owner&&<CoachPlans key={personal.owner} owner={personal.owner} fresh={planRun} en={en} locked={locked} showHistory={panel==="receipts"} onApplied={onPlanApplied} onSelect={setPlanRunId} onBusy={setPlanWorking} onUpdate={setPlanRun}/>}
    {working && <div className="flex items-center gap-3 py-3 text-sm text-muted-foreground"><p role="status">{modelRequest.current?({connecting:en?"Connecting…":"正在连接…",reading:en?"Checking your records…":"正在核对记录…",drafting:en?"Preparing your preview…":"正在准备方案预览…",answering:en?"Writing…":"正在回复…"})[streamStage]:t("working")}</p>
      {modelRequest.current&&<Button variant="ghost" size="sm" onClick={()=>modelRequest.current?.abort()}><Square className="size-3" />{en?"Stop":"停止"}</Button>}</div>}
    {resolveText && active && <div className="space-y-2 rounded-xl border bg-card p-3" data-testid="coach-clarify">
      <p className="text-sm">{t("chooseToContinue")}</p><div className="flex flex-wrap gap-2">{active.prescription.exercises.map(e =>
        <Button key={e.id} variant="outline" disabled={locked} onClick={() => {setSelected(e.id); void send(resolveText, e.id);}}>{exerciseLabel(e.name, locale)}</Button>)}</div>
    </div>}
    {replace && active?.id === replace.session && <div className="space-y-3 rounded-xl border bg-card p-3" data-testid="coach-replacement">
      <p className="text-sm">{t("chooseReplace")}</p><div className="flex flex-wrap gap-2">{active.prescription.exercises.map(e =>
        <Button key={e.id} variant={replace.exerciseId === e.id ? "default" : "outline"} disabled={locked} onClick={() => setReplace({...replace, exerciseId: e.id})}>{exerciseLabel(e.name, locale)}</Button>)}</div>
      {active.prescription.exercises.filter(e => e.id === replace.exerciseId).map(e => <ExerciseReplacement key={e.id} session={active} exercise={e} busy={locked} submit={submit} initiallyOpen />)}
    </div>}
    <form className="space-y-3 rounded-[24px] border bg-muted/40 p-4" onSubmit={e => {e.preventDefault(); void send();}}>
      {active && <label className="flex items-center gap-2 text-xs text-muted-foreground" htmlFor="coach-exercise">{t("exercise")}
        <select id="coach-exercise" className="min-w-0 max-w-[55%] rounded-lg bg-background p-2 text-xs" value={chosen} disabled={locked} onChange={e => {closeDraft();setSelected(e.target.value);}}>
          <option value="">{ts("fromText")}</option>{active.prescription.exercises.map(e => <option key={e.id} value={e.id}>{exerciseLabel(e.name, locale)}</option>)}
        </select></label>}
      <label className="sr-only" htmlFor="coach-input">{t("input")}</label>
      <textarea id="coach-input" className="min-h-20 w-full resize-y bg-transparent px-1 py-2 text-base leading-7 outline-none placeholder:text-muted-foreground focus-visible:outline-none" value={text} maxLength={400} disabled={locked}
        onChange={e => setText(e.target.value)} placeholder={en?"Ask about data, record an entry, or adjust a plan":"查数据、补记录，或告诉我想怎么调整计划"} onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {e.preventDefault(); void send();}
        }} />
      <div className="flex items-center justify-between gap-3"><Link href="/" className="flex min-h-10 items-center gap-1.5 px-2 text-xs text-muted-foreground"><Plus className="size-4" />{en?"Manual entry":"手动补录"}</Link>
        <Button type="submit" className="size-10 rounded-full" aria-label={t(working ? "working" : "send")} disabled={locked || !text.trim()}><ArrowUp className="size-5" /></Button></div>
    </form>
    <p className="text-center text-[11px] leading-5 text-muted-foreground">{pendingCount ? tt("outbox.pending",{count:pendingCount}) : modelEnabled&&modelStatus?.available?
      en?"AI can make mistakes. Check sources and confirm changes.":"AI 可能出错，请核对来源并确认修改.":
      en?"Data mode · uses saved records and explicit numbers.":"数据模式 · 按已存记录和明确数值处理."}
      {personal.owner&&turns.length>0&&<span className="ml-2" data-testid="coach-sync-status">{snapshot.sync==="saved"?(en?"Chat synced":"对话已同步"):snapshot.sync==="saving"?(en?"Saving chat…":"对话同步中…"):snapshot.sync==="offline"||snapshot.sync==="error"?(en?"Chat not synced":"对话尚未同步"):""}</span>}
      <button className="ml-2 underline underline-offset-4" onClick={()=>setOptionsOpen(!optionsOpen)}>{en?"Memory scope":"记忆范围"}</button></p>
    {snapshot.error&&<p role="status" className="text-center text-xs text-muted-foreground">{en?"Chat sync needs attention. Your records have not been changed.":"对话同步暂未完成. 已有业务记录不受影响."}<Button variant="ghost" size="sm" onClick={()=>void history.flush()}>{en?"Retry":"重试同步"}</Button></p>}
    {optionsOpen&&<div className="space-y-2 rounded-2xl border p-4 text-xs leading-6 text-muted-foreground" data-testid="coach-memory-scope">
      <p>{en?"Chat history is saved to your account. Switching tabs keeps the current answer running; refreshing restores saved messages. Earlier chats from before this feature cannot be recovered.":"聊天记录会保存到你的账号. 切换页面时当前回复会继续，刷新可恢复已保存的消息. 本功能上线前未保存的旧对话无法找回."}</p>
      <p>{en?"AI uses the six latest complete turns in this conversation. Other conversations, stopped replies and partial answers are excluded. Your saved measurements, meals and plans are read fresh when needed; chat history is not permanent AI memory.":"AI 使用当前对话最近六轮完整内容，不自动引用其他对话、已停止或未完成的回复. 已确认的身体、饮食和训练数据会按需重新查询；保存聊天不等于 AI 永久记住所有内容."}</p>
      <p>{en?"Opening history never confirms a change. Use New conversation to start without the old chat context.":"查看历史不会确认任何修改. 点击新对话，就会从新的聊天上下文开始."}</p>
    </div>}
    {modelStatus?.available&&personal.owner&&(!modelEnabled||optionsOpen)&&<section className="text-xs text-muted-foreground" data-testid="coach-consent">
      <p className="py-2">{modelEnabled?(en?"AI conversation settings":"AI 对话设置"):(en?"Enable natural conversation":"开启自然对话")}</p>
      <div className="mt-2 space-y-3 rounded-2xl border p-4 leading-6">
        <p>{en?`To understand your requests, LiftCut sends your messages, the six latest complete turns in this conversation and relevant saved records to ${modelStatus.provider==="deepseek"?"DeepSeek":modelStatus.provider} (${modelStatus.model}). This can include body measurements, meals, training data and settings needed for plans. Chat history is saved to your account and can be viewed or deleted from History. Entries are saved only after confirmation, with the original request and quoted values. Deleting chat does not delete confirmed records, plans or approval receipts.`:
          `开启后，LiftCut 会将你的消息、当前对话最近六轮完整内容及本次需要的记录发送给 ${modelStatus.provider==="deepseek"?"DeepSeek":modelStatus.provider}（${modelStatus.model}），其中可能包含身体、饮食和训练数据，以及生成计划所需的个人设置。聊天记录保存在你的账号中，可从历史对话查看或删除。补录仍需你确认后才会保存，并保留该次原话和采用的数值片段。删除聊天不会删除已确认的记录、计划和回执。`}</p>
        <div className="flex flex-wrap gap-2"><Button size="sm" variant={modelEnabled?"outline":"default"} disabled={locked} onClick={()=>{toggleModel(!modelEnabled);setOptionsOpen(false);}}>{modelEnabled?(en?"Turn off natural conversation":"关闭自然对话"):(en?"Agree & enable":"同意并开启")}</Button></div>
        {consentError&&<p role="status">{en?"Your choice could not be saved in this browser.":"无法在此浏览器保存你的选择，请检查存储权限。"}</p>}
      </div>
    </section>}
  </section>;
}
