"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setRequestSchema, type Session, type SetLog, type SetRequest, type PrescriptionExercise, type TodayData } from "@/lib/today";
import { useTrackerStore } from "@/store/use-tracker-store";
import { projectOutbox, type OutboxState, type OutboxItem } from "@/lib/workout-outbox";
import { WorkoutOutboxClient } from "@/services/today/outbox-client";
import { ExerciseReplacement, ReplacementReceipts } from "./exercise-replacement";
import { exerciseCatalog, exerciseLabel } from "@/lib/exercise-catalog";

import { SentenceEntry, SentenceReceipts, type TodayPending as Pending } from "./sentence-entry";
function PendingOperation({item,data}:{item:OutboxItem;data:TodayData | null}) {
  const t=useTranslations("today"),locale=useLocale();
  const body=JSON.parse(item.bodyJson);
  if(item.action==="replace")return <li>{t("replacement.open")} · {exerciseLabel(exerciseCatalog.find(e=>e.id===body.candidateId)?.zh??"—",locale)}</li>;
  if(item.action==="undoReplacement")return <li>{t("replacement.undo")}</li>;
  if(item.action==="apply")return <li>“{body.text}”</li>;
  if(item.action==="undo")return <li>{t("sentence.undo")} · “{data?.receipts?.find(r=>r.id===body.commandId)?.text??"—"}”</li>;
  if(item.action==="start" || item.action==="end")return <li>{t(item.action)}</li>;
  const exercise=data?.session?.prescription.exercises.find(e=>e.id===body.planExerciseId);
  return <li>{exercise?.name??"—"} · {t("set",{number:body.setIndex})} · {t(body.status)}:
    {" "}{body.weightKg??"—"} kg × {body.reps??"—"} · RPE {body.rpe??"—"}</li>;
}
function SetRow({ session, exercise, index, saved, previous, busy, submit }: {
  session: Session; exercise: PrescriptionExercise; index: number; saved?: SetLog;
  previous?: { weightKg: number | null; reps: number | null }; busy: boolean; submit: (p: Pending) => Promise<boolean>;
}) {
  const t = useTranslations("today");
  const [id] = useState(() => saved?.id ?? crypto.randomUUID());
  const [weight, setWeight] = useState(String((saved ? saved.weightKg : previous?.weightKg) ?? ""));
  const [reps, setReps] = useState(String((saved ? saved.reps : previous?.reps) ?? ""));
  const [rpe, setRpe] = useState(String(saved?.rpe ?? "")); // Never copied from prescription/history.
  const [changed, setChanged] = useState({ weight: false, reps: false });
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const fieldId = `${exercise.id}-${index}`;
  const number = (s: string) => s.trim() === "" ? null : Number(s);
  async function send(status: SetRequest["status"]) {
    const weightKg = status === "skipped" ? null : number(weight), count = status === "skipped" ? null : number(reps);
    const source = (key: "weight" | "reps", value: number | null) => value === null ? null
      : saved && !changed[key] ? "user_entered" as const
      : previous && !changed[key] ? "user_confirmed_prefill" as const : "user_entered" as const;
    const body = { id, sessionId: session.id, planExerciseId: exercise.id, setIndex: index,
      revision: (saved?.revision ?? 0) + 1, status, weightKg, reps: count, rpe: status === "skipped" ? null : number(rpe),
      weightSource: source("weight",weightKg), repsSource: source("reps",count), inputUnit: "kg", sourceRef: "today-tap" };
    const result = setRequestSchema.safeParse(body);
    if (!result.success) { setInvalid(true); return; }
    await submit({ action: "set", body: result.data });
  }
  const locked = session.status !== "active" || saved?.status === "voided";
  return <div className="space-y-3 rounded-xl border bg-background p-3" data-testid={`set-${exercise.id}-${index}`}>
    <div className="flex justify-between text-sm"><strong>{t("set",{ number: index })}</strong>
      <span>{saved ? t(saved.status) : t("unrecorded")}</span></div>
    {saved && !editing ? <>
      <p className="text-sm">{saved.weightKg ?? "—"} kg × {saved.reps ?? "—"} · RPE {saved.rpe ?? "—"}</p>
      {!locked && <div className="flex gap-2">
        <Button variant="outline" disabled={busy} onClick={() => setEditing(true)}>{t("correct")}</Button>
        {saved.status === "done" && <Button variant="outline" disabled={busy} onClick={() => {
          const original = setRequestSchema.strip().parse({ ...saved, inputUnit:"kg", sourceRef:"today-tap",
            weightSource:saved.weightKg===null?null:"user_entered",repsSource:saved.reps===null?null:"user_entered" });
          void submit({ action: "set", body: { ...original, status: "voided", revision: saved.revision+1 } });
        }}>{t("undo")}</Button>}
      </div>}
    </> : <>
      {previous && <p className="text-xs text-muted-foreground">{t("previous", { weight: previous.weightKg ?? "—", reps: previous.reps ?? "—" })}</p>}
      <div className="grid grid-cols-3 gap-2">
        <label htmlFor={`${fieldId}-weight`} className="text-xs">{t("weight")}<Input id={`${fieldId}-weight`} type="number" inputMode="decimal" step="any" min="0" max="1000" disabled={busy || locked}
          value={weight} onChange={e => { setWeight(e.target.value); setChanged(c => ({...c,weight:true})); }} placeholder="—" /></label>
        <label htmlFor={`${fieldId}-reps`} className="text-xs">{t("reps")}<Input id={`${fieldId}-reps`} type="number" inputMode="numeric" min="0" max="100" disabled={busy || locked}
          value={reps} onChange={e => { setReps(e.target.value); setChanged(c => ({...c,reps:true})); }} placeholder="—" /></label>
        <label htmlFor={`${fieldId}-rpe`} className="text-xs">RPE<Input id={`${fieldId}-rpe`} type="number" inputMode="decimal" step="0.5" min="1" max="10" disabled={busy || locked}
          value={rpe} onChange={e => setRpe(e.target.value)} placeholder={t("optional")} /></label>
      </div>
      {invalid && <p role="alert" className="text-sm text-destructive">{t("invalid")}</p>}
      <div className="flex gap-2"><Button disabled={busy || locked || reps.trim() === ""} onClick={() => void send("done")}>{t(editing ? "saveCorrection" : "complete")}</Button>
        {!saved && <Button variant="outline" disabled={busy || locked} onClick={() => void send("skipped")}>{t("skip")}</Button>}</div>
    </>}
  </div>;
}

export function TodayPage({ enabled }: { enabled: boolean }) {
  const t = useTranslations("today"), { user, authMode } = useAuth();
  if (!enabled) return <Card><CardHeader><CardTitle>{t("notOpen")}</CardTitle></CardHeader></Card>;
  if (authMode !== "authenticated" || !user) return <Card><CardContent className="space-y-3 pt-6"><p>{t("loginRequired")}</p><Link href="/workout">{t("legacy")}</Link></CardContent></Card>;
  // Remount synchronously on account changes: never render the previous owner's data.
  return <TodayWorkspace key={user.id} owner={user.id} />;
}
function TodayWorkspace({owner}:{owner:string}) {
  const t=useTranslations("today"),locale=useLocale();
  const [state,setState]=useState<OutboxState | null>(null);
  const client=useRef<WorkoutOutboxClient | null>(null);
  const [remote,setRemote]=useState<{data:TodayData;revision:number} | null>(null);
  const [dayId, setDayId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const selectedWeek = useTrackerStore(s => s.selectedWeek), selectedDay = useTrackerStore(s => s.selectedDay);
  const refreshHistory = useTrackerStore(s => s.refreshUserData);
  useEffect(() => {
    const outbox=new WorkoutOutboxClient(owner,next=>setState(old=>old && old.revision>=next.revision?old:next),setError,
      ()=>{void refreshHistory().catch(()=>{});});
    client.current=outbox;void outbox.start();
    return ()=>{outbox.dispose();client.current=null;};
  },[owner,refreshHistory]);
  const projection=state?projectOutbox(state):{data:null,error:false}, data=projection.data;
  const head=state?.items[0], count=state?.items.length??0;
  const issue=error || (head?.status==="conflict"?"CONFLICT":head?.status==="auth"?"AUTH":head?.status==="retry"?"UNKNOWN":projection.error?"LOCAL_CONFLICT":"");
  const locked=busy || !state || error==="STORAGE" || error==="AUTH" || projection.error || head?.status==="conflict" || head?.status==="auth";
  async function recover() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try {
      if(head?.status==="conflict")setRemote(await client.current!.remoteForConflict());
      else {setError("");await client.current!.refresh();}
    }
    catch { setError("LOAD_FAILED"); }
    finally { setBusy(false); inFlight.current = false; }
  }
  async function retry() {
    try {setError("");await client.current!.retry();} catch {setError("STORAGE");}
  }
  async function submit(p: Pending) {
    if (inFlight.current || !state || locked) return false;
    inFlight.current = true; setBusy(true); setError("");
    try {
      await client.current!.enqueue(p,state.revision);return true; // Means durably queued; the UI labels it pending until acknowledged.
    } catch(e) {setError(e instanceof Error && e.message==="LOCAL_CONFLICT"?"LOCAL_CONFLICT":"STORAGE");return false;}
    finally { setBusy(false); inFlight.current = false; }
  }
  const session = data?.session;
  const chosen = dayId || data?.days.find(d => d.weekNumber === selectedWeek && d.dayNumber === selectedDay)?.id || data?.days[0]?.id || "";
  return <div className="mx-auto max-w-2xl space-y-4">
    <div><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("intro")}</p></div>
    <div className="space-y-2 rounded-xl border p-3 text-sm">
      <p role="status" data-testid="outbox-status">{t(issue?"outbox.failed":count?"outbox.pending":data?"outbox.synced":"loading",{count})}</p>
      <p className="text-xs text-muted-foreground">{t("outbox.hint")}</p>
      {!!count && <Button variant="outline" disabled={busy || head?.status==="conflict"} onClick={()=>void retry()}>{t("retry")}</Button>}
    </div>
    {!!data?.receipts?.length && <p role="status" className="text-sm"><a className="underline" href="#sentence-receipts">{t("sentence.viewReceipts")}</a></p>}
    {issue && <div role="alert" className="space-y-2 rounded-xl border p-3 text-sm"><p>{t(`errors.${issue}`)}</p>
      <Button variant="outline" disabled={busy} onClick={() => void recover()}>{t("recover")}</Button>
      {head?.status==="auth" && <Link className="ml-2 underline" href="/login">{t("outbox.login")}</Link>}
    </div>}
    {remote && <Card><CardContent className="space-y-3 pt-4 text-sm" data-testid="outbox-conflict">
      <p>{t("outbox.conflictHint",{count})}</p>
      <details open><summary>{t("outbox.local")}</summary><ol className="ml-5 list-decimal space-y-2">{state?.items.map(item=><PendingOperation key={item.id} item={item} data={data} />)}</ol></details>
      <details open><summary>{t("outbox.remote")}</summary><p>{remote.data.session ? t(remote.data.session.status==="active"?"active":"ended") : t("outbox.noActive")}</p>
        {remote.data.session?.prescription.exercises.map(e=><p key={e.id}>{exerciseLabel(e.name,locale)} · {t("target",{sets:e.sets,reps:e.repRange,rpe:e.targetRpe})}</p>)}
        {remote.data.session?.sets.map(s=><p key={s.id}>{s.exerciseName} · {t("set",{number:s.setIndex})}: {s.weightKg??"—"} kg × {s.reps??"—"} · RPE {s.rpe??"—"} · {t(s.status)} · v{s.revision}</p>)}</details>
      <Button variant="outline" disabled={busy} onClick={async()=>{
        try {await client.current!.discardConflict(remote);setRemote(null);setError("");}catch{setError("LOCAL_CONFLICT");}
      }}>{t("outbox.discard",{count})}</Button>
    </CardContent></Card>}
    {!data && !issue && <p>{t("loading")}</p>}
    {data && !session && <Card><CardContent className="space-y-4 pt-6">
      <label className="block text-sm">{t("selectDay")}<select aria-label={t("selectDay")} className="mt-2 w-full rounded border bg-background p-3" value={chosen} onChange={e => setDayId(e.target.value)} disabled={busy}>
        {data.days.map(d => <option key={d.id} value={d.id}>{t("day", { week: d.weekNumber, day: d.dayNumber })} · {d.title}</option>)}</select></label>
      {!data.days.length && <p>{t("noPlan")} <Link href="/plan">{t("plan")}</Link></p>}
      <p className="text-xs text-muted-foreground">{t("outbox.startHint")}</p>
      <Button disabled={!chosen || locked || !!count} onClick={() => void submit({ action:"start", body:{ id:crypto.randomUUID(), dayId:chosen, timezone:Intl.DateTimeFormat().resolvedOptions().timeZone } })}>{t("start")}</Button>
    </CardContent></Card>}
    {session && <>
      <Card><CardHeader><CardTitle>{session.prescription.title}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
        <p>{session.localDate} · {session.timezone}</p><p>{t(session.status === "active" ? "active" : "ended")}</p>
        <p>{t("progress", { done:session.sets.filter(s=>s.status==="done").length, total:session.prescription.exercises.reduce((n,e)=>n+e.sets,0) })}</p>
      </CardContent></Card>
      {session.status === "active" && <SentenceEntry key={session.id} session={session} busy={locked} submit={submit} />}
      {session.prescription.exercises.map(exercise => <Card key={exercise.id}><CardHeader><CardTitle>{exerciseLabel(exercise.name,locale)}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("target", { sets:exercise.sets,reps:exercise.repRange,rpe:exercise.targetRpe })}</p></CardHeader>
        <CardContent className="space-y-3"><ExerciseReplacement session={session} exercise={exercise} busy={locked} submit={submit} />{Array.from({ length:exercise.sets },(_,i)=> {
          const saved = session.sets.find(s=>s.planExerciseId===exercise.id && s.setIndex===i+1);
          return <SetRow key={`${session.id}-${i}-${saved?.revision ?? 0}`} session={session} exercise={exercise} index={i+1} saved={saved}
            previous={exercise.originalPlanExerciseId?undefined:data.previous[exercise.name]} busy={locked} submit={submit} />;
        })}</CardContent></Card>)}
      <ReplacementReceipts session={session} busy={locked} submit={submit}
        pendingIds={state?.items.filter(i=>i.action==="replace"||i.action==="undoReplacement").map(i=>(JSON.parse(i.bodyJson) as {id:string}).id)} />
      {session.status === "active" ? <div className="space-y-2"><p className="text-sm text-muted-foreground">{t("endHint")}</p>
        <Button disabled={locked} onClick={() => void submit({ action:"end",body:{ id:session.id,revision:session.revision+1,status:"ended" } })}>{t("end")}</Button></div>
        : !count && <Link href="/workout" className="underline">{t("history")}</Link>}
    </>}
    <SentenceReceipts receipts={data?.receipts ?? []} busy={locked} submit={submit}
      pendingIds={state?.items.filter(i=>i.action==="apply" || i.action==="undo").map(i=>(JSON.parse(i.bodyJson) as {id:string}).id)} />
  </div>;
}
