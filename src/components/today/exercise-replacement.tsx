"use client";
import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { PrescriptionExercise, Session } from "@/lib/today";
import { EXERCISE_CATALOG_VERSION, equipmentIds, exerciseLabel, identifyExercise, replacementCandidates, type Equipment } from "@/lib/exercise-catalog";
import { replacementBlocked, type ReplaceExerciseRequest, type UndoReplacementRequest } from "@/lib/exercise-replacement";
import { localContextHash } from "@/lib/workout-context";
import type { WorkoutOperation } from "@/lib/workout-outbox";

type Props={session:Session;busy:boolean;submit:(p:WorkoutOperation)=>Promise<boolean>};
export function ExerciseReplacement({session,exercise,busy,submit}:Props & {exercise:PrescriptionExercise}) {
  const t=useTranslations("today.replacement"),locale=useLocale();
  const [open,setOpen]=useState(false),[equipment,setEquipment]=useState<Equipment[]>([]),[selected,setSelected]=useState("");
  const [preview,setPreview]=useState<ReplaceExerciseRequest|null>(null),[working,setWorking]=useState(false),[error,setError]=useState(false);
  const flight=useRef(false),reason=replacementBlocked(session,exercise.id),source=identifyExercise(exercise.name);
  const candidates=replacementCandidates(exercise.name,equipment),target=candidates.find(e=>e.id===selected);
  function clear() {setPreview(null);setError(false);}
  async function prepare() {
    if(!target || flight.current)return;flight.current=true;setWorking(true);
    try {setPreview({id:crypto.randomUUID(),sessionId:session.id,version:1,revision:session.revision+1,
      contextHash:await localContextHash(session),exerciseId:exercise.id,newExerciseId:crypto.randomUUID(),
      candidateId:target.id,catalogVersion:EXERCISE_CATALOG_VERSION,equipment:[...equipment].sort(),authorization:"confirm_preview"});}
    catch {setError(true);}finally{flight.current=false;setWorking(false);}
  }
  if(session.status!=="active")return null;
  return <div className="space-y-3 rounded-xl border border-dashed p-3 text-sm" data-testid={`replace-${exercise.id}`}>
    <Button variant="outline" disabled={busy || !!reason} onClick={()=>{setOpen(!open);clear();}}>{t("open")}</Button>
    {reason && <p className="text-xs text-muted-foreground">{t("hasHistory")}</p>}
    {open && <div className="space-y-3">
      <p>{t("scope")}</p>
      <fieldset disabled={busy || working || !!reason} className="space-y-2"><legend className="font-medium">{t("equipmentTitle")}</legend>
        <p className="text-xs text-muted-foreground">{t("equipmentHint")}</p>
        <div className="grid grid-cols-2 gap-2">{equipmentIds.map(id=><label key={id} className="flex items-center gap-2">
          <input type="checkbox" checked={equipment.includes(id)} onChange={e=>{setEquipment(xs=>e.target.checked?[...xs,id]:xs.filter(x=>x!==id));setSelected("");clear();}} />{t(`equipment.${id}`)}</label>)}</div>
      </fieldset>
      {!source ? <p>{t("unknown")}</p> : !candidates.length ? <p>{t("none")}</p> : <>
        <label className="block">{t("candidate")}<select aria-label={t("candidate")} className="mt-1 w-full rounded border bg-background p-2" disabled={busy || working || !!reason}
          value={selected} onChange={e=>{setSelected(e.target.value);clear();}}><option value="">{t("choose")}</option>
          {candidates.map(e=><option key={e.id} value={e.id}>{locale==="en"?e.en:e.zh}</option>)}</select></label>
        {target && <p>{t("reason",{pattern:t(`patterns.${target.pattern}`),body:t(`body.${target.body}`),
          equipment:target.equipment.map(id=>t(`equipment.${id}`)).join(" / ")||t("bodyweight")})}</p>}
        {!preview && <Button variant="outline" disabled={!target || busy || working || !!reason} onClick={()=>void prepare()}>{t("preview")}</Button>}
      </>}
      {preview && target && <div className="space-y-2 rounded-lg border p-3" data-testid="replacement-preview">
        <strong>{exerciseLabel(exercise.name,locale)} → {locale==="en"?target.en:target.zh}</strong>
        <p>{t("prescription",{sets:exercise.sets,reps:exercise.repRange,rpe:exercise.targetRpe})}</p><p>{t("actuals")}</p>
        <div className="flex flex-wrap gap-2"><Button disabled={busy || working || !!reason} onClick={async()=>{
          if(await submit({action:"replace",body:preview})){setOpen(false);clear();}else setError(true);
        }}>{t("confirm")}</Button><Button variant="outline" disabled={busy || working} onClick={clear}>{t("cancel")}</Button></div>
      </div>}
      {error && <p role="alert">{t("stale")}</p>}
    </div>}
  </div>;
}

export function ReplacementReceipts({session,busy,submit,pendingIds=[]}:Props & {pendingIds?:string[]}) {
  const t=useTranslations("today.replacement"),locale=useLocale();
  const [preview,setPreview]=useState<UndoReplacementRequest|null>(null),[working,setWorking]=useState(false),[error,setError]=useState(false);
  if(!session.replacements?.length)return null;
  return <section className="space-y-3" data-testid="replacement-receipts" aria-label={t("receipts")}><h2 className="font-semibold">{t("receipts")}</h2>
    {[...session.replacements].reverse().map(r=>{
      const blocked=replacementBlocked(session,r.after.id);
      return <div key={r.id} className="space-y-2 rounded-xl border p-3 text-sm" data-testid={`replacement-receipt-${r.id}`}>
        <strong>{exerciseLabel(r.before.name,locale)} → {exerciseLabel(r.after.name,locale)}</strong>
        <p>{t(pendingIds.includes(r.id)||!!r.undo&&pendingIds.includes(r.undo.id)?"pending":"saved")}</p><p className="text-xs text-muted-foreground">{t("scope")}</p>
        {r.undo?<p>{t("undone")}: {exerciseLabel(r.undo.after.name,locale)}</p>:<>
          <Button variant="outline" disabled={busy || working || !!blocked} onClick={async()=>{
            setWorking(true);setError(false);
            try {setPreview({id:crypto.randomUUID(),sessionId:session.id,replacementId:r.id,version:1,revision:session.revision+1,
              newExerciseId:crypto.randomUUID(),contextHash:await localContextHash(session),authorization:"confirm_preview"});}
            catch{setError(true);}finally{setWorking(false);}
          }}>{t("undo")}</Button>
          {blocked && <p>{t("undoBlocked")}</p>}
          {preview?.replacementId===r.id && <div className="space-y-2" data-testid="replacement-undo-preview">
            <p>{t("undoPreview",{name:exerciseLabel(r.before.name,locale)})}</p>
            <div className="flex gap-2"><Button disabled={busy || working || !!blocked} onClick={async()=>{
              if(await submit({action:"undoReplacement",body:preview})){setPreview(null);setError(false);}else setError(true);
            }}>{t("confirmUndo")}</Button><Button variant="outline" disabled={busy} onClick={()=>{setPreview(null);setError(false);}}>{t("cancel")}</Button></div>
          </div>}
        </>}
      </div>;
    })}
    {error && <p role="alert">{t("stale")}</p>}
  </section>;
}
