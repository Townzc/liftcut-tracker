import { z } from "zod";
import type { PrescriptionExercise, Session } from "./today";
import { equipmentIds, EXERCISE_CATALOG_VERSION, replacementCandidates, type Equipment } from "./exercise-catalog";
import { workoutCanonical } from "./workout-context";

const common={id:z.uuid(),sessionId:z.uuid(),version:z.literal(1),revision:z.number().int().min(2),
  contextHash:z.string().regex(/^[a-f0-9]{64}$/),newExerciseId:z.uuid(),authorization:z.literal("confirm_preview")};
export const replaceExerciseSchema=z.object({...common,exerciseId:z.string().min(1).max(150),catalogVersion:z.literal(EXERCISE_CATALOG_VERSION),
  candidateId:z.string().min(1).max(80),equipment:z.array(z.enum(equipmentIds)).max(equipmentIds.length)
    .refine(xs=>new Set(xs).size===xs.length,"Duplicate equipment")}).strict();
export const undoReplacementSchema=z.object({...common,replacementId:z.uuid()}).strict();
export type ReplaceExerciseRequest=z.infer<typeof replaceExerciseSchema>;
export type UndoReplacementRequest=z.infer<typeof undoReplacementSchema>;
export type ReplacementChange={id:string;sessionId:string;revision:number;before:PrescriptionExercise;after:PrescriptionExercise;createdAt:string};
export type ReplacementReceipt=ReplacementChange & {catalogVersion:string;equipment:Equipment[];undo:ReplacementChange|null};
export class ReplacementConflict extends Error {}
const fail=(reason:string):never=>{throw new ReplacementConflict(reason);};
export function replacementBlocked(session:Session,exerciseId:string) {
  if(session.status!=="active")return "SESSION_ENDED";
  if(!session.prescription.exercises.some(e=>e.id===exerciseId))return "STALE_EXERCISE";
  if(session.sets.some(s=>s.planExerciseId===exerciseId))return "EXERCISE_HAS_HISTORY";
  return null;
}
function validate(session:Session,req:ReplaceExerciseRequest|UndoReplacementRequest,exerciseId:string) {
  if(session.id!==req.sessionId)fail("NOT_FOUND");
  const reason=replacementBlocked(session,exerciseId);if(reason)fail(reason);
  if(req.revision!==session.revision+1)fail("STALE_REVISION");
  // Never revive an old identity, even after several replacements/compensations.
  const ids=[...session.prescription.exercises.map(e=>e.id),...session.sets.map(s=>s.planExerciseId),
    ...(session.replacements??[]).flatMap(r=>[r.before.id,r.after.id,r.undo?.after.id])];
  if(ids.includes(req.newExerciseId))fail("EXERCISE_ID_REUSED");
}
export function projectReplacement(session:Session,input:unknown,at:string):Session {
  const req=replaceExerciseSchema.parse(input);validate(session,req,req.exerciseId);
  const before=session.prescription.exercises.find(e=>e.id===req.exerciseId)!;
  const target=replacementCandidates(before.name,req.equipment).find(e=>e.id===req.candidateId);
  if(!target) return fail("CANDIDATE_UNAVAILABLE");
  const after={...before,id:req.newExerciseId,name:target.zh,catalogId:target.id,originalPlanExerciseId:before.originalPlanExerciseId??before.id};
  const receipt:ReplacementReceipt={id:req.id,sessionId:session.id,revision:req.revision,before,after,createdAt:at,
    catalogVersion:req.catalogVersion,equipment:req.equipment,undo:null};
  return {...session,revision:req.revision,prescription:{...session.prescription,exercises:session.prescription.exercises.map(e=>e.id===before.id?after:e)},
    replacements:[...(session.replacements??[]),receipt]};
}
export function projectReplacementUndo(session:Session,input:unknown,at:string):Session {
  const req=undoReplacementSchema.parse(input),receipt=session.replacements?.find(r=>r.id===req.replacementId);
  if(!receipt)return fail("NOT_FOUND");
  if(receipt.undo)return fail("ALREADY_UNDONE");
  validate(session,req,receipt.after.id);
  const before=session.prescription.exercises.find(e=>e.id===receipt.after.id)!;
  if(workoutCanonical(before)!==workoutCanonical(receipt.after))return fail("STALE_EXERCISE");
  const after={...receipt.before,id:req.newExerciseId,originalPlanExerciseId:receipt.before.originalPlanExerciseId??receipt.before.id};
  const undo={id:req.id,sessionId:session.id,revision:req.revision,before,after,createdAt:at};
  return {...session,revision:req.revision,prescription:{...session.prescription,exercises:session.prescription.exercises.map(e=>e.id===before.id?after:e)},
    replacements:session.replacements!.map(r=>r.id===receipt.id?{...r,undo}:r)};
}
