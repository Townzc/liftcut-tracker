// CC0 synthetic application fixtures. These are known development cases, not unseen acceptance.
import type { Context, Plan } from "@liftcut/core/agent-contracts";
export const flows = ["preview", "approve", "no_reply", "decline", "revoke", "context_update", "lost_response", "resume"] as const;
export const bundles: Context[] = [
  { weeklyDays: 1, sessionMinutes: 30, equipment: ["bodyweight"], notes: "Synthetic A; no real health information" },
  { weeklyDays: 2, sessionMinutes: 45, equipment: ["dumbbell"], notes: "Synthetic B; no real health information" },
  { weeklyDays: 3, sessionMinutes: 60, equipment: ["machine"], notes: "Synthetic C; no real health information" },
];
export function draft(i: number): Plan {
  return { plan_name: `P1 fixture ${i + 1}`, goal_type: "maintenance", summary: "Supplied synthetic draft; not medical advice or model output",
    reasoning_summary: "Persistence workflow only", warnings: [], weeks: [{ week_number: 1, focus: "Synthetic",
      days: [{ day_number: 1, title: "Fixture day", notes: "Not a real prescription", estimated_duration_minutes: 20,
        exercises: [{ name: ["Bodyweight squat", "Dumbbell row", "Machine row"][i], sets: 2, rep_range: "8", target_rpe: 6,
          rest_seconds: 90, notes: "Synthetic", alternative_exercises: [] }] }] }] };
}
export const cases = bundles.flatMap((context, i) => flows.map(flow => ({
  id: `p1-${i + 1}-${flow}`, flow, context, plan: draft(i),
  expectedStatus: ["approve", "lost_response", "resume"].includes(flow) ? "applied" :
    flow === "decline" ? "declined" : flow === "revoke" ? "revoked" : "awaiting_approval",
  expectedWrites: ["approve", "lost_response", "resume"].includes(flow) ? 1 : 0,
})));
