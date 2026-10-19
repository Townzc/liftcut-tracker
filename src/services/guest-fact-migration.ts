import type {AppDataSnapshot} from "@liftcut/core/types";
import {personalEntrySchema,guestFactsSchema,type PersonalEntry} from "@/lib/personal-records";
import {activeGuestFacts,guestWorkspace,saveGuestCommand,clearImportedGuestFacts,nextGuestWorkspace} from "@/lib/guest-records";
import {ensureGuestSession} from "@/lib/guest-client";
const legacyPrefix="liftcut-guest-legacy-fact-v1:",journalKey="liftcut-guest-import-v1";

/** Adapt actual legacy records only. Settings and plan targets are never facts.
 * Mappings persist so a response-loss retry or a later login cannot clone them. */
export function collectGuestFacts(snapshot:AppDataSnapshot|null){
  function stage(key:string,entry:PersonalEntry){
    const storageKey=legacyPrefix+key,old=localStorage.getItem(storageKey);
    if(old==="imported")return;
    const id=old??crypto.randomUUID();localStorage.setItem(storageKey,id);
    saveGuestCommand({action:"create",id,entry,source:"manual",text:"",anchorDate:entry.date},false);
  }
  if(snapshot){
    for(const r of snapshot.bodyMetricLogs){
      const entry=personalEntrySchema.safeParse({kind:"body",date:r.date,weightKg:r.weight>0?r.weight:null,waistCm:r.waist>0?r.waist:null});
      if(entry.success)stage(`body:${r.id}`,entry.data);
    }
    for(const r of snapshot.foodLogs)stage(`food:${r.id}`,personalEntrySchema.parse({kind:"food",date:r.date,foodName:r.foodName,mealType:r.mealType,calories:r.calories??null,protein:r.protein??null}));
    for(const w of snapshot.workoutLogs)for(const e of w.exercises.filter(e=>e.completed&&(e.actualWeight!==null||e.actualReps!==null))){
      stage(`exercise:${w.id}:${e.id}`,personalEntrySchema.parse({kind:"exercise",date:w.date,exerciseName:e.name,weightKg:e.actualWeight,reps:e.actualReps,sets:e.recordedSets??null,rpe:e.actualRpe}));
    }
  }
  return activeGuestFacts();
}
export function hasGuestFacts(snapshot:AppDataSnapshot|null){
  if(localStorage.getItem(journalKey)||activeGuestFacts().length)return true;
  return !!snapshot&&(snapshot.bodyMetricLogs.some(r=>(r.weight>0||r.waist>0)&&localStorage.getItem(legacyPrefix+`body:${r.id}`)!=="imported")||
    snapshot.foodLogs.some(r=>localStorage.getItem(legacyPrefix+`food:${r.id}`)!=="imported")||snapshot.workoutLogs.some(w=>w.exercises.some(e=>e.completed&&(e.actualWeight!==null||e.actualReps!==null)&&localStorage.getItem(legacyPrefix+`exercise:${w.id}:${e.id}`)!=="imported")));
}
export function remainingGuestSnapshot(snapshot:AppDataSnapshot|null):AppDataSnapshot|null{
  if(!snapshot)return null;
  const pending=(key:string)=>localStorage.getItem(legacyPrefix+key)!=="imported";
  return {...snapshot,bodyMetricLogs:snapshot.bodyMetricLogs.filter(r=>pending(`body:${r.id}`)),foodLogs:snapshot.foodLogs.filter(r=>pending(`food:${r.id}`)),
    workoutLogs:snapshot.workoutLogs.map(w=>({...w,exercises:w.exercises.filter(e=>pending(`exercise:${w.id}:${e.id}`))})).filter(w=>w.exercises.length>0)};
}
export function prepareGuestImport(input:{userId:string;guestSnapshot:AppDataSnapshot|null}){
  const saved=localStorage.getItem(journalKey);
  const journal=saved?JSON.parse(saved):{userId:input.userId,workspaceId:guestWorkspace(),records:collectGuestFacts(input.guestSnapshot),confirm:true};
  if(journal.userId!==input.userId)throw new Error("IMPORT_DESTINATION_CHANGED");
  guestFactsSchema.parse(journal.records);
  const body=JSON.stringify(journal);localStorage.setItem(journalKey,body);
  if(localStorage.getItem(journalKey)!==body)throw new Error("STORAGE_UNAVAILABLE");
  return {...journal,records:guestFactsSchema.parse(journal.records)} as {userId:string;workspaceId:string;records:ReturnType<typeof activeGuestFacts>;confirm:true};
}
export async function migrateGuestFactsToUser(input:{userId:string;guestSnapshot:AppDataSnapshot|null}){
  await ensureGuestSession();
  const journal=prepareGuestImport(input);
  if(!journal.records.length){localStorage.removeItem(journalKey);return {count:0};}
  const response=await fetch("/api/guest-import",{method:"POST",headers:{"Content-Type":"application/json","X-Workout-Owner":input.userId},
    body:JSON.stringify({workspaceId:journal.workspaceId,records:journal.records,confirm:true}),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(response.status===409?"IMPORT_CONFLICT":"IMPORT_UNCONFIRMED");
  const receipt=await response.json();
  if(receipt.workspaceId!==journal.workspaceId||receipt.count!==journal.records.length||!Array.isArray(receipt.recordIds))throw new Error("IMPORT_UNCONFIRMED");
  const ids=new Set<string>(journal.records.map((r:{id:string})=>r.id));
  if(receipt.recordIds.length!==ids.size||receipt.recordIds.some((id:string)=>!ids.has(id)))throw new Error("IMPORT_UNCONFIRMED");
  for(const key of Object.keys(localStorage).filter(k=>k.startsWith(legacyPrefix)))if(ids.has(localStorage.getItem(key)!))localStorage.setItem(key,"imported");
  clearImportedGuestFacts([...ids]);nextGuestWorkspace();localStorage.removeItem(journalKey);
  // Unimported local records/plans/history remain intact. Active account plans
  // and settings are never overwritten by a guest-data transfer.
  return receipt as {count:number};
}
