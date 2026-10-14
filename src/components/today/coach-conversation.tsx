"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { MessageCircle, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Session, TodayData } from "@/lib/today";
import type { LogDraft } from "@/lib/workout-log-parser";
import { coachIntent } from "@/lib/coach-conversation";
import { localContextHash, workoutCanonical, workoutContextInput } from "@/lib/workout-context";
import { exerciseLabel } from "@/lib/exercise-catalog";
import type { WorkoutOperation } from "@/lib/workout-outbox";
import { ExerciseReplacement } from "./exercise-replacement";

type Reply = "help" | "noSession" | "invalid" | "plan" | "progress" | "receipts" | "longTerm" | "replace" | "clarify" | "draft" | "closed" | "queued" | "failed";
type Turn = {id: string; text: string; reply: Reply; lines?: string[]; reason?: string; at: string};
type Proposal = {turnId: string; session: Session; hash: string; draft: LogDraft; operation: WorkoutOperation};
type Props = {data: TodayData; busy: boolean; pendingCount: number; submit: (p: WorkoutOperation) => Promise<boolean>};

export function CoachConversation({data, busy, pendingCount, submit}: Props) {
  const t = useTranslations("coach"), ts = useTranslations("today.sentence"), tt = useTranslations("today"), locale = useLocale();
  const [text, setText] = useState(""), [selected, setSelected] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]), [proposal, setProposal] = useState<Proposal | null>(null);
  const [working, setWorking] = useState(false), flight = useRef(false);
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
  const update = (id: string, reply: Reply) => setTurns(xs => xs.map(x => x.id === id ? {...x, reply} : x));
  function closeDraft() {
    if (proposal) update(proposal.turnId, "closed");
    setProposal(null); setResolveText(null); setReplace(null);
  }
  async function send(input = text, exerciseId = chosen) {
    if (flight.current || busy || !input.trim()) return;
    flight.current = true; setWorking(true); closeDraft(); setText("");
    const id = crypto.randomUUID(), at = new Date().toISOString();
    let reply: Reply = "failed", lines: string[] | undefined, reason: string | undefined;
    try {
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
  return <section className="space-y-4" aria-label={t("conversation")} data-testid="coach-conversation">
    <div className="rounded-2xl border bg-card p-4">
      <div className="flex items-center gap-2 font-semibold"><MessageCircle className="size-5 text-brand-dark" /><h2>{t("welcomeTitle")}</h2></div>
      <p className="mt-2 text-sm leading-6">{t("welcome", {exercise: exampleExercise})}</p>
      <p className="mt-2 text-xs text-muted-foreground">{t("mode")} · {t("temporary")}</p>
      <div className="mt-3 flex flex-wrap gap-2">{["plan", "progress", "replace", "receipts"].map(key =>
        <Button key={key} variant="outline" size="sm" disabled={locked} onClick={() => void send(t(`prompts.${key}`))}>{t(`prompts.${key}`)}</Button>)}</div>
    </div>
    <div ref={transcript} className="max-h-[52dvh] space-y-5 overflow-y-auto overscroll-contain rounded-xl px-1 py-2" role="log" aria-label={t("messages")} aria-live="polite" aria-relevant="additions text">
      {turns.map(turn => <div key={turn.id} className="space-y-2" data-testid="coach-turn">
        <div className="ml-8 rounded-2xl rounded-br-sm bg-brand-dark p-3 text-sm text-white"><p className="mb-1 text-xs opacity-75">{t("you")}</p><p className="whitespace-pre-wrap break-words">{turn.text}</p></div>
        <div className="mr-3 rounded-2xl rounded-bl-sm border bg-card p-3 text-sm leading-6">
          <p className="mb-1 text-xs text-muted-foreground">{t("assistant")} · {new Date(turn.at).toLocaleTimeString(locale)}</p>
          <p>{turn.reply === "clarify" ? ts(`clarify.${turn.reason}`) : t(`replies.${turn.reply}`)}</p>
          {turn.lines?.map((line, i) => <p className="mt-1 break-words" key={i}>{line}</p>)}
          {(turn.reply === "plan" || turn.reply === "progress") && <p className="mt-2 text-xs text-muted-foreground">{t("snapshot")}</p>}
          {turn.reply === "longTerm" && <Link className="underline" href="/plan">{tt("plan")}</Link>}
          {turn.reply === "receipts" && <a className="underline" href="#coach-receipts">{t("goReceipts")}</a>}
          {proposal?.turnId === turn.id && draftView(proposal)}
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
    <form className="space-y-2 rounded-2xl border bg-card p-3 shadow-sm" onSubmit={e => {e.preventDefault(); void send();}}>
      {active && <label className="block text-xs text-muted-foreground" htmlFor="coach-exercise">{t("exercise")}
        <select id="coach-exercise" className="mt-1 block w-full rounded border bg-background p-2 text-sm" value={chosen} disabled={locked} onChange={e => {closeDraft();setSelected(e.target.value);}}>
          <option value="">{ts("fromText")}</option>{active.prescription.exercises.map(e => <option key={e.id} value={e.id}>{exerciseLabel(e.name, locale)}</option>)}
        </select></label>}
      <label className="sr-only" htmlFor="coach-input">{t("input")}</label>
      <textarea id="coach-input" className="min-h-24 w-full resize-y rounded-xl border bg-background p-3 text-base" value={text} maxLength={400} disabled={locked}
        onChange={e => setText(e.target.value)} placeholder={t("example", {exercise: exampleExercise})} onKeyDown={e => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {e.preventDefault(); void send();}
        }} />
      <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{pendingCount ? tt("outbox.pending", {count: pendingCount}) : t("enterHint")}</span>
        <Button type="submit" disabled={locked || !text.trim()}><Send className="size-4" />{t(working ? "working" : "send")}</Button></div>
    </form>
  </section>;
}
