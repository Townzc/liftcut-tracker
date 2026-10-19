import {z} from "zod";
import {aiTrainingDaySchema,aiTrainingPlanSchema} from "@liftcut/core/ai-schemas";
import {contextSchema,planSchema,validatePlanConstraints,type Plan} from "@liftcut/core/agent-contracts";

// Model transport only. The approval ledger always receives the fully expanded,
// validated plan; it never stores references that could change after approval.
export const trainingProgramSchema=z.object({
  context:contextSchema,
  program:aiTrainingPlanSchema.omit({weeks:true}).extend({
    total_weeks:z.number().int().min(1).max(16),
    workouts:z.array(aiTrainingDaySchema.omit({day_number:true}).extend({
      key:z.string().regex(/^[A-Za-z0-9_-]{1,16}$/),
    }).strict()).min(1).max(7),
    phases:z.array(z.object({
      from_week:z.number().int().min(1).max(16),
      to_week:z.number().int().min(1).max(16),
      focus:z.string().trim().min(1).max(200),
      workout_keys:z.array(z.string().max(16)).min(1).max(7),
      // Explicit model choices, never heuristic progression or recorded results.
      sets_delta:z.number().int().min(-3).max(3),
      rpe_delta:z.number().min(-3).max(3),
      notes:z.string().max(500),
    }).strict()).min(1).max(16),
  }).strict(),
}).strict();

export function expandTrainingProgram(input:unknown):{context:z.infer<typeof contextSchema>;plan:Plan}{
  const {context,program}=trainingProgramSchema.parse(input);
  const {workouts,phases,total_weeks,...metadata}=program;
  const templates=new Map(workouts.map(w=>[w.key,w]));
  if(templates.size!==workouts.length)throw new Error("DUPLICATE_WORKOUT_KEY");
  const weeks:Plan["weeks"]=[],used=new Set<string>();
  for(const phase of phases){
    if(phase.from_week!==weeks.length+1||phase.to_week<phase.from_week||phase.to_week>total_weeks)
      throw new Error("NONCONTIGUOUS_PROGRAM");
    if(phase.workout_keys.length!==context.weeklyDays)throw new Error("WEEKLY_DAYS_MISMATCH");
    for(let n=phase.from_week;n<=phase.to_week;n++){
      const days=phase.workout_keys.map((key,i)=>{
        const workout=templates.get(key);if(!workout)throw new Error("UNKNOWN_WORKOUT_KEY");used.add(key);
        const {key:_key,...day}=structuredClone(workout);void _key;
        return {...day,day_number:i+1,notes:[day.notes,phase.notes].filter(Boolean).join("\n"),
          exercises:day.exercises.map(e=>({...e,sets:e.sets+phase.sets_delta,target_rpe:e.target_rpe+phase.rpe_delta}))};
      });
      weeks.push({week_number:n,focus:phase.focus,days});
    }
  }
  if(weeks.length!==total_weeks||used.size!==templates.size)throw new Error("INCOMPLETE_PROGRAM");
  const plan=planSchema.parse({...metadata,weeks});
  if(validatePlanConstraints(plan,context).length)throw new Error("CONSTRAINT_VIOLATION");
  return {context,plan};
}
