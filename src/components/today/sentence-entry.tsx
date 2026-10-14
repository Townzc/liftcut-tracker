"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Session, StoredSet } from "@/lib/today";
import type { CommandReceipt, CommandRequest, ParsePreview } from "@/lib/workout-commands";
import { parseWorkoutLog } from "@/lib/workout-log-parser";
import { localContextHash, workoutContext } from "@/lib/workout-context";
import type { WorkoutOperation } from "@/lib/workout-outbox";
import { SetHistory } from "./set-history";

export type TodayPending = WorkoutOperation;
export function SentenceEntry({session,busy,submit}:{session:Session;busy:boolean;submit:(p:TodayPending)=>Promise<boolean>}) {
  const t = useTranslations("today.sentence");
  const [text,setText] = useState(""), [selected,setSelected] = useState("");
  const [preview,setPreview] = useState<ParsePreview | null>(null), [error,setError] = useState("");
  const [parsing,setParsing] = useState(false), flight = useRef(false);
  const [command,setCommand] = useState<CommandRequest | null>(null);
  const draft = preview?.result.status === "draft" ? preview.result.draft : null;
  const name = draft && draft.kind !== "end" ? session.prescription.exercises.find(e=>e.id===draft.exerciseId)?.name : "";
  const locked = busy || parsing || session.status !== "active";
  function clear() { setPreview(null);setCommand(null);setError(""); }
  async function parse() {
    if (flight.current || busy) return;
    flight.current=true;setParsing(true);clear();
    try {
      const request = {sessionId:session.id,text, ...(selected?{selectedExerciseId:selected}:{})};
      const value:ParsePreview = {result:parseWorkoutLog(text,workoutContext(session,selected||undefined)),
        contextHash:await localContextHash(session),parser:"rules-v1"};setPreview(value);
      if (value.result.status === "draft" && value.result.draft.kind !== "end") {
        const d=value.result.draft, count=d.kind==="record"?d.sets.length:d.kind==="skip"?1:0;
        setCommand({...request,id:crypto.randomUUID(),version:1,contextHash:value.contextHash,
          setIds:Array.from({length:count},()=>crypto.randomUUID()),authorization:"confirm_preview"});
      }
    } catch {setError(t("previewFailed"));}
    finally {flight.current=false;setParsing(false);}
  }
  async function confirm() {
    const p:TodayPending | null = draft?.kind === "end" ? {action:"end",body:{id:session.id,revision:session.revision+1,status:"ended"}}
      : command ? {action:"apply",body:command} : null;
    if (!p) return;
    if (await submit(p)) {setText("");clear();}
    else {setPreview(null);setCommand(null);} // Parent retains the exact request for uncertain-response retry.
  }
  return <Card><CardHeader><CardTitle>{t("title")}</CardTitle><p className="text-sm text-muted-foreground">{t("hint")}</p></CardHeader>
    <CardContent className="space-y-3">
      <label className="block text-sm" htmlFor="sentence-exercise">{t("exercise")}</label>
      <select id="sentence-exercise" className="w-full rounded-lg border bg-background p-2" disabled={locked} value={selected}
        onChange={e=>{setSelected(e.target.value);clear();}}><option value="">{t("fromText")}</option>
        {session.prescription.exercises.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select>
      <label className="block text-sm" htmlFor="sentence-input">{t("input")}</label>
      <textarea id="sentence-input" className="min-h-24 w-full rounded-lg border bg-background p-3 text-base" maxLength={400}
        disabled={locked} value={text} onChange={e=>{setText(e.target.value);clear();}} placeholder={t("example")} />
      <Button variant="outline" disabled={locked || !text.trim()} onClick={()=>void parse()}>{t(parsing?"parsing":"preview")}</Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {preview?.result.status === "clarify" && <p role="status" className="text-sm">{t(`clarify.${preview.result.reason}`)}</p>}
      {draft && <div role="status" className="space-y-2 rounded-lg bg-muted p-3 text-sm" data-testid="sentence-preview">
        <strong>{t("rulesDraft")}{name ? ` · ${name}` : ""}</strong>
        {draft.kind === "record" && draft.sets.map(s=><p key={s.setIndex}>{t("set",{n:s.setIndex})}: {s.reportedWeight ?? "—"} {s.inputUnit ?? "kg"} × {s.reps} · RPE {s.rpe ?? "—"}</p>)}
        {draft.kind === "correct" && <p>{t("correction",{n:draft.setIndex,before:session.sets.find(s=>s.id===draft.recordId)?.reps ?? "—",after:draft.changes.reps})}</p>}
        {draft.kind === "skip" && <p>{t("skip",{n:draft.setIndex})}</p>}
        {draft.kind === "end" && <p>{t("endHint")}</p>}
        <Button disabled={locked} onClick={()=>void confirm()}>{t(draft.kind==="end"?"confirmEnd":"confirm")}</Button>
        <p className="text-xs text-muted-foreground">{t("unknown")}</p>
      </div>}
    </CardContent></Card>;
}

const actual = (s:StoredSet) => `${s.weightKg ?? "—"} kg × ${s.reps ?? "—"} · RPE ${s.rpe ?? "—"}`;
export function SentenceReceipts({receipts,busy,submit,pendingIds=[]}:{receipts:CommandReceipt[];busy:boolean;submit:(p:TodayPending)=>Promise<boolean>;pendingIds?:string[]}) {
  const t=useTranslations("today.sentence");
  if (!receipts.length) return null;
  return <section id="sentence-receipts" className="space-y-3 scroll-mt-4" aria-label={t("receipts")}>
    <h2 className="text-lg font-semibold">{t("receipts")}</h2><p className="text-xs text-muted-foreground">{t("receiptHint")}</p>
    {receipts.map(r=><Card key={r.id} data-testid={`receipt-${r.id}`}><CardContent className="space-y-2 pt-4 text-sm">
      <p className="break-words font-medium">“{r.text}”</p>
      <p className="text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()} · {t(pendingIds.includes(r.id) || (r.undo && pendingIds.includes(r.undo.id)) ? "pending" : r.undo?"undone":"saved")}</p>
      {r.changes.map(c=><div key={c.after.id}><p>{c.exerciseName} · {t("set",{n:c.after.setIndex})}: {c.before?actual(c.before):"—"} → {c.after.status==="skipped"?t("skipped"):actual(c.after)}</p><SetHistory id={c.after.id} /></div>)}
      {r.undo ? <div className="rounded bg-muted p-2"><p>{t("compensation")}</p>{r.undo.changes.map(c=><p key={c.after.id}>
        {t("set",{n:c.after.setIndex})}: {c.after.status==="voided"?t("voided"):actual(c.after)} · v{c.after.revision}</p>)}</div>
        : <Button variant="outline" disabled={busy} onClick={()=>void submit({action:"undo",body:{id:crypto.randomUUID(),commandId:r.id,version:1}})}>{t("undo")}</Button>}
    </CardContent></Card>)}
  </section>;
}
