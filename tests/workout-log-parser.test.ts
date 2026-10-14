import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorkoutLog, type ParseResult } from "../src/lib/workout-log-parser";
import { contexts, workoutLogCorpus } from "./fixtures/workout-log-corpus";
import { evaluateWorkoutParser } from "./helpers/workout-parser-eval";

test("150 authored rule cases match exact drafts or request clarification; no invented nulls", () => {
  const report = evaluateWorkoutParser();
  assert.equal(workoutLogCorpus.length,150);
  assert.equal(new Set(workoutLogCorpus.map(r=>r.id)).size,150);
  assert.equal(report.families,10);
  assert.deepEqual(report.failures,[]);
  assert.equal(report.exact,150);
  assert.ok(report.expectedDrafts > 50);
  assert.equal(report.falseDrafts,0);
  assert.equal(report.inventedNulls,0);
  assert.equal(report.omittedFields,0);
  assert.equal(report.matchedFields,report.fieldCount);
  assert.equal(report.correctionMatches,report.correctionCount);
});

test("evaluation detects always-refuse, fabricated RPE and wrong correction target", () => {
  const refused = evaluateWorkoutParser(()=>({status:"clarify",reason:"always"}));
  assert.equal(refused.draftMatches,0); assert.ok(refused.exact < refused.total); assert.ok(refused.omittedFields > 0);
  const invented = evaluateWorkoutParser((s,c)=>{
    const out=parseWorkoutLog(s,c);
    if(out.status==="draft" && out.draft.kind==="record") out.draft.sets.forEach(r=>{if(r.rpe===null)r.rpe=8;});
    return out;
  });
  assert.ok(invented.inventedNulls>0); assert.ok(invented.exact<invented.total);
  const misdirected = evaluateWorkoutParser((s,c)=>{
    const out=parseWorkoutLog(s,c);if(out.status==="draft" && out.draft.kind==="correct")out.draft.recordId="wrong";return out;
  });
  assert.equal(misdirected.correctionMatches,0);
});

test("no mutation or inherited defaults; historical changes do not change new actuals", () => {
  const original=structuredClone(contexts.existing), altered=structuredClone(original);
  altered.actuals[0].weightKg=200;altered.actuals[0].rpe=10;
  const first=parseWorkoutLog("10次",original), second=parseWorkoutLog("10次",altered);
  assert.deepEqual(first,second);assert.deepEqual(original,contexts.existing);
  assert.deepEqual(parseWorkoutLog("刚才最后一组其实7次",original),{status:"draft",draft:{kind:"correct",exerciseId:"bench",recordId:"r2",revision:5,setIndex:2,changes:{reps:7},explicit:true}});
});

test("invalid or conflicting context cannot choose a target silently", () => {
  const cases=[
    {...structuredClone(contexts.empty),selectedExerciseId:"missing"},
    {...structuredClone(contexts.existing),actuals:[contexts.existing.actuals[0],contexts.existing.actuals[0]]},
    {...structuredClone(contexts.existing),actuals:[{...contexts.existing.actuals[0],revision:0}]},
    {...structuredClone(contexts.existing),actuals:[{...contexts.existing.actuals[0],rpe:0}]},
    {...structuredClone(contexts.existing),actuals:[{...contexts.existing.actuals[0],weightKg:NaN}]},
  ];
  for(const context of cases) assert.deepEqual(parseWorkoutLog("10次",context),{status:"clarify",reason:"invalid_context"});
});

test("existing skipped or voided slots stay occupied; ending synthesizes no actuals", () => {
  const c=structuredClone(contexts.voided);c.actuals[0].status="skipped";
  assert.equal(parseWorkoutLog("跳过第1组",c).status,"clarify");
  const out=parseWorkoutLog("10次",c);assert.equal(out.status,"draft");
  if(out.status==="draft" && out.draft.kind==="record")assert.equal(out.draft.sets[0].setIndex,2);
  for(const c of Object.values(contexts))assert.deepEqual(parseWorkoutLog("练完了",c),{status:"draft",draft:{kind:"end",explicit:false}});
});

test("all drafts satisfy bounds, explicit report sources and require downstream authorization", () => {
  for(const row of workoutLogCorpus){
    const result: ParseResult=parseWorkoutLog(row.text,contexts[row.context]);
    if(result.status!=="draft")continue;
    assert.ok(!("approved" in result.draft));
    if(result.draft.kind==="record")for(const set of result.draft.sets){
      assert.ok(set.reps>=0 && set.reps<=100);
      assert.equal(set.weightKg===null,set.inputUnit===null);
      assert.ok(set.rpe===null || set.rpe>=1 && set.rpe<=10);
    }
  }
});
