import type {PersonalRecord} from "./personal-records";
import type {CoachSource} from "./coach-model";
export type MemoryFact={id:string;recordId:string|null;date:string;createdAt:string;metric:string;value:string|number;unit:string|null;source:string;
  exerciseName?:string;reps?:number|null;sets?:number|null;rpe?:number|null};
export const memoryExerciseKey=(name:string)=>name.normalize("NFKC").trim().toLowerCase().replace(/\s+/g," ");
export function memoryFacts(records:PersonalRecord[]):MemoryFact[]{
  const facts:MemoryFact[]=[];
  for(const r of records.filter(r=>!r.undo)){
    const e=r.entry,base={id:r.id,recordId:r.id,date:e.date,createdAt:r.createdAt,source:r.source};
    if(e.kind==="body"){
      if(e.weightKg!==null)facts.push({...base,metric:"weight",value:e.weightKg,unit:"kg"});
      if(e.waistCm!==null)facts.push({...base,metric:"waist",value:e.waistCm,unit:"cm"});
    }else if(e.kind==="exercise"&&e.weightKg!==null)facts.push({...base,metric:`exercise:${memoryExerciseKey(e.exerciseName)}`,value:e.weightKg,unit:"kg",exerciseName:e.exerciseName,reps:e.reps,sets:e.sets,rpe:e.rpe});
    else if(e.kind==="preference")facts.push({...base,metric:`preference:${e.key}`,value:e.value,unit:null});
  }
  return latestMemory(facts);
}
export function latestMemory(facts:MemoryFact[],exercise?:string){
  const sorted=[...facts].filter(f=>!exercise||f.exerciseName&&memoryExerciseKey(f.exerciseName)===memoryExerciseKey(exercise))
    .sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
  return [...new Map(sorted.map(f=>f.metric).map(key=>[key,sorted.find(f=>f.metric===key)!])).values()];
}
export function memorySource(facts:MemoryFact[],anchor:string,truncated=false):CoachSource{
  const rows=[...facts].sort((a,b)=>Number(a.metric.startsWith("exercise:"))-Number(b.metric.startsWith("exercise:"))||a.metric.localeCompare(b.metric)).slice(0,100);
  truncated=truncated||facts.length>100;
  return {id:"memory:latest",topic:"memory",from:rows.reduce((min,r)=>r.date<min?r.date:min,anchor),to:anchor,readAt:new Date().toISOString(),rows,
    summary:{recordCount:rows.length,complete:!truncated,scope:"Latest confirmed value per metric/exercise/preference with its ACTUAL date. Not today's measurement, not personal bests, and not a historical date-range query. Omitted metrics are unknown. If truncated, request the specific exercise. Preferences are user statements, not diagnoses."},truncated};
}
export function initialMemoryQuery(text:string){return /记住|记忆|最新(?:的)?(?:体重|腰围)|上次.*(?:重量|公斤|kg)|最近一次|what.*remember|latest.*(?:weight|waist)|last.*(?:lift|load)/i.test(text)&&!/(?:记录|保存|记住我|记一下|remember (?:my|that|I))/i.test(text);}
export function readGuestRecords(records:PersonalRecord[],r:{topic:string;from:string;to:string},anchor:string):CoachSource{
  const span=(Date.parse(r.to)-Date.parse(r.from))/86400000;if(span<0||span>92||r.to>anchor)throw new Error("DATE_RANGE_INVALID");
  if(!["body","food","workout"].includes(r.topic))throw new Error("GUEST_TOPIC_UNAVAILABLE");
  const matches=records.filter(x=>!x.undo&&x.entry.date>=r.from&&x.entry.date<=r.to&&x.entry.kind===(r.topic==="workout"?"exercise":r.topic))
    .sort((a,b)=>b.entry.date.localeCompare(a.entry.date)||b.createdAt.localeCompare(a.createdAt));
  const rows:Record<string,unknown>[]=matches.slice(0,200).map(x=>x.entry.kind==="exercise"?{id:x.id,date:x.entry.date,status:"reported",actualSets:[{exercise:x.entry.exerciseName,weightKg:x.entry.weightKg,reps:x.entry.reps,sets:x.entry.sets,rpe:x.entry.rpe}]}:{...x.entry,id:x.id});
  const summary:Record<string,unknown>={recordCount:rows.length,complete:matches.length<=200,scope:"Confirmed guest records stored on this browser only. Standalone exercise reports do not establish completed sessions."};
  if(r.topic==="food")for(const key of ["calories","protein"]){const values=rows.map(r=>r[key]).filter((x):x is number=>typeof x==="number");summary[key]=values.length?values.reduce((a,b)=>a+b,0):null;summary[key+"Missing"]=rows.length-values.length;}
  return {id:`${r.topic}:${r.from}:${r.to}`,topic:r.topic,from:r.from,to:r.to,rows,summary,truncated:matches.length>200,readAt:new Date().toISOString()};
}
