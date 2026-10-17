import "server-only";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import type { CoachSource } from "@/lib/coach-model";
import { CoachTimer } from "@/lib/coach-timing";
import { beginOwnerTransaction } from "@/services/owner-transaction";
import {memorySource,memoryExerciseKey,type MemoryFact} from "@/lib/fitness-memory";
import {fitnessFactsSql} from "./fitness-facts";

export const recordTopicSchema=z.enum(["body","food","workout","plan","nutrition","profile"]);
export const readRecordsSchema=z.object({topic:recordTopicSchema,from:z.iso.date(),to:z.iso.date()}).strict();
export class CoachReadError extends Error {}
export class CoachStore {
  constructor(private readonly pool:Pool,private readonly timer=new CoachTimer()){}
  private async tx<T>(owner:string,operation:string,work:(db:PoolClient)=>Promise<T>):Promise<T>{
    z.uuid().parse(owner);const db=await this.timer.db(`${operation}.connect`,()=>this.pool.connect());let broken=false;
    try{
      await this.timer.db(`${operation}.setup`,()=>beginOwnerTransaction(db,owner,"liftcut_workout"));
      const result=await this.timer.db(`${operation}.query`,()=>work(db));await this.timer.db(`${operation}.commit`,()=>db.query("commit"));return result;
    }catch(e){await db.query("rollback").catch(()=>{broken=true;});throw e;}finally{db.release(broken);}
  }
  async reserve(owner:string,id:string){
    z.uuid().parse(id);
    return this.tx(owner,"quota",async db=>{
      const value=(await db.query("select public.reserve_coach_request($1) as value",[id])).rows[0].value;
      if(value.error)throw new CoachReadError(z.enum(["RATE_LIMITED","REQUEST_ALREADY_USED"]).parse(value.error));
      this.timer.quota(z.object({lockMs:z.number().nonnegative(),checkMs:z.number().nonnegative(),insertMs:z.number().nonnegative()}).parse(value));
    });
  }
  async memory(owner:string,anchor:string,exercise?:string):Promise<CoachSource>{
    z.iso.date().parse(anchor);if(exercise)z.string().min(1).max(80).parse(exercise);
    return this.tx(owner,"memory",async db=>{
      const rows=(await db.query(`with facts as (${fitnessFactsSql}), expanded as (
        select f.*,m.metric,m.value,m.unit from facts f cross join lateral (values
          (case when entry->>'kind'='body' then 'weight' end,entry->'weightKg','kg'),
          (case when entry->>'kind'='body' then 'waist' end,entry->'waistCm','cm'),
          (case when entry->>'kind'='exercise' then 'exercise:'||lower(regexp_replace(trim(entry->>'exerciseName'),'\\s+',' ','g')) end,entry->'weightKg','kg'),
          (case when entry->>'kind'='preference' then 'preference:'||(entry->>'key') end,entry->'value',null)
        ) m(metric,value,unit) where m.metric is not null and m.value is not null and m.value<>'null'::jsonb
        and entry->>'date'<=$2 and ($3::text is null or m.metric='exercise:'||$3)
      ) select * from (select distinct on(metric) jsonb_build_object('id',id,'recordId',record_id,'date',entry->>'date',
        'createdAt',created_at,'metric',metric,'value',value,'unit',unit,'source',source,'exerciseName',entry->>'exerciseName',
        'reps',entry->'reps','sets',entry->'sets','rpe',entry->'rpe') as data,metric
        from expanded order by metric,entry->>'date' desc,created_at desc,id) latest order by case when metric like 'exercise:%' then 1 else 0 end,metric limit 101`,[owner,anchor,exercise?memoryExerciseKey(exercise):null])).rows.map(r=>r.data as MemoryFact);
      return memorySource(rows.slice(0,100),anchor,rows.length>100);
    });
  }
  async read(owner:string,input:unknown,anchor:string):Promise<CoachSource>{
    const r=readRecordsSchema.parse(input),span=(Date.parse(r.to)-Date.parse(r.from))/86400000;
    if(span<0||span>92||r.to>anchor)throw new CoachReadError("DATE_RANGE_INVALID");
    return this.tx(owner,r.topic,async db=>{
      let rows:Record<string,unknown>[]=[];
      if(r.topic==="body"||r.topic==="food"){
        const kind=r.topic;
        const legacy=kind==="body"?`select 'legacy:'||id as id,date,created_at,
          jsonb_build_object('id','legacy:'||id,'date',date,'weightKg',weight,'waistCm',waist,'legacy',true) as data
          from public.body_metric_logs where user_id=$1 and date between $2::date and $3::date`:
          `select 'legacy:'||id as id,date,created_at,
          jsonb_build_object('id','legacy:'||id,'date',date,'foodName',food_name,'mealType',meal_type,'calories',calories,'protein',protein,'legacy',true) as data
          from public.food_logs where user_id=$1 and date between $2::date and $3::date`;
        rows=(await db.query(`select data from (
          ${legacy} union all select e.id::text,(e.request->'entry'->>'date')::date,e.created_at,
          (e.request->'entry')||jsonb_build_object('id',e.id,'legacy',false) as data
          from public.personal_record_events e where e.user_id=$1 and e.parent_id is null
          and e.request->'entry'->>'kind'=$4 and (e.request->'entry'->>'date')::date between $2::date and $3::date
          and not exists(select 1 from public.personal_record_events u where u.parent_id=e.id)
        ) all_records order by date desc,created_at desc,id limit 201`,[owner,r.from,r.to,kind])).rows.map(x=>x.data);
      }else if(r.topic==="workout"){
        rows=(await db.query(`select data from (
          select s.local_date as date,s.started_at as at,s.id::text as id,jsonb_build_object('id',s.id,'date',s.local_date,
            'status',s.status,'legacy',false,'actualSets',coalesce((select jsonb_agg(jsonb_build_object('exercise',l.exercise_name,
              'setIndex',l.set_index,'reps',l.reps,'weightKg',l.weight_kg,'rpe',l.rpe) order by l.plan_exercise_id,l.set_index)
              from public.set_logs l where l.session_id=s.id and l.status='done'),'[]'::jsonb)) as data
          from public.workout_sessions s where s.user_id=$1 and s.local_date between $2::date and $3::date and s.status<>'cancelled'
          union all select w.date,w.created_at,w.id,jsonb_build_object('id',w.id,'date',w.date,'status',case when w.completed then 'ended' else 'active' end,
            'legacy',true,'actualSets',coalesce((select jsonb_agg(jsonb_build_object('exercise',e.name,'reps',e.actual_reps,
              'weightKg',e.actual_weight,'rpe',e.actual_rpe)) from public.workout_log_exercises e where e.workout_log_id=w.id and e.completed),'[]'::jsonb))
          from public.workout_logs w where w.user_id=$1 and w.date between $2::date and $3::date
          union all select (e.request->'entry'->>'date')::date,e.created_at,e.id::text,
            jsonb_build_object('id',e.id,'date',e.request->'entry'->>'date','status','reported','legacy',false,'actualSets',
              jsonb_build_array((e.request->'entry')||jsonb_build_object('exercise',e.request->'entry'->>'exerciseName')))
          from public.personal_record_events e where e.user_id=$1 and e.parent_id is null and e.request->'entry'->>'kind'='exercise'
            and (e.request->'entry'->>'date')::date between $2::date and $3::date
            and not exists(select 1 from public.personal_record_events u where u.parent_id=e.id)
        ) workouts order by date desc,at desc,id limit 201`,[owner,r.from,r.to])).rows.map(x=>x.data);
      }else if(r.topic==="plan"){
        rows=(await db.query(`select jsonb_build_object('plan',p.name,'week',w.week_number,'day',d.day_number,'title',d.title,
          'exercise',e.name,'targetSets',e.sets,'targetReps',e.rep_range,'targetRpe',e.target_rpe,'actual',false) as data
          from public.training_plans p join public.training_plan_weeks w on w.training_plan_id=p.id
          join public.training_plan_days d on d.week_id=w.id join public.training_plan_exercises e on e.day_id=d.id
          where p.user_id=$1 and p.is_active order by w.week_number,d.day_number,e.id limit 201`,[owner])).rows.map(x=>x.data);
      }else if(r.topic==="nutrition"){
        rows=(await db.query(`select jsonb_build_object('plan',p.name,'calorieTarget',p.daily_calorie_target,
          'proteinTarget',p.protein_target,'day',d.day_number,'mealType',m.meal_type,'title',m.title,'foods',m.foods_json,'actual',false) as data
          from public.nutrition_plans p left join public.nutrition_plan_days d on d.nutrition_plan_id=p.id
          left join public.nutrition_plan_meals m on m.day_id=d.id where p.user_id=$1 and p.is_active order by p.id,d.day_number,m.id limit 201`,[owner])).rows.map(x=>x.data);
      }else{
        rows=(await db.query(`select jsonb_build_object('fitnessGoal',fitness_goal,'experience',training_experience,
          'equipment',available_equipment,'sessionMinutes',nullif(session_duration_minutes,0),'weeklyTrainingDays',nullif(weekly_training_days,0),
          'targetWeightKg',nullif(target_weight,0),'calorieTarget',nullif(calorie_target,0),'proteinTarget',nullif(protein_target,0),
          'actual',false) as data from public.user_settings where user_id=$1`,[owner])).rows.map(x=>x.data);
      }
      const truncated=rows.length>200;rows=rows.slice(0,200);
      const summary:Record<string,unknown>={recordCount:rows.length,complete:!truncated};
      if(r.topic==="food"){
        for(const key of ["calories","protein"]){const known=rows.map(x=>x[key]).filter((x):x is number=>typeof x==="number");summary[key]=known.length?Number(known.reduce((a,b)=>a+b,0).toFixed(2)):null;summary[key+"Missing"]=rows.length-known.length;}
        summary.scope="Recorded subtotal only; not full intake";
      }
      if(r.topic==="body"){
        const weights=rows.filter(x=>typeof x.weightKg==="number");summary.latestWeightKg=weights[0]?.weightKg??null;
        summary.weightChangeKg=weights.length>1?Number(((weights[0].weightKg as number)-(weights.at(-1)!.weightKg as number)).toFixed(3)):null;
        summary.changeScope="Latest minus earliest reported weight in this date range";
      }
      if(r.topic==="workout")summary.completedSessions=rows.filter(x=>x.status==="ended"&&Array.isArray(x.actualSets)&&x.actualSets.length>0).length;
      return {id:`${r.topic}:${r.from}:${r.to}`,topic:r.topic,from:r.from,to:r.to,readAt:new Date().toISOString(),rows,summary,truncated};
    });
  }
}
