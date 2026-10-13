import { AiPlanPage } from "@/components/plan/ai-plan-page";

export default function AiPlanRoutePage() {
  return <AiPlanPage approvalEnabled={Boolean(process.env.AGENT_DATABASE_URL)} />;
}
