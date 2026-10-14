import { z } from "zod";
import { aiTrainingPlanSchema, aiNutritionPlanSchema } from "@/lib/ai/schemas";

// P1 is an application transaction adapter. It does not claim to be candidate D.
export const P1_VERSION = "p1-app-v1";
export const contextSchema = z.object({
  weeklyDays: z.number().int().min(1).max(7),
  sessionMinutes: z.number().int().min(15).max(180),
  equipment: z.array(z.string().trim().min(1).max(80)).max(40),
  notes: z.string().max(1000),
}).strict();

export const planSchema = aiTrainingPlanSchema.superRefine((plan, ctx) => {
  if (new Set(plan.weeks.map(w => w.week_number)).size !== plan.weeks.length)
    ctx.addIssue({ code: "custom", message: "Duplicate week number" });
  for (const week of plan.weeks) {
    if (new Set(week.days.map(d => d.day_number)).size !== week.days.length)
      ctx.addIssue({ code: "custom", message: "Duplicate day number" });
  }
});
export const nutritionPlanSchema = aiNutritionPlanSchema.superRefine((plan, ctx) => {
  if (new Set(plan.days.map(d => d.day_number)).size !== plan.days.length)
    ctx.addIssue({ code: "custom", message: "Duplicate day number" });
  for (const day of plan.days) {
    if (new Set(day.meals.map(m => m.meal_type)).size !== day.meals.length)
      ctx.addIssue({ code: "custom", message: "Duplicate meal type" });
  }
});
export const planKindSchema = z.enum(["training", "nutrition"]);
export type PlanKind = z.infer<typeof planKindSchema>;
export type NutritionPlan = z.infer<typeof nutritionPlanSchema>;
export type AnyPlan = Plan | NutritionPlan;
export const isNutritionPlan = (plan: AnyPlan): plan is NutritionPlan => "daily_targets" in plan;

export const createRunSchema = z.object({
  requestKey: z.uuid(), context: contextSchema,
}).strict();
export const revisionSchema = z.number().int().nonnegative().max(2147483647);
export const bindingSchema = z.object({
  proposalId: z.uuid(), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  contextRevision: revisionSchema,
}).strict();
export const proposalRequestSchema = z.object({
  expectedRevision: revisionSchema, plan: z.union([planSchema, nutritionPlanSchema]),
}).strict();
export const userEventSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("context"), expectedRevision: revisionSchema, context: contextSchema }).strict(),
  z.object({ action: z.enum(["approve", "revoke", "decline"]), expectedRevision: revisionSchema, binding: bindingSchema }).strict(),
]);
export const executeSchema = z.object({
  binding: bindingSchema, approvalId: z.uuid(), idempotencyKey: z.uuid(),
}).strict();

export type Plan = z.infer<typeof planSchema>;
export type Context = z.infer<typeof contextSchema>;
export type Binding = z.infer<typeof bindingSchema>;
export type Execution = z.infer<typeof executeSchema>;
export type UserEvent = z.infer<typeof userEventSchema>;
export type RunStatus = "planning" | "awaiting_approval" | "approved" | "revoked" | "declined" | "applied" | "stale" | "budget_exhausted";
export type Receipt = { id: string; runId: string; proposalId: string; contentHash: string; approvalId: string; contextRevision: number; planId: string; committedAt: string; kind?: PlanKind; appliedStateHash?: string };
export type RunView = {
  id: string; version: string; status: RunStatus; revision: number; contextRevision: number;
  kind: PlanKind; baseline: Record<string, unknown>[];
  context: Context; attempts: number; approvalId: string | null;
  proposal: (Binding & { version: number; plan: AnyPlan }) | null;
  receipt: Receipt | null;
  events: { sequence: string; type: string; actor: string; data: unknown; at: string }[];
};
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string; retryable?: boolean };

// Constraint feedback is computed solely from submitted content and public constraints.
// Equipment/clinical suitability is deliberately NOT inferred from free-text names.
export function validatePlanConstraints(plan: Plan, context: Context): string[] {
  return plan.weeks.flatMap(week => [
    ...(week.days.length > context.weeklyDays ? [`week ${week.week_number}: days exceed ${context.weeklyDays}`] : []),
    ...week.days.filter(day => day.estimated_duration_minutes > context.sessionMinutes)
      .map(day => `week ${week.week_number} day ${day.day_number}: duration exceeds ${context.sessionMinutes} minutes`),
  ]);
}
