import { AgentApproval } from "@/components/plan/agent-approval";
import Link from "next/link";

export default function PlanReviewPage() {
  if (!process.env.AGENT_DATABASE_URL) {
    return <main className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">计划预览审批尚未开放</h1>
      <p>你可以继续使用训练计划页面。</p>
      <Link href="/plan/ai" className="underline">返回训练计划</Link>
    </main>;
  }
  return <AgentApproval />;
}
