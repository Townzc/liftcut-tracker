import "server-only";
import type {PoolClient} from "pg";
import {z} from "zod";
import type {PlanKind} from "@/lib/agent/contracts";
import type {PlanningMemory} from "@/lib/agent/plan-personalization";

// Actual, owner-scoped sources only. Both query memory and plan memory share
// these exclusions; prescriptions and settings never become measurements.
export const fitnessFactsSql = `
  select e.id::text as id,e.id::text as record_id,e.request->'entry' as entry,e.created_at,e.request->>'source' as source
  from public.personal_record_events e where e.user_id=$1 and e.parent_id is null
  and not exists(select 1 from public.personal_record_events u where u.parent_id=e.id)
  union all select 'legacy:'||id,null,jsonb_build_object('kind','body','date',date,'weightKg',weight,'waistCm',waist),created_at,'manual'
  from public.body_metric_logs where user_id=$1
  union all select 'set:'||l.id,null,jsonb_build_object('kind','exercise','date',s.local_date,'exerciseName',l.exercise_name,'weightKg',l.weight_kg,'reps',l.reps,'sets',1,'rpe',l.rpe),l.created_at,'workout'
  from public.set_logs l join public.workout_sessions s on s.id=l.session_id where s.user_id=$1 and s.status<>'cancelled' and l.status='done'
  union all select 'legacy-set:'||e.id,null,jsonb_build_object('kind','exercise','date',w.date,'exerciseName',e.name,'weightKg',e.actual_weight,'reps',e.actual_reps,'sets',null,'rpe',e.actual_rpe),w.created_at,'workout'
  from public.workout_log_exercises e join public.workout_logs w on w.id=e.workout_log_id where w.user_id=$1 and e.completed
`;

// Runs under the plan owner's transaction lock. One bounded query includes
// the latest facts and up to three actual reports per selected exercise.
export async function readPlanningMemory(db:PoolClient,owner:string,kind:PlanKind,anchorDate:string,timezone:string):Promise<PlanningMemory>{
  z.uuid().parse(owner);z.iso.date().parse(anchorDate);
  const limit=kind==="training"?20:6;
  const {rows}=await db.query(`with facts as (${fitnessFactsSql}), expanded as (
    select f.*,m.metric,m.value,m.unit from facts f cross join lateral (values
      (case when entry->>'kind'='body' then 'weight' end,entry->'weightKg','kg'),
      (case when entry->>'kind'='body' then 'waist' end,entry->'waistCm','cm'),
      (case when entry->>'kind'='exercise' then 'exercise:'||lower(regexp_replace(trim(entry->>'exerciseName'),'\\s+',' ','g')) end,entry->'weightKg','kg'),
      (case when entry->>'kind'='preference' then 'preference:'||(entry->>'key') end,entry->'value',null)
    ) m(metric,value,unit) where m.metric is not null and m.value is not null and m.value<>'null'::jsonb and entry->>'date'<=$2
  ), ranked as (
    select *,row_number() over(partition by metric order by entry->>'date' desc,created_at desc,id) as recency,
      jsonb_build_object('id',id,'recordId',record_id,'date',entry->>'date','createdAt',created_at,'metric',metric,'value',value,'unit',unit,'source',source,
      'exerciseName',entry->>'exerciseName','reps',entry->'reps','sets',entry->'sets','rpe',entry->'rpe') as data from expanded
  ), latest as (
    select *,row_number() over(partition by metric like 'exercise:%' order by entry->>'date' desc,created_at desc,metric) as position from ranked where recency=1
  ), selected as (select * from latest where metric not like 'exercise:%' or position<=$3)
  select coalesce((select jsonb_agg(data order by metric) from selected),'[]'::jsonb) as facts,
    coalesce((select jsonb_agg(r.data order by r.metric,r.recency) from ranked r join selected s using(metric)
      where r.metric like 'exercise:%' and r.recency<=3),'[]'::jsonb) as recent_loads,
    exists(select 1 from latest where metric like 'exercise:%' and position>$3) as truncated`,[owner,anchorDate,limit]);
  return {version:1,kind,anchorDate,timezone,facts:rows[0].facts,recentLoads:rows[0].recent_loads,truncated:rows[0].truncated};
}
