import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { exerciseCatalog, identifyExercise, replacementCandidates, equipmentIds, EXERCISE_CATALOG_VERSION } from "@liftcut/core/exercise-catalog";
import { projectReplacement, projectReplacementUndo, replaceExerciseSchema, type ReplaceExerciseRequest } from "../src/lib/exercise-replacement";
import { projectOperation } from "../src/lib/workout-outbox";
import type { Session, SetLog } from "../src/lib/today";
const base=():Session=>({id:randomUUID(),userId:randomUUID(),localDate:"2026-10-14",timezone:"UTC",trainingPlanId:"p",weekNumber:1,dayNumber:1,
  status:"active",revision:1,startedAt:"2026-10-14T00:00:00Z",endedAt:null,sets:[],prescription:{title:"Synthetic",exercises:[
    {id:randomUUID(),name:"杠铃卧推",sets:3,repRange:"8-12",targetRpe:7}]}});
const request=(s:Session):ReplaceExerciseRequest=>({id:randomUUID(),sessionId:s.id,version:1,revision:s.revision+1,exerciseId:s.prescription.exercises[0].id,
  newExerciseId:randomUUID(),contextHash:"a".repeat(64),catalogVersion:EXERCISE_CATALOG_VERSION,candidateId:"dumbbell-floor-press",equipment:["dumbbells"],authorization:"confirm_preview"});
test("catalog: 60 unique entries, exact bilingual identity, all equipment required and deterministic compatible candidates",()=>{
  assert.equal(exerciseCatalog.length,60);assert.equal(new Set(exerciseCatalog.map(e=>e.id)).size,60);
  for(const e of exerciseCatalog){assert.equal(identifyExercise(e.zh)?.id,e.id);assert.equal(identifyExercise(e.en)?.id,e.id);
    assert.ok(e.equipment.every(x=>equipmentIds.includes(x)));assert.equal(new Set(e.equipment).size,e.equipment.length);}
  assert.equal(identifyExercise("unknown"),null);assert.equal(identifyExercise("深蹲"),null);
  assert.equal(identifyExercise("杠铃卧推",[exerciseCatalog[0],{...exerciseCatalog[1],aliases:["杠铃卧推"]}]),null);
  assert.equal(identifyExercise("  BARBELL   BENCH PRESS  ")?.id,"barbell-bench");
  assert.deepEqual(replacementCandidates("杠铃卧推",["dumbbells"]).map(e=>e.id),["dumbbell-floor-press","pushup"]);
  assert.deepEqual(replacementCandidates("杠铃卧推",["bench","dumbbells"]),replacementCandidates("杠铃卧推",["dumbbells","bench"]));
  assert.deepEqual(replacementCandidates("高位下拉",[]),[]);
  assert.ok(!replacementCandidates("坐姿腿弯举",["cable"]).some(e=>e.id==="cable-leg-curl"));
  for(const e of exerciseCatalog) for(const c of replacementCandidates(e.zh,[...equipmentIds])) {
    assert.equal(c.pattern,e.pattern);assert.equal(c.body,e.body);assert.notEqual(c.id,e.id);
  }
});
test("fixed schema rejects stale catalog, guessed equipment, duplicates and missing confirmation",()=>{
  const req=request(base());for(const invalid of [{catalogVersion:"old"},{equipment:["unknown"]},{equipment:["bench","bench"]},{authorization:"auto"}])
    assert.equal(replaceExerciseSchema.safeParse({...req,...invalid}).success,false);
});
test("replacement and compensation preserve prescription, unknown actuals and immutable identity lineage",()=>{
  const s=base(),req=request(s),at="2026-10-14T01:00:00Z",p=projectReplacement(s,req,at);
  assert.equal(s.revision,1);assert.equal(s.prescription.exercises[0].name,"杠铃卧推");
  assert.equal(p.revision,2);assert.equal(p.prescription.exercises[0].name,"哑铃地板卧推");assert.deepEqual(p.sets,[]);
  assert.deepEqual(p.replacements![0].before,s.prescription.exercises[0]);assert.equal(p.prescription.exercises[0].originalPlanExerciseId,req.exerciseId);
  const undo={id:randomUUID(),sessionId:s.id,replacementId:req.id,version:1,revision:3,newExerciseId:randomUUID(),contextHash:req.contextHash,authorization:"confirm_preview"};
  const restored=projectReplacementUndo(p,undo,at);assert.equal(restored.prescription.exercises[0].name,"杠铃卧推");
  assert.equal(restored.prescription.exercises[0].id,undo.newExerciseId);assert.equal(restored.prescription.exercises[0].targetRpe,7);assert.deepEqual(restored.sets,[]);
  assert.throws(()=>projectReplacementUndo(p,{...undo,newExerciseId:req.exerciseId},at),/EXERCISE_ID_REUSED/);
  assert.throws(()=>projectReplacementUndo(restored,{...undo,revision:4},at),/ALREADY_UNDONE/);
  assert.throws(()=>projectReplacement(restored,{...request(restored),newExerciseId:req.newExerciseId},at),/EXERCISE_ID_REUSED/);
});
test("any set history, ended session, stale version and unavailable candidate fail without mutation",()=>{
  const s=base(),req=request(s),at=s.startedAt;
  for(const status of ["done","skipped","voided"] as const) {
    const has={...s,sets:[{planExerciseId:req.exerciseId,status} as SetLog]};
    assert.throws(()=>projectReplacement(has,req,at),/EXERCISE_HAS_HISTORY/);assert.equal(has.revision,1);
  }
  assert.throws(()=>projectReplacement({...s,status:"ended"},req,at),/SESSION_ENDED/);
  assert.throws(()=>projectReplacement(s,{...req,revision:3},at),/STALE_REVISION/);
  assert.throws(()=>projectReplacement(s,{...req,candidateId:"barbell-squat"},at),/CANDIDATE_UNAVAILABLE/);
  assert.throws(()=>projectReplacement(s,{...req,candidateId:"dumbbell-bench"},at),/CANDIDATE_UNAVAILABLE/);
});
test("offline replacement changes identity: old requests reject, dependent new sets are allowed and block undo",()=>{
  const s=base(),req=request(s),at=s.startedAt;
  const data=projectOperation({session:s,days:[],previous:{}},{action:"replace",body:req},at);
  const tap={id:randomUUID(),sessionId:s.id,planExerciseId:req.exerciseId,setIndex:1,revision:1,status:"done",weightKg:null,reps:8,rpe:null,
    weightSource:null,repsSource:"user_entered",inputUnit:"kg",sourceRef:"today-tap"};
  assert.throws(()=>projectOperation(data,{action:"set",body:tap},at),/LOCAL_CONFLICT/);
  const after=projectOperation(data,{action:"set",body:{...tap,planExerciseId:req.newExerciseId}},at);
  assert.equal(after.session!.sets[0].exerciseName,"哑铃地板卧推");assert.equal(after.session!.sets[0].weightKg,null);
  assert.throws(()=>projectReplacementUndo(after.session!,{id:randomUUID(),sessionId:s.id,replacementId:req.id,version:1,revision:3,newExerciseId:randomUUID(),
    contextHash:req.contextHash,authorization:"confirm_preview"},at),/EXERCISE_HAS_HISTORY/);
});
