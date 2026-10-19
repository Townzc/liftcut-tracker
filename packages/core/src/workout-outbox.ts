import { startSessionSchema, endSessionSchema, setRequestSchema, type Session, type TodayData, type StoredSet } from "./today";
import { commandSchema, undoCommandSchema, type SetChange } from "./workout-commands";
import { parseWorkoutLog } from "./workout-log-parser";
import { storedSet, workoutCanonical, workoutContext } from "./workout-context";
import { clonePlain } from "./plain-data";
import { replaceExerciseSchema, undoReplacementSchema, projectReplacement, projectReplacementUndo } from "./exercise-replacement";

export type WorkoutOperation = { action:"start" | "set" | "end" | "apply" | "undo" | "replace" | "undoReplacement"; body:unknown };
export type OutboxItem = { id:string; action:WorkoutOperation["action"]; bodyJson:string; createdAt:string;
  status:"pending" | "retry" | "auth" | "conflict"; attempts:number; nextAttempt:number; error?:string };
export type OutboxState = { owner:string; version:1; revision:number; confirmed:TodayData | null; items:OutboxItem[];
  lease?:{ itemId:string; token:string; until:number }; discarded?:{ at:string; items:OutboxItem[] }[] };
export const emptyOutbox = (owner:string):OutboxState => ({owner,version:1,revision:0,confirmed:null,items:[]});
const conflict = ():never => { throw new Error("LOCAL_CONFLICT"); };
export function operationBody(p:WorkoutOperation) {
  return (p.action === "start" ? startSessionSchema : p.action === "set" ? setRequestSchema
    : p.action === "end" ? endSessionSchema : p.action === "apply" ? commandSchema : p.action === "replace" ? replaceExerciseSchema
    : p.action === "undoReplacement" ? undoReplacementSchema : undoCommandSchema).parse(p.body);
}
export function operationId(p:WorkoutOperation) {
  const body=operationBody(p);
  return `${p.action}:${body.id}:${"revision" in body ? body.revision : "version" in body ? body.version : 1}`;
}
export const operationOf = (item:OutboxItem):WorkoutOperation => ({action:item.action,body:JSON.parse(item.bodyJson)});

// A local projection is explicitly pending, never a server receipt. The server
// independently reparses/authorizes and validates every revision at commit time.
export function projectOperation(base:TodayData, p:WorkoutOperation, at:string):TodayData {
  const data=clonePlain(base), session=data.session;
  if (p.action === "start") { startSessionSchema.parse(p.body); if (session?.status === "active") conflict(); return data; }
  if (p.action === "undo") {
    const req=undoCommandSchema.parse(p.body), receipt=data.receipts?.find(r=>r.id===req.commandId);
    if (!receipt || receipt.undo) return conflict();
    const changes=receipt.changes.map(c=>({before:c.after,after:c.before ? {...c.before,revision:c.after.revision+1}
      : {...c.after,revision:c.after.revision+1,status:"voided" as const},exerciseName:c.exerciseName}));
    if (session?.id === receipt.sessionId) {
      for (const c of changes) {
        const current=session.sets.find(s=>s.id===c.after.id);
        if (!current || workoutCanonical(storedSet(current)) !== workoutCanonical(c.before)) conflict();
      }
      replaceSets(session,changes,at);
    }
    receipt.undo={id:req.id,createdAt:at,changes};return data;
  }
  if (!session || session.status !== "active") return conflict();
  if(p.action==="replace" || p.action==="undoReplacement") {
    data.session=p.action==="replace"?projectReplacement(session,p.body,at):projectReplacementUndo(session,p.body,at);return data;
  }
  if (p.action === "end") {
    const req=endSessionSchema.parse(p.body);
    if (req.id !== session.id || req.revision !== session.revision+1) conflict();
    session.status="ended";session.revision=req.revision;session.endedAt=at;return data;
  }
  if (p.action === "set") {
    let req:StoredSet=setRequestSchema.parse(p.body);
    const before=session.sets.find(s=>s.id===req.id), exercise=session.prescription.exercises.find(e=>e.id===req.planExerciseId);
    if (req.sessionId !== session.id || !exercise || req.setIndex > exercise.sets || req.revision !== (before?.revision ?? 0)+1
      || before?.status === "voided" || (before && (before.setIndex !== req.setIndex || before.planExerciseId !== req.planExerciseId))
      || (!before && session.sets.some(s=>s.planExerciseId===req.planExerciseId && s.setIndex===req.setIndex))) return conflict();
    if (req.status === "voided") {
      if (!before || ["weightKg","reps","rpe"].some(k=>before[k as keyof StoredSet]!==req[k as keyof StoredSet])) return conflict();
      req={...storedSet(before),status:"voided",revision:req.revision};
    }
    replaceSets(session,[{before:before?storedSet(before):null,after:req,exerciseName:exercise.name}],at);return data;
  }
  const req=commandSchema.parse(p.body);
  if (req.sessionId !== session.id) return conflict();
  const parsed=parseWorkoutLog(req.text,workoutContext(session,req.selectedExerciseId));
  if (parsed.status !== "draft" || parsed.draft.kind === "end") return conflict();
  const draft=parsed.draft, exercise=session.prescription.exercises.find(e=>e.id===draft.exerciseId)!;
  const changes:SetChange[]=[];
  if (draft.kind === "correct") {
    if (req.setIds.length) return conflict();
    const before=storedSet(session.sets.find(s=>s.id===draft.recordId)!);
    changes.push({before,after:{...before,revision:before.revision+1,reps:draft.changes.reps,repsSource:"user_said",sourceRef:req.id},exerciseName:exercise.name});
  } else {
    const sets=draft.kind === "record" ? draft.sets : [{setIndex:draft.setIndex,weightKg:null,reps:null,rpe:null,inputUnit:null}];
    if (req.setIds.length !== sets.length) return conflict();
    sets.forEach((s,i)=>changes.push({before:null,exerciseName:exercise.name,after:{id:req.setIds[i],sessionId:session.id,
      planExerciseId:exercise.id,setIndex:s.setIndex,revision:1,status:draft.kind==="skip"?"skipped":"done",
      weightKg:s.weightKg,reps:s.reps,rpe:s.rpe,inputUnit:s.inputUnit??"kg",weightSource:s.weightKg===null?null:"user_said",
      repsSource:s.reps===null?null:"user_said",sourceRef:req.id}}));
  }
  replaceSets(session,changes,at);
  data.receipts=[{id:req.id,sessionId:session.id,text:req.originalText??req.text,draft,changes,createdAt:at,undo:null},...(data.receipts??[])];
  return data;
}
function replaceSets(session:Session,changes:SetChange[],at:string) {
  session.sets=[...session.sets.filter(s=>!changes.some(c=>c.after.id===s.id)),
    ...changes.map(c=>({...c.after,exerciseName:c.exerciseName,updatedAt:at}))]
    .sort((a,b)=>a.planExerciseId < b.planExerciseId ? -1 : a.planExerciseId > b.planExerciseId ? 1 : a.setIndex-b.setIndex);
}
export function projectOutbox(state:OutboxState) {
  let data=state.confirmed;
  try { for (const item of state.items) { if (!data) return {data,error:true}; data=projectOperation(data,operationOf(item),item.createdAt); } }
  catch { return {data,error:true}; }
  return {data,error:false};
}
export function mergeConfirmed(base:TodayData,action:WorkoutOperation["action"],value:Session | {session:Session;receipts:TodayData["receipts"]}):TodayData {
  const session="session" in value?value.session:value;
  return {...base,session:action === "undo" && base.session?.id !== session.id ? base.session : session,
    receipts:"receipts" in value?value.receipts:base.receipts};
}
export function retryDisposition(status:number,code:string) {
  return status===401 || code==="ACCOUNT_CHANGED" ? "auth" as const
    : status===408 || status===429 || status>=500 ? "retry" as const : "conflict" as const;
}
