"use client";

import { useMemo } from "react";
import { TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SimpleLineChart } from "@/components/charts/simple-line-chart";
import { getExerciseProgressData } from "@/lib/pr-tracker";
import { useTrackerStore } from "@/store/use-tracker-store";

export function ExerciseProgress({ exerciseName }: { exerciseName: string }) {
  const workoutLogs = useTrackerStore((state) => state.workoutLogs);

  const progressData = useMemo(
    () => getExerciseProgressData(workoutLogs, exerciseName),
    [workoutLogs, exerciseName],
  );

  if (progressData.length === 0) {
    return null;
  }

  return (
    <Card className="border-slate-200/80 bg-white/90 dark:border-slate-700/50 dark:bg-slate-800/90">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          {exerciseName}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <SimpleLineChart
          data={progressData as unknown as Array<Record<string, number | string | null>>}
          lines={[
            {
              key: "estimated1RM",
              color: "#0f766e",
              name: "Est. 1RM (kg)",
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}
