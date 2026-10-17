import { TodayPage } from "@/components/today/today-page";
import { todayEnabled } from "@/services/today/database";

export const dynamic = "force-dynamic";
export default function Page() { return <TodayPage enabled={todayEnabled()} />; }
