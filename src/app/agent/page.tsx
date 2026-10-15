import { TodayPage } from "@/components/today/today-page";
import { todayEnabled } from "@/services/today/database";
import { coachStatus } from "@/services/ai/coach-agent";

export const dynamic = "force-dynamic";
export default function Page() { return <TodayPage enabled={todayEnabled()} conversation initialStatus={coachStatus()}/>; }
