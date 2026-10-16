import {test} from "node:test";
import assert from "node:assert/strict";
import {expandTrainingProgram} from "../src/lib/agent/training-program";
import {trainingProgramFixture} from "./fixtures/coach-plans";
import {adjustPlan} from "../src/lib/agent/plan-adjustment";
import {coachFailureCode} from "../src/lib/coach-failure";
import {CoachTimer} from "../src/lib/coach-timing";

test("12-week program expands complete independent weeks with explicit progression and recovery",()=>{
  const {plan,context}=expandTrainingProgram(trainingProgramFixture);
  assert.deepEqual(plan.weeks.map(w=>w.week_number),Array.from({length:12},(_,i)=>i+1));
  assert.ok(plan.weeks.every(w=>w.days.length===context.weeklyDays&&w.days.every(d=>d.estimated_duration_minutes<=context.sessionMinutes)));
  assert.deepEqual(plan.weeks.map(w=>w.days[0].exercises[0].sets),[3,3,3,3,4,4,4,4,4,4,4,2]);
  assert.equal(plan.weeks[11].days[0].exercises[0].target_rpe,6);
  assert.equal(plan.weeks[0].days[0].exercises[0].rest_seconds,90);
  const updated=adjustPlan(plan,{summary:"Change one exercise only",changes:[{path:"/weeks/0/days/0/exercises/0/sets",value:2}]});
  assert.ok("weeks" in updated);assert.deepEqual(updated.weeks.slice(1),plan.weeks.slice(1));
  assert.equal(plan.weeks[0].days[0].exercises[0].sets,3);
  assert.ok(JSON.stringify(trainingProgramFixture).length<JSON.stringify(plan).length/3);
});

test("gaps, overlap, wrong horizon, missing/duplicate/unused workouts fail closed",()=>{
  const mutations=[
    (p:typeof trainingProgramFixture)=>{p.program.phases[1].from_week=6;},
    (p:typeof trainingProgramFixture)=>{p.program.phases[1].from_week=4;},
    (p:typeof trainingProgramFixture)=>{p.program.total_weeks=13;},
    (p:typeof trainingProgramFixture)=>{p.program.phases[2].to_week=13;},
    (p:typeof trainingProgramFixture)=>{p.program.phases[0].workout_keys[0]="missing";},
    (p:typeof trainingProgramFixture)=>{p.program.workouts[1].key="day1";},
    (p:typeof trainingProgramFixture)=>{p.program.phases.forEach(x=>x.workout_keys=["day1","day1"]);},
  ];
  for(const mutate of mutations){const p=structuredClone(trainingProgramFixture);mutate(p);assert.throws(()=>expandTrainingProgram(p));}
});

test("expanded sets, RPE, frequency and duration must still satisfy every original bound",()=>{
  for(const field of ["sets_delta","rpe_delta"] as const){
    const p=structuredClone(trainingProgramFixture);p.program.phases[0][field]=-3;
    assert.throws(()=>expandTrainingProgram(p));
  }
  const frequency=structuredClone(trainingProgramFixture);frequency.context.weeklyDays=3;
  assert.throws(()=>expandTrainingProgram(frequency),/WEEKLY_DAYS/);
  const duration=structuredClone(trainingProgramFixture);duration.program.workouts[0].estimated_duration_minutes=60;
  assert.throws(()=>expandTrainingProgram(duration),/CONSTRAINT/);
  const excessive=structuredClone(trainingProgramFixture);excessive.program.total_weeks=17;
  assert.throws(()=>expandTrainingProgram(excessive));
});

test("failure codes and in-flight diagnostics expose no model or user text",()=>{
  assert.equal(coachFailureCode(new DOMException("private prompt","TimeoutError")),"MODEL_TIMEOUT");
  assert.equal(coachFailureCode(new Error("MODEL_OUTPUT_LIMIT")),"MODEL_OUTPUT_LIMIT");
  assert.equal(coachFailureCode(new Error("secret provider key")),"MODEL_UNAVAILABLE");
  let now=0;const timer=new CoachTimer(()=>now);timer.modelStarted();now=100;timer.modelOutput(50);now=23000;
  assert.deepEqual(timer.snapshot().generation,{startMs:0,durationMs:23000,outputChars:50,lastOutputMs:100,finished:false});
  const saved=timer.snapshot();timer.modelEnded();now=25000;assert.equal(timer.snapshot().generation?.durationMs,23000);
  assert.equal(saved.generation?.finished,false);
});
