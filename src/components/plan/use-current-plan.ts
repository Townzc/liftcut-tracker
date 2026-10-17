"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { currentPlanProgress } from "@/lib/current-plan";
import { useTrackerStore } from "@/store/use-tracker-store";

export function useCurrentPlan() {
  const { user, authMode } = useAuth();
  const plan = useTrackerStore(state => state.trainingPlan);
  const logs = useTrackerStore(state => state.workoutLogs);
  const loading = useTrackerStore(state => state.loading);
  const error = useTrackerStore(state => state.error);
  const refresh = useTrackerStore(state => state.refreshUserData);
  const [now, setNow] = useState(() => new Date());
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  useEffect(() => {
    const update = () => setNow(new Date());
    const timer = window.setInterval(update, 60000);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, []);
  const progress = useMemo(() => currentPlanProgress(plan, logs, now, timezone), [plan, logs, now, timezone]);
  const ownsPlan = authMode === "guest" || (authMode === "authenticated" && plan.userId === user?.id);
  return { plan, progress, loading, error, refresh, hasPlan: ownsPlan && plan.isActive && progress.days.length > 0,
    owner: authMode === "authenticated" ? user?.id : undefined };
}
