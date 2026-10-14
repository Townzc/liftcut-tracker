import { z } from "zod";
import { personalEntrySchema, type PersonalEntry } from "./personal-records";
import { parseWorkoutLog, type LogDraft } from "./workout-log-parser";
import { workoutContext } from "./workout-context";
import type { Session } from "./today";

const quote=z.string().trim().min(1).max(120), optionalQuote=quote.nullable();
export const personalExtractionSchema=z.object({
  kind:z.enum(["body","food"]), dateQuote:optionalQuote,
  weightQuote:optionalQuote,waistQuote:optionalQuote,
  foodQuote:optionalQuote,mealQuote:optionalQuote,caloriesQuote:optionalQuote,proteinQuote:optionalQuote,
}).strict();
export const workoutExtractionSchema=z.object({
  exerciseId:z.string().min(1).max(150), kind:z.enum(["record","correct"]),
  weightQuote:optionalQuote,repsQuotes:z.array(quote).min(1).max(16),
  rpeQuote:optionalQuote,rpeScope:z.enum(["last","each"]).nullable(),
  correctionSet:z.union([z.literal("last"),z.number().int().min(1).max(100)]).nullable(),
}).strict();
export class GroundingError extends Error {}
export function requestedReadRange(text:string,anchor:string):{from:string;to:string}|null {
  const v=text.normalize("NFKC").toLowerCase();
  // A short date follow-up narrows the fresh read instead of reusing a model's
  // previous broad range. Comparisons/ranges retain the explicit tool interval.
  if(/对比|相比|比较|之间|到|至|compare|between|\bto\b/.test(v))return null;
  const dates=v.match(/\d{4}-\d{2}-\d{2}/g)??[];
  if(dates.length===1&&z.iso.date().safeParse(dates[0]).success)return {from:dates[0],to:dates[0]};
  const offsets=[[/前天|day before yesterday/,-2],[/昨天|yesterday/,-1],[/今天|今日|\btoday\b/,0]] as const;
  const hits=offsets.filter(([p])=>p.test(v));if(hits.length!==1)return null;
  const d=new Date(anchor+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+hits[0][1]);const date=d.toISOString().slice(0,10);
  return {from:date,to:date};
}
const normalize=(v:string)=>v.normalize("NFKC").trim().toLowerCase();
function fail(reason:string):never {throw new GroundingError(reason);}

/** Small numeric grammar. The model selects literal spans; it never supplies values. */
export function reportedNumber(text:string):number|null {
  const v=normalize(text);
  if(/^\d+(?:\.\d+)?$/.test(v))return Number(v);
  if(!/^[零〇一二两三四五六七八九十百千点]+$/.test(v))return null;
  const digits:Record<string,number>={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  const [whole,decimal,...extra]=v.split("点");if(extra.length || decimal==="")return null;
  let n=0,current=0;
  if(!/[十百千]/.test(whole))n=Number([...whole].map(x=>digits[x]).join(""));
  else {let lastUnit=10000;for(const c of whole){if(c in digits)current=digits[c];else{const unit=({十:10,百:100,千:1000} as Record<string,number>)[c];if(unit>=lastUnit)return null;n+=(current||1)*unit;current=0;lastUnit=unit;}}n+=current;}
  if(decimal){if([...decimal].some(c=>!(c in digits)))return null;n+=Number("0."+[...decimal].map(c=>digits[c]).join(""));}
  return Number.isFinite(n)?n:null;
}
function literal(span:string,texts:string[]) {
  // A follow-up such as "save that" cannot turn an earlier goal/hypothesis into
  // an actual measurement. Validate the message supplying each quoted value too.
  const value=normalize(span),numberChar=/[0-9零〇一二两三四五六七八九十百千点.]/;
  if(!value)fail("QUOTE_NOT_IN_USER_TEXT");
  if(!texts.some(t=>{
    try{assertReport(t);}catch{return false;}
    const text=normalize(t);let at=-1;
    while((at=text.indexOf(value,at+1))>=0){
      // "0 kg" inside "80 kg" and "八" inside "十八" are not reports of 0 or 8.
      if(numberChar.test(value[0])&&(numberChar.test(text[at-1]??"")||/[-−]/.test(text[at-1]??"")))continue;
      if(numberChar.test(value.at(-1)!)&&numberChar.test(text[at+value.length]??""))continue;
      return true;
    }
    return false;
  }))fail("QUOTE_NOT_IN_USER_TEXT");
  return value;
}
const num="[0-9零〇一二两三四五六七八九十百千点.]+";
export function measurement(span:string|null,texts:string[],type:"weight"|"waist"|"calories"|"protein"|"reps"|"rpe"):{value:number;unit:string}|null {
  if(span===null)return null;
  const value=literal(span,texts);
  const units={weight:"kg|公斤|千克|斤|lbs?|磅",waist:"cm|厘米",calories:"kcal|千卡|大卡",protein:"g|克",reps:"次|个|reps?",rpe:""};
  const pattern=type==="rpe"?new RegExp(`^rpe\\s*(${num})$`,"i"):
    new RegExp(`^(${num})\\s*(${units[type]})${type==="reps"?"?":""}$`,"i");
  const match=pattern.exec(value);if(!match)fail("EXPLICIT_NUMBER_AND_UNIT_REQUIRED");
  const n=reportedNumber(match[1]);if(n===null)fail("AMBIGUOUS_NUMBER");
  const unit=match[2]??"";
  const converted=type==="weight"?n*(unit==="斤"?0.5:/^lb|磅/.test(unit)?0.45359237:1):n;
  if(converted<0)fail("OUT_OF_RANGE");
  return {value:Math.round(converted*1e6)/1e6,unit:type==="weight"?"kg":unit};
}
export function groundedDate(span:string|null,texts:string[],anchor:string):string {
  if(span===null)return anchor;
  const s=literal(span,texts);let date:string;
  const relative:Record<string,number>={今天:0,今日:0,今早:0,今早上:0,今晨:0,今天早上:0,今天中午:0,今天晚上:0,今晚:0,刚才:0,today:0,"this morning":0,昨天:-1,昨天早上:-1,昨天中午:-1,昨天晚上:-1,昨晚:-1,yesterday:-1,"yesterday morning":-1,"last night":-1,前天:-2,"the day before yesterday":-2};
  if(s in relative){const d=new Date(anchor+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+relative[s]);date=d.toISOString().slice(0,10);}
  else if(/^\d{4}-\d{2}-\d{2}$/.test(s))date=s;
  else {const m=/^(\d{1,2})月(\d{1,2})[日号]?$/.exec(s);if(!m)fail("DATE_NEEDS_CLARIFICATION");date=`${anchor.slice(0,4)}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`;}
  if(!z.iso.date().safeParse(date).success || date>anchor)fail("DATE_NEEDS_CLARIFICATION");
  return date;
}
function assertReport(text:string) {
  // User confirmation is still mandatory. Explicit hypothetical/negative reports
  // do not become drafts even when a model ignores its instructions.
  if(/不要(?:保存|记|录)|别(?:保存|记|录)|不(?:要|用)(?:记|存)|假如|假设|如果|明天|目标|计划|打算|\b(?:hypothetical|tomorrow|goal|plan)\b|do not (?:save|log)|don't (?:save|log)/i.test(text))fail("NOT_AN_ACTUAL_REPORT");
}
export function groundPersonal(input:unknown,texts:string[],anchor:string):PersonalEntry {
  const p=personalExtractionSchema.parse(input);assertReport(texts.at(-1)??"");
  const date=groundedDate(p.dateQuote,texts,anchor);
  if(p.kind==="body") {
    if([p.foodQuote,p.mealQuote,p.caloriesQuote,p.proteinQuote].some(v=>v!==null))fail("MIXED_ENTRY");
    return personalEntrySchema.parse({kind:"body",date,weightKg:measurement(p.weightQuote,texts,"weight")?.value??null,waistCm:measurement(p.waistQuote,texts,"waist")?.value??null});
  }
  if(p.weightQuote!==null || p.waistQuote!==null || p.foodQuote===null || p.mealQuote===null)fail("MEAL_NEEDS_CLARIFICATION");
  literal(p.foodQuote,texts);const meal=literal(p.mealQuote,texts);
  const meals:Record<string,string>={早餐:"breakfast",早饭:"breakfast",早上:"breakfast",breakfast:"breakfast",午餐:"lunch",午饭:"lunch",中午:"lunch",lunch:"lunch",晚餐:"dinner",晚饭:"dinner",晚上:"dinner",dinner:"dinner",加餐:"snack",零食:"snack",snack:"snack"};
  if(!meals[meal])fail("MEAL_NEEDS_CLARIFICATION");
  return personalEntrySchema.parse({kind:"food",date,foodName:p.foodQuote,mealType:meals[meal],calories:measurement(p.caloriesQuote,texts,"calories")?.value??null,protein:measurement(p.proteinQuote,texts,"protein")?.value??null});
}
export function groundWorkout(input:unknown,texts:string[],session:Session):{normalizedText:string;draft:LogDraft;exerciseId:string} {
  const p=workoutExtractionSchema.parse(input);assertReport(texts.at(-1)??"");
  const exercise=session.prescription.exercises.find(e=>e.id===p.exerciseId);if(!exercise)fail("EXERCISE_NOT_FOUND");
  const reps=p.repsQuotes.map(q=>measurement(q,texts,"reps")!.value);
  if(reps.some(n=>!Number.isInteger(n)||n>100))fail("OUT_OF_RANGE");
  const weight=measurement(p.weightQuote,texts,"weight"),rpe=measurement(p.rpeQuote,texts,"rpe");
  if(rpe&&(rpe.value<1||rpe.value>10))fail("OUT_OF_RANGE");
  let normalizedText:string;
  if(p.kind==="correct"){
    if(reps.length!==1 || p.correctionSet===null || weight || rpe)fail("CORRECTION_NEEDS_CLARIFICATION");
    normalizedText=`更正 ${exercise.name} ${p.correctionSet==="last"?"最后一组":`第 ${p.correctionSet} 组`} ${reps[0]} 次`;
  }else{
    if(p.correctionSet!==null)fail("AMBIGUOUS_SET");
    if(rpe&&reps.length>1&&!p.rpeScope)fail("RPE_SCOPE_REQUIRED");
    normalizedText=`记录 ${exercise.name} ${weight?`${weight.value} kg `:""}${reps.join("、")} 次${rpe?`，${p.rpeScope==="each"?"每组":"最后一组"} RPE ${rpe.value}`:""}`;
  }
  const parsed=parseWorkoutLog(normalizedText,workoutContext(session,p.exerciseId));
  if(parsed.status!=="draft")fail(parsed.reason);
  return {normalizedText,draft:parsed.draft,exerciseId:p.exerciseId};
}
