"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useAuth } from "@/components/auth/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { setRequestSchema, type Session, type SetLog, type SetRequest, type PrescriptionExercise, type TodayData } from "@/lib/today";
import { useTrackerStore } from "@/store/use-tracker-store";

type Pending = { action: "start" | "set" | "end"; body: unknown };
function SetRow({ session, exercise, index, saved, previous, busy, submit }: {
  session: Session; exercise: PrescriptionExercise; index: number; saved?: SetLog;
  previous?: { weightKg: number | null; reps: number | null }; busy: boolean; submit: (p: Pending) => Promise<void>;
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
      : saved && !changed[key] ? (key === "weight" ? saved.weightSource : saved.repsSource)
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
          const original = setRequestSchema.strip().parse(saved);
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
  const [data, setData] = useState<TodayData | null>(null);
  const [dayId, setDayId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const inFlight = useRef(false);
  const selectedWeek = useTrackerStore(s => s.selectedWeek), selectedDay = useTrackerStore(s => s.selectedDay);
  const refreshHistory = useTrackerStore(s => s.refreshUserData);
  const load = useCallback(async () => {
    const response = await fetch("/api/workout-sessions", { cache: "no-store" });
    if (!response.ok) throw new Error("LOAD_FAILED");
    return await response.json() as TodayData;
  }, []);
  useEffect(() => {
    if (!enabled || !user || authMode !== "authenticated") return;
    let cancelled = false;
    load().then(next => { if (!cancelled) setData(next); }).catch(() => { if (!cancelled) setError("LOAD_FAILED"); });
    return () => { cancelled = true; };
  }, [enabled,user,authMode,load]);
  async function recover() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { setData(await load()); setError(""); setPending(null); await refreshHistory(); }
    catch { setError("LOAD_FAILED"); }
    finally { setBusy(false); inFlight.current = false; }
  }
  async function submit(p: Pending) {
    if (inFlight.current) return; // Close the double-click gap before React re-renders.
    inFlight.current = true; setBusy(true); setError(""); setPending(p);
    try {
      const response = await fetch(`/api/workout-sessions?action=${p.action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p.body) });
      const value = await response.json();
      if (!response.ok) {
        setError(response.status === 409 ? "CONFLICT" : "UNKNOWN");
        if (response.status < 500) setPending(null);
        return;
      }
      setData(old => ({ ...old!, session: value })); setPending(null);
      // Saving succeeded even if legacy history refresh fails. Do not retry the write for a read error.
      try { await refreshHistory(); } catch { setError("HISTORY_FAILED"); }
    } catch { setError("UNKNOWN"); }
    finally { setBusy(false); inFlight.current = false; }
  }
  if (!enabled) return <Card><CardHeader><CardTitle>{t("notOpen")}</CardTitle></CardHeader></Card>;
  if (authMode !== "authenticated" || !user) return <Card><CardContent className="space-y-3 pt-6"><p>{t("loginRequired")}</p><Link href="/workout">{t("legacy")}</Link></CardContent></Card>;
  const session = data?.session;
  const chosen = dayId || data?.days.find(d => d.weekNumber === selectedWeek && d.dayNumber === selectedDay)?.id || data?.days[0]?.id || "";
  return <div className="mx-auto max-w-2xl space-y-4">
    <div><h1 className="text-2xl font-semibold">{t("title")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("intro")}</p></div>
    {error && <div role="alert" className="space-y-2 rounded-xl border p-3 text-sm"><p>{t(`errors.${error}`)}</p>
      <Button variant="outline" disabled={busy} onClick={() => void recover()}>{t("recover")}</Button>
      {pending && <Button className="ml-2" disabled={busy} onClick={() => void submit(pending)}>{t("retry")}</Button>}</div>}
    {!data && !error && <p>{t("loading")}</p>}
    {data && !session && <Card><CardContent className="space-y-4 pt-6">
      <label className="block text-sm">{t("selectDay")}<select aria-label={t("selectDay")} className="mt-2 w-full rounded border bg-background p-3" value={chosen} onChange={e => setDayId(e.target.value)} disabled={busy}>
        {data.days.map(d => <option key={d.id} value={d.id}>{t("day", { week: d.weekNumber, day: d.dayNumber })} · {d.title}</option>)}</select></label>
      {!data.days.length && <p>{t("noPlan")} <Link href="/plan">{t("plan")}</Link></p>}
      <Button disabled={!chosen || busy || !!pending} onClick={() => void submit({ action:"start", body:{ id:crypto.randomUUID(), dayId:chosen, timezone:Intl.DateTimeFormat().resolvedOptions().timeZone } })}>{t("start")}</Button>
    </CardContent></Card>}
    {session && <>
      <Card><CardHeader><CardTitle>{session.prescription.title}</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
        <p>{session.localDate} · {session.timezone}</p><p>{t(session.status === "active" ? "active" : "ended")}</p>
        <p>{t("progress", { done:session.sets.filter(s=>s.status==="done").length, total:session.prescription.exercises.reduce((n,e)=>n+e.sets,0) })}</p>
      </CardContent></Card>
      {session.prescription.exercises.map(exercise => <Card key={exercise.id}><CardHeader><CardTitle>{exercise.name}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("target", { sets:exercise.sets,reps:exercise.repRange,rpe:exercise.targetRpe })}</p></CardHeader>
        <CardContent className="space-y-3">{Array.from({ length:exercise.sets },(_,i)=> {
          const saved = session.sets.find(s=>s.planExerciseId===exercise.id && s.setIndex===i+1);
          return <SetRow key={`${session.id}-${i}-${saved?.revision ?? 0}`} session={session} exercise={exercise} index={i+1} saved={saved}
            previous={data.previous[exercise.name]} busy={busy || !!pending || error === "CONFLICT"} submit={submit} />;
        })}</CardContent></Card>)}
      {session.status === "active" ? <div className="space-y-2"><p className="text-sm text-muted-foreground">{t("endHint")}</p>
        <Button disabled={busy || !!pending} onClick={() => void submit({ action:"end",body:{ id:session.id,revision:session.revision+1,status:"ended" } })}>{t("end")}</Button></div>
        : <Link href="/workout" className="underline">{t("history")}</Link>}
    </>}
  </div>;
}
