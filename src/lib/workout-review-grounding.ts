import { z } from "zod";
import { numericRoleEvidence, type NumericRole } from "@liftcut/core/parse-label-roles";
import { resolveConfirmedSet } from "@liftcut/core/confirmed-set-reference";
import { reviewBasis, referenceFor, type WorkoutReview, type WorkoutConversationState } from "@liftcut/core/workout-review";
import { storedSet } from "@liftcut/core/workout-context";
import type { Session, StoredSet } from "@liftcut/core/today";
import { mentionedExercises } from "./workout-source";
import { GroundingError } from "./coach-grounding";

const quote=z.string().min(1).max(100).nullable();
export const workoutReviewExtractionSchema=z.strictObject({
  kind:z.enum(["record","correct","inherit_weight","void","skip"]),
  exerciseId:z.string().min(1).max(150),
  targetQuote:quote.describe("Exact target phrase for correction/void/skip, or null. For record/inherit_weight use null; an explicit same-weight phrase may be quoted but is never a set index."),
  groups:z.array(z.strictObject({weightQuote:quote,repsQuote:quote,rpeQuote:quote,countQuote:quote})).max(16)
    .describe("Current literal quantities only. One group per explicitly different set/load; countQuote only for an explicit uniform set count. Empty for void/skip."),
});
export const workoutAppendExtractionSchema=workoutReviewExtractionSchema.omit({targetQuote:true}).extend({kind:z.enum(["record","inherit_weight","void","skip"])});
export const workoutCorrectionExtractionSchema=z.strictObject({
  exerciseId:z.string().min(1).max(150),
  changes:z.array(z.strictObject({field:z.enum(["weight","reps","rpe"]),quote:z.string().min(1).max(100)})).min(1).max(3)
    .describe("ONLY fields the current message changes. Quote the new value from this message. Omit unchanged fields; the server preserves them.")
    .refine(xs=>new Set(xs.map(x=>x.field)).size===xs.length),
});
export function correctionAsReview(input:z.infer<typeof workoutCorrectionExtractionSchema>){
  const group:{weightQuote:string|null;repsQuote:string|null;rpeQuote:string|null;countQuote:null}={weightQuote:null,repsQuote:null,rpeQuote:null,countQuote:null};
  for(const change of input.changes)group[`${change.field}Quote`]=change.quote;
  return {kind:"correct" as const,exerciseId:input.exerciseId,targetQuote:null,groups:[group]};
}
const fail=(s:string):never=>{throw new GroundingError(s);};
const same=/同上|重量(?:没变|不变|一样|相同)|(?:同样|相同)的?重量|还是[^，,;；。]*重量|(?:沿用|使用)(?:刚才|刚刚|上(?:一)?组|前一组|之前)的?重量|same (?:weight|load)/i;
const correction=/更正|改正|不对|记错|说错|改成|改为|帮我改|不是|correction|correct|change|actually/i;
const uncertain=/不确定|记不清|忘记|忘了|好像|大概|差不多|可能|也许|应该|左右(?!各)|十几个|几次|几组|(?:至少|最多|不到)|about|around|maybe|unsure|not sure|probably/i;
const perHand=/单边|单侧|左右各|每只|每个哑铃|一边|一侧|per hand|each hand|each arm|per arm|each dumbbell/i;
function quotedRole(text:string,span:string|null,role:NumericRole,names:string[]) {
  if(span===null)return null;
  if(!text.includes(span))return fail("QUOTE_NOT_IN_CURRENT_MESSAGE");
  const all=numericRoleEvidence(text,names),part=numericRoleEvidence(span).evidence.filter(e=>e.role===role);
  if(part.length!==1)return fail("NUMERIC_ROLE_MISMATCH");
  const p=part[0];
  const matches=all.evidence.filter(e=>e.role===role&&e.value===p.value&&e.unit===p.unit&&e.polarity==="stated");
  if(!matches.length)return fail("AMBIGUOUS_NUMERIC_SOURCE");
  return p;
}
/** No model-supplied numeric values or record IDs. Only this message's validated
 * literal spans and fresh server-confirmed references can become write values. */
export function groundWorkoutReview(input:unknown,text:string,session:Session,state:WorkoutConversationState,
  ids:{id:string;conversationId:string;requestId:string;newId:()=>string}):WorkoutReview {
  const p=workoutReviewExtractionSchema.parse(input),names=session.prescription.exercises.map(e=>e.name);
  // Canonicalize symbolic weight references without turning them into numbers.
  // The load still comes exclusively from a fresh confirmed row below.
  if((p.kind==="record"||p.kind==="inherit_weight")&&same.test(text)){
    p.kind="inherit_weight";
    // An explicit reference with no newly stated load is a database lookup, not
    // extraction. Ignore any copied model quote; it can never supply the value.
    if(!numericRoleEvidence(text,names).evidence.some(e=>e.role==="weight"&&e.polarity==="stated"))
      for(const g of p.groups)g.weightQuote=null;
    if(p.targetQuote&&text.includes(p.targetQuote)&&same.test(p.targetQuote))p.targetQuote=null;
    for(const g of p.groups)if(g.weightQuote&&text.includes(g.weightQuote)&&(same.test(g.weightQuote)||/^(?:还是)?(?:刚才|刚刚|上次|上一组|上组|同样|相同|之前).*(?:重量|用重)$|^same (?:weight|load)$/i.test(g.weightQuote)))g.weightQuote=null;
    if(p.targetQuote&&text.includes(p.targetQuote)&&numericRoleEvidence(p.targetQuote).evidence.some(e=>e.role==="ordinal"))p.targetQuote=null;
  }
  if(session.status!=="active")return fail("SESSION_ENDED");
  if(/[?？]|(?:帮我看看|是不是|有没有漏|记不清)|假如|假设|如果|明天|\b(?:should|would|tomorrow|hypothetical)\b/i.test(text))return fail("CLARIFICATION_REQUIRED");
  if(uncertain.test(text))return fail("UNCERTAIN_KEEP_PENDING");
  const mentions=mentionedExercises(text,session),exercise=session.prescription.exercises.find(e=>e.id===p.exerciseId);
  if(!exercise||mentions.length>1||mentions.length===1&&mentions[0]!==exercise.id)return fail("EXERCISE_NEEDS_CLARIFICATION");
  if(!mentions.length&&(state.pendingText||state.focus?.exerciseId!==exercise.id))return fail("CONFIRMED_FOCUS_REQUIRED");
  if(!mentions.length&&state.focus)resolveConfirmedSet(session,{reference:state.focus});
  const review:WorkoutReview={id:ids.id,conversationId:ids.conversationId,requestId:ids.requestId,sessionId:session.id,
    basis:reviewBasis(session),kind:p.kind,before:[],requests:[],references:[],text};
  const evidence=numericRoleEvidence(text,names).evidence.filter(e=>e.polarity==="stated");
  const push=(s:StoredSet,before:StoredSet|null)=>{
    if(s.setIndex<1||s.setIndex>100||s.reps!==null&&(!Number.isInteger(s.reps)||s.reps<0||s.reps>100)
      ||s.weightKg!==null&&(s.weightKg<0||s.weightKg>1000)||s.perHandLoad&&(s.perHandLoad.value<0||s.perHandLoad.value>1000)
      ||s.rpe!==null&&(s.rpe<1||s.rpe>10))return fail("OUT_OF_RANGE");
    review.requests.push(s);review.before.push(before);
  };
  const target=()=>{
    if(p.targetQuote!==null&&!text.includes(p.targetQuote))return fail("TARGET_QUOTE_MISSING");
    // The source's numeric roles select the record, never an LLM's numeric target.
    const ordinals=evidence.filter(e=>e.role==="ordinal");
    if(ordinals.length>1)return fail("TARGET_ROLE_MISMATCH");
    if(ordinals.length===1)return resolveConfirmedSet(session,{exerciseId:exercise.id,target:ordinals[0].value});
    if(/最后(?:一)?组|last set/i.test(text))return resolveConfirmedSet(session,{exerciseId:exercise.id,target:"last"});
    if(state.pendingText)return fail("PENDING_IS_NOT_A_CONFIRMED_RECORD");
    if(!state.focus||state.focus.exerciseId!==exercise.id)return fail("CONFIRMED_FOCUS_REQUIRED");
    if(!/那组|上一组|上组|刚刚|刚才|\b(?:that|previous|last)\b/i.test(text))return fail("TARGET_REQUIRED");
    return resolveConfirmedSet(session,{reference:state.focus});
  };
  if(p.kind==="void"){
    if(p.groups.length||!/别算|不算|作废|撤销|无效|取消|void|undo|invalid|doesn't count/i.test(text))return fail("VOID_INTENT_REQUIRED");
    const s=target();review.references=[referenceFor(s)];push({...storedSet(s),revision:s.revision+1,status:"voided"},storedSet(s));return review;
  }
  if(p.kind==="skip"){
    if(p.groups.length||!/没做|没练|不做了|跳过|skip|did not|didn't/i.test(text))return fail("SKIP_INTENT_REQUIRED");
    if(p.targetQuote!==null&&!text.includes(p.targetQuote))return fail("SKIP_TARGET_REQUIRED");
    const remaining=/剩下|remaining/i.test(text),count=evidence.filter(e=>e.role==="count");
    const ordinal=evidence.filter(e=>e.role==="ordinal");
    if(ordinal.length>1||remaining&&ordinal.length)return fail("SKIP_TARGET_REQUIRED");
    if(remaining&&(count.length!==1||count[0].value<1))return fail("SKIP_COUNT_REQUIRED");
    if(!remaining&&!ordinal.length&&(count.length>1||count.length===1&&count[0].value!==exercise.sets||session.sets.some(s=>s.planExerciseId===exercise.id&&s.status==="done")))return fail("SKIP_TARGET_REQUIRED");
    const start=ordinal[0]?.value??(remaining?exercise.sets-count[0].value+1:1),end=ordinal[0]?.value??exercise.sets;
    if(start<1)return fail("SKIP_COUNT_INVALID");
    if(end>exercise.sets)return fail("SKIP_COUNT_INVALID");
    for(let i=start;i<=end;i++){
      if(session.sets.some(s=>s.planExerciseId===exercise.id&&s.setIndex===i))continue;
      push({id:ids.newId(),sessionId:session.id,planExerciseId:exercise.id,setIndex:i,revision:1,status:"skipped",
        weightKg:null,reps:null,rpe:null,inputUnit:"kg",weightSource:null,repsSource:null,sourceRef:ids.id},null);
    }
    if(!review.requests.length)return fail("NOTHING_TO_SKIP");return review;
  }
  if(!p.groups.length)return fail("ACTUAL_QUANTITIES_REQUIRED");
  const values=p.groups.map(g=>({weight:quotedRole(text,g.weightQuote,"weight",names),reps:quotedRole(text,g.repsQuote,"reps",names),
    rpe:quotedRole(text,g.rpeQuote,"rpe",names),count:quotedRole(text,g.countQuote,"count",names)}));
  const converted=(w:NonNullable<typeof values[number]["weight"]>)=>Math.round(w.value*(w.unit==="lb"?0.45359237:1)*1e6)/1e6;
  if(p.kind==="correct"){
    if(!correction.test(text)||values.length!==1||values[0].count)return fail("CORRECTION_NEEDS_CLARIFICATION");
    const s=target(),v=values[0],r={...storedSet(s),revision:s.revision+1,sourceRef:ids.id};
    if(v.weight){
      if(perHand.test(text)||s.perHandLoad){r.perHandLoad={value:v.weight.value,unit:v.weight.unit!};r.weightKg=null;r.weightSource=null;}
      else {r.weightKg=converted(v.weight);r.weightSource="user_said";r.inputUnit=v.weight.unit!;}
    }
    if(v.reps){r.reps=v.reps.value;r.repsSource="user_said";}if(v.rpe)r.rpe=v.rpe.value;
    if(!v.weight&&!v.reps&&!v.rpe)return fail("CORRECTION_VALUE_REQUIRED");
    review.references=[referenceFor(s)];push(r,storedSet(s));return review;
  }
  if(correction.test(text)||/别算|作废|撤销|没做|没练|不做了|原本|打算|计划|没完成|didn't|planned/i.test(text))return fail("NOT_AN_APPEND_REPORT");
  const inherit=p.kind==="inherit_weight";
  if(inherit!==same.test(text)||p.targetQuote!==null)return fail("EXPLICIT_SAME_WEIGHT_REQUIRED");
  const source=inherit?resolveConfirmedSet(session,{exerciseId:exercise.id,target:"last"}):null;
  if(source&&source.weightKg===null&&!source.perHandLoad)return fail("SOURCE_WEIGHT_UNKNOWN");
  if(inherit&&values.some(v=>v.weight))return fail("MIXED_WEIGHT_SOURCE");
  const reps=evidence.filter(e=>e.role==="reps"),counts=evidence.filter(e=>e.role==="count"&&
    !(e.value===1&&/(?:一组|per set)\s*[0-9零一二两三四五六七八九十]+\s*(?:个|次|reps)/i.test(text)));
  if(reps.length!==values.length||values.some((v,i)=>!v.reps||v.reps.value!==reps[i]?.value))return fail("REPS_REQUIRED_FOR_EACH_GROUP");
  if(values.length>1&&values.some(v=>v.count)||values.length>1&&evidence.some(e=>e.role==="rpe"))return fail("GROUP_SCOPE_NEEDS_CLARIFICATION");
  const weights=evidence.filter(e=>e.role==="weight"),quotedWeights=values.flatMap(v=>v.weight?[v.weight]:[]);
  if(!inherit&&weights.length&&!quotedWeights.length)return fail("STATED_WEIGHT_OMITTED");
  const uniformWeight=weights.length===1&&/每组|每一组|each set|per set/i.test(text)&&quotedWeights.every(w=>w.value===weights[0].value&&w.unit===weights[0].unit);
  if(quotedWeights.length&&!uniformWeight&&(weights.length!==quotedWeights.length||quotedWeights.some((w,i)=>w.value!==weights[i].value||w.unit!==weights[i].unit)))return fail("WEIGHT_SCOPE_NEEDS_CLARIFICATION");
  if(values.some(v=>v.count&&(!/每组|每一组|一组|each|per set|sets of/i.test(text)||counts.length!==1)))return fail("UNIFORM_COUNT_REQUIRED");
  if(values.reduce((n,v)=>n+(v.count?.value??1),0)>16)return fail("TOO_MANY_SETS");
  const ordinals=evidence.filter(e=>e.role==="ordinal");
  let slot=Math.max(0,...session.sets.filter(s=>s.planExerciseId===exercise.id).map(s=>s.setIndex))+1;
  if(ordinals.length&&(ordinals.length!==1||values.length!==1||ordinals[0].value!==slot))return fail("SET_SLOT_MISMATCH");
  if(source)review.references=[referenceFor(source)];
  for(const v of values)for(let i=0;i<(v.count?.value??1);i++){
    if(v.rpe&&(v.count?.value??1)>1)return fail("RPE_SCOPE_NEEDS_CLARIFICATION");
    const perLoad=source?.perHandLoad??(v.weight&&perHand.test(text)?{value:v.weight.value,unit:v.weight.unit!}:undefined);
    const weightKg=perLoad?null:source?source.weightKg:v.weight?converted(v.weight):null;
    push({id:ids.newId(),sessionId:session.id,planExerciseId:exercise.id,setIndex:slot++,revision:1,status:"done",
      weightKg,reps:v.reps!.value,rpe:v.rpe?.value??null,inputUnit:v.weight?.unit??source?.inputUnit??"kg",
      weightSource:weightKg===null?null:source?"user_confirmed_prefill":"user_said",repsSource:"user_said",sourceRef:ids.id,
      ...(perLoad?{perHandLoad:perLoad}:{})},null);
  }
  if(review.requests.some(r=>r.setIndex>100||r.reps===null||r.reps>100||r.weightKg!==null&&r.weightKg>1000||r.rpe!==null&&(r.rpe<1||r.rpe>10)))return fail("OUT_OF_RANGE");
  return review;
}
