"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowUp, MessageCircle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Session, TodayData } from "@/lib/today";
import type { LogDraft } from "@/lib/workout-log-parser";
import { coachIntent } from "@/lib/coach-conversation";
import { localContextHash, workoutCanonical, workoutContextInput } from "@/lib/workout-context";
import { exerciseLabel } from "@/lib/exercise-catalog";
import type { WorkoutOperation } from "@/lib/workout-outbox";
import { ExerciseReplacement } from "./exercise-replacement";
import { useTrackerStore } from "@/store/use-tracker-store";
import { answerDataQuestion } from "@/lib/agent-data";
import { parsePersonalEntry, type PersonalCommand } from "@/lib/personal-records";
import { toDateString } from "@/lib/date";
import { usePersonalRecords } from "@/components/agent/personal-records-provider";
import { EntryPreview } from "@/components/agent/personal-entry";

type Reply = "help" | "noSession" | "invalid" | "plan" | "progress" | "receipts" | "longTerm" | "replace" | "clarify" | "draft" | "closed" | "queued" | "failed" | "data" | "personal" | "personalQueued";
type Turn = {id: string; text: string; reply: Reply; lines?: string[]; reason?: string; at: string};
type Proposal = {turnId: string; session: Session; hash: string; draft: LogDraft; operation: WorkoutOperation};
type Props = {data: TodayData; busy: boolean; pendingCount: number; submit: (p: WorkoutOperation) => Promise<boolean>};

export function CoachConversation({data, busy, pendingCount, submit}: Props) {
  const t = useTranslations("coach"), ts = useTranslations("today.sentence"), tt = useTranslations("today"), locale = useLocale();
  const [text, setText] = useState(""), [selected, setSelected] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]), [proposal, setProposal] = useState<Proposal | null>(null);
  const [working, setWorking] = useState(false), flight = useRef(false);
  const personal = usePersonalRecords(), en = locale === "en";
  const [personalProposal,setPersonalProposal] = useState<{turnId:string;command:Extract<PersonalCommand,{action:"create"}>}|null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const [resolveText, setResolveText] = useState<string | null>(null), [replace, setReplace] = useState<{session: string; exerciseId?: string} | null>(null);
  const session = data.session, active = session?.status === "active" ? session : null;
  const chosen = active?.prescription.exercises.some(e => e.id === selected) ? selected : "";
  const locked = busy || working;
  const stale = !!proposal && (!active || workoutCanonical(workoutContextInput(proposal.session)) !== workoutCanonical(workoutContextInput(active)));
  const exampleExercise = active?.prescription.exercises.find(e => e.id === chosen)?.name ?? active?.prescription.exercises[0]?.name ?? (locale === "en" ? "Squat" : "深蹲");
  useEffect(() => {
    // Scroll only the transcript after a reply, never the whole page/composer.
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [turns]);
  useEffect(() => {
    const prompt = new URLSearchParams(window.location.search).get("prompt");
    if (prompt) setText(prompt.slice(0,400)); // URL text is only a draft, never an instruction to write.
  }, []);
  const update = (id: string, reply: Reply) => setTurns(xs => xs.map(x => x.id === id ? {...x, reply} : x));
  function closeDraft() {
    if (proposal) update(proposal.turnId, "closed");
    if (personalProposal) update(personalProposal.turnId,"closed");
    setPersonalProposal(null);
    setProposal(null); setResolveText(null); setReplace(null);
  }
  async function send(input = text, exerciseId = chosen) {
    if (flight.current || busy || !input.trim()) return;
    flight.current = true; setWorking(true); closeDraft(); setText("");
    const id = crypto.randomUUID(), at = new Date().toISOString();
    let reply: Reply = "failed", lines: string[] | undefined, reason: string | undefined;
    try {
      const anchorDate=toDateString(new Date());
      const entry=parsePersonalEntry(input,anchorDate);
      const answer=answerDataQuestion(input,useTrackerStore.getState(),personal.records,active,en,new Date(),personal.owner??undefined);
      if (entry) {
        reply="personal";
        setPersonalProposal({turnId:id,command:{action:"create",id:crypto.randomUUID(),entry,source:"conversation",text:input,anchorDate}});
      } else if (answer) {
        reply="data";lines=answer.lines;
        if ((answer.topic === "body" || answer.topic === "food") && personal.owner) {
          if (!personal.records.length && (personal.loading || personal.error || !navigator.onLine))
            lines=[en?"Your full history is not available yet. Connect and retry after syncing; an unavailable history does not mean you have no records.":"暂时无法读取完整记录，请联网并同步后再问一次。读取失败不代表没有记录。"];
          else if (personal.loading || personal.error || personal.pending.length || !navigator.onLine)
            lines=[en?"Some entries are loading or waiting to sync; the saved history below may be incomplete.":"部分补录正在加载或等待同步，以下已保存历史可能不完整。",...lines];
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
      setTurns(xs => [...xs, {id, text: input, reply, lines, reason, at}].slice(-40));
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
      <strong>{ts("rulesDraft")}{name && ` · ${exerciseLabel(name, locale)}`}</strong>
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
    {!turns.length && <div className="py-12 text-center sm:py-16">
      <MessageCircle className="mx-auto mb-6 size-7" strokeWidth={1.4} />
      <h2 className="text-2xl font-medium tracking-tight sm:text-3xl">{en?"What would you like to know?":"今天，有什么想告诉我？"}</h2>
      <p className="mt-4 text-sm text-muted-foreground">{en?"Ask about your progress, or tell me what to record.":"查查自己的进展，或者记下今天的一点变化。"}</p>
      <div className="mx-auto mt-7 flex max-w-lg flex-wrap justify-center gap-2">{(en?["My recent weight","What did I eat today?","Training this week"]:["最近体重","今天吃了什么","本周训练"]).map(prompt=>
        <Button key={prompt} variant="outline" className="h-10 rounded-full px-4 font-normal" disabled={locked} onClick={()=>void send(prompt)}>{prompt}</Button>)}</div>
    </div>}
    <div ref={transcript} className="max-h-[54dvh] space-y-8 overflow-y-auto overscroll-contain px-1 py-2" role="log" aria-label={t("messages")} aria-live="polite" aria-relevant="additions text">
      {turns.map(turn => <div key={turn.id} className="space-y-2" data-testid="coach-turn">
        <div className="ml-auto w-fit max-w-[85%] rounded-3xl bg-muted px-5 py-3 text-sm"><p className="whitespace-pre-wrap break-words">{turn.text}</p></div>
        <div className="mr-3 py-4 text-sm leading-7">
          <p className="mb-3 text-xs font-medium">Agent <span className="ml-2 font-normal text-muted-foreground">{new Date(turn.at).toLocaleTimeString(locale,{hour:"2-digit",minute:"2-digit"})}</span></p>
          {turn.reply === "data" ? null : turn.reply === "personal" ? <p>{en?"Here's your entry. Confirm to save it.":"整理好了，确认一下就能记入你的数据。"}</p>
            : turn.reply === "personalQueued" ? <p>{en?"Queued. Check sync status and the receipt below.":"已加入补录队列，保存状态和回执会显示在下方。"}</p>
            : <p>{turn.reply === "clarify" ? ts(`clarify.${turn.reason}`) : t(`replies.${turn.reply}`)}</p>}
          {turn.lines?.map((line, i) => <p className="mt-1 break-words" key={i}>{line}</p>)}
          {(turn.reply === "plan" || turn.reply === "progress") && <p className="mt-2 text-xs text-muted-foreground">{t("snapshot")}</p>}
          {turn.reply === "longTerm" && <Link className="underline" href="/plan">{tt("plan")}</Link>}
          {turn.reply === "receipts" && <a className="underline" href="#coach-receipts">{t("goReceipts")}</a>}
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
        onChange={e => setText(e.target.value)} placeholder={en?"Ask about your data, or try ‘log weight 72.5 kg’":"问问自己的数据，或说「记下体重 72.5 公斤」"} onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {e.preventDefault(); void send();}
        }} />
      <div className="flex items-center justify-between gap-3"><Link href="/" className="flex min-h-10 items-center gap-1.5 px-2 text-xs text-muted-foreground"><Plus className="size-4" />{en?"Manual entry":"手动补录"}</Link>
        <Button type="submit" className="size-10 rounded-full" aria-label={t(working ? "working" : "send")} disabled={locked || !text.trim()}><ArrowUp className="size-5" /></Button></div>
    </form>
    <p className="text-center text-[11px] leading-5 text-muted-foreground">{pendingCount ? tt("outbox.pending",{count:pendingCount}) : en?"Data mode · uses saved records and explicit numbers. Chat is temporary.":"数据模式 · 按已存记录和明确数值处理，聊天文字暂存本页。"}</p>
    <details className="text-sm text-muted-foreground"><summary className="min-h-11 py-3">{en?"Training tools & examples":"训练工具与使用示例"}</summary>
      <p className="my-3 text-xs leading-6">{t("welcome",{exercise:exampleExercise})}</p>
      <div className="flex flex-wrap gap-2">{["plan","progress","replace","receipts"].map(key=><Button key={key} variant="outline" disabled={locked} onClick={()=>void send(t(`prompts.${key}`))}>{t(`prompts.${key}`)}</Button>)}</div>
      <div className="mt-3 flex flex-wrap gap-4"><Link className="py-2 underline" href="/plan">{en?"Manage plan":"管理训练计划"}</Link><Link className="py-2 underline" href="/plan/ai">{en?"Plan proposals":"生成计划提案"}</Link><Link className="py-2 underline" href="/workout">{en?"Training history":"训练历史明细"}</Link></div>
    </details>
  </section>;
}
