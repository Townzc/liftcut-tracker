import "server-only";
import type { PoolClient } from "pg";
import type { PlanKind } from "@liftcut/core/agent-contracts";

// Called inside the owner's advisory-locked transaction. The matching triggers
// also serialize legacy browser writes, including inserts into an empty plan.
export async function readPlanRows(db: PoolClient, owner: string, kind: PlanKind): Promise<Record<string, unknown>[]> {
  const sql = kind === "training" ? `
    select to_jsonb(p) || jsonb_build_object('weeks', coalesce((
      select jsonb_agg(to_jsonb(w) || jsonb_build_object('days', coalesce((
        select jsonb_agg(to_jsonb(d) || jsonb_build_object('exercises', coalesce((
          select jsonb_agg(to_jsonb(e) order by e.id) from public.training_plan_exercises e where e.day_id=d.id
        ), '[]'::jsonb)) order by d.day_number) from public.training_plan_days d where d.week_id=w.id
      ), '[]'::jsonb)) order by w.week_number) from public.training_plan_weeks w where w.training_plan_id=p.id
    ), '[]'::jsonb)) as data from public.training_plans p where p.user_id=$1 and p.is_active order by p.id` : `
    select to_jsonb(p) || jsonb_build_object('days', coalesce((
      select jsonb_agg(to_jsonb(d) || jsonb_build_object('meals', coalesce((
        select jsonb_agg(to_jsonb(m) order by m.id) from public.nutrition_plan_meals m where m.day_id=d.id
      ), '[]'::jsonb)) order by d.day_number) from public.nutrition_plan_days d where d.nutrition_plan_id=p.id
    ), '[]'::jsonb)) as data from public.nutrition_plans p where p.user_id=$1 and p.is_active order by p.id`;
  return (await db.query(sql, [owner])).rows.map(r => r.data);
}

export type PlanSnapshot = {
  kind: PlanKind; stateHash: string; profileHash: string;
  profile: Record<string, unknown>; currentPlans: Record<string, unknown>[];
  draft?: { runId: string; revision: number; plan: import("@liftcut/core/agent-contracts").AnyPlan };
  editable?: { plan: import("@liftcut/core/agent-contracts").AnyPlan; context: import("@liftcut/core/agent-contracts").Context };
  memory?: import("@/lib/agent/plan-personalization").PlanningMemory;
};

/** Models need prescriptions, not owner identifiers or persistence metadata. */
export function modelPlanData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(modelPlanData);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !["id","user_id","training_plan_id","nutrition_plan_id","week_id","day_id","created_at","updated_at","is_active"].includes(key))
    .map(([key,item]) => [key,modelPlanData(item)]));
  return value;
}
