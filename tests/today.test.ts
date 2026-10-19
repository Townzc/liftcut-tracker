import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { localDateAt, sessionsToWorkoutLogs, setRequestSchema, type Session } from "@liftcut/core/today";
import { getPersonalRecords } from "../src/lib/pr-tracker";
import { estimateWorkoutCalories } from "../src/lib/workout-calories";

test("today dates follow IANA timezone around midnight and DST, not UTC", () => {
  assert.equal(localDateAt(new Date("2026-10-14T06:59:59Z"),"America/Los_Angeles"),"2026-10-13");
  assert.equal(localDateAt(new Date("2026-10-14T07:00:01Z"),"America/Los_Angeles"),"2026-10-14");
  assert.equal(localDateAt(new Date("2026-10-13T15:59:59Z"),"Asia/Shanghai"),"2026-10-13");
  assert.equal(localDateAt(new Date("2026-10-13T16:00:01Z"),"Asia/Shanghai"),"2026-10-14");
  assert.equal(localDateAt(new Date("2026-11-01T08:30:00Z"),"America/Los_Angeles"),"2026-11-01");
});
test("actuals require reported reps, bounded numbers and matching provenance", () => {
  const req = { id:randomUUID(),sessionId:randomUUID(),planExerciseId:"squat",setIndex:1,revision:1,status:"done",
    weightKg:null,reps:8,rpe:null,weightSource:null,repsSource:"user_entered",inputUnit:"kg",sourceRef:"today-tap" };
  assert.equal(setRequestSchema.parse(req).rpe,null);
  for (const patch of [{reps:null},{rpe:0},{reps:1.5},{weightKg:NaN},{weightSource:"user_entered"},{status:"skipped"},{userId:randomUUID()}])
    assert.equal(setRequestSchema.safeParse({...req,...patch}).success,false);
});
test("adapter excludes voided/skipped sets from history, PR, charts and calorie set totals", () => {
  const s: Session = { id:randomUUID(),userId:randomUUID(),localDate:"2026-10-13",timezone:"Asia/Shanghai",trainingPlanId:"p",
    weekNumber:1,dayNumber:1,status:"ended",revision:2,startedAt:"2026-10-13T10:00:00Z",endedAt:"2026-10-13T10:30:00Z",
    prescription:{title:"A",exercises:[]},sets:[] };
  s.sets = ["done","voided","skipped"].map((status,i)=>({ id:randomUUID(),sessionId:s.id,planExerciseId:"e",setIndex:i+1,
    revision:1,status:status as "done",weightKg:i===0?50:100,reps:8,rpe:null,weightSource:"user_entered",repsSource:"user_entered",
    inputUnit:"kg",sourceRef:"today-tap",exerciseName:"Squat",updatedAt:s.startedAt }));
  const logs=sessionsToWorkoutLogs([s]);
  assert.equal(logs[0].exercises.length,1); assert.equal(logs[0].exercises[0].actualRpe,null);
  assert.equal(getPersonalRecords(logs)[0].maxWeight,50);
  const input={bodyWeightKg:70,durationMinutes:30,exercises:logs[0].exercises};
  assert.equal(estimateWorkoutCalories({...input,planExercises:[{id:"e",sets:100}]}),estimateWorkoutCalories(input));
  assert.deepEqual(sessionsToWorkoutLogs([{...s,sets:s.sets.slice(1)}]),[]);
});
