"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Trophy } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getRecentPRs } from "@/lib/pr-tracker";
import { formatDisplayDate } from "@/lib/date";
import { useTrackerStore } from "@/store/use-tracker-store";

function getTypeLabel(
  type: "weight" | "reps" | "1rm",
  t: ReturnType<typeof useTranslations>,
): string {
  switch (type) {
    case "weight":
      return t("prWeight");
    case "reps":
      return t("prReps");
    case "1rm":
      return t("pr1RM");
  }
}

function formatValue(type: "weight" | "reps" | "1rm", value: number): string {
  switch (type) {
    case "weight":
      return `${value} kg`;
    case "reps":
      return `${value} reps`;
    case "1rm":
      return `${value} kg`;
  }
}

export function PRHighlights() {
  const t = useTranslations("dashboard");
  const workoutLogs = useTrackerStore((state) => state.workoutLogs);

  const recentPRs = useMemo(() => getRecentPRs(workoutLogs, 3), [workoutLogs]);

  return (
    <Card className="border-slate-200/80 bg-white/90 dark:border-slate-700/50 dark:bg-slate-800/90">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          {t("prHighlightsTitle")}
        </CardTitle>
        <CardDescription>{t("prHighlightsDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {recentPRs.length > 0 ? (
          <div className="space-y-3">
            {recentPRs.map((pr, index) => (
              <div
                key={`${pr.exerciseName}-${pr.type}-${pr.date}-${index}`}
                className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-800/50"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {pr.exerciseName}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/30">
                      {t("prNew")}
                    </Badge>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {getTypeLabel(pr.type, t)}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-emerald-700 dark:text-emerald-400">
                    {formatValue(pr.type, pr.value)}
                  </p>
                  {pr.previousValue !== null && (
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      prev: {formatValue(pr.type, pr.previousValue)}
                    </p>
                  )}
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {formatDisplayDate(pr.date)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/80 p-4 text-center dark:border-slate-600 dark:bg-slate-800/50">
            <Trophy className="mb-2 h-4 w-4 text-slate-400 dark:text-slate-500" />
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {t("prNoData")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
