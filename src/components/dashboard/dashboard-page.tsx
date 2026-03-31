"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowRight, Flame, Goal, Salad, TrendingDown } from "lucide-react";

import { SimpleLineChart } from "@/components/charts/simple-line-chart";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  getAverageWeightByDays,
  getCurrentWeekWorkoutSummary,
  getTodayNutritionSummary,
  getTodayPlanInfo,
  getWeightChartData,
  getWeightGoalStatus,
} from "@/lib/metrics";
import { useTrackerStore } from "@/store/use-tracker-store";

function formatRemaining(value: number, unit: string): string {
  if (value > 0) {
    return `Remaining ${value}${unit}`;
  }

  if (value < 0) {
    return `Over by ${Math.abs(value)}${unit}`;
  }

  return "Target reached";
}

export function DashboardPage() {
  const settings = useTrackerStore((state) => state.settings);
  const trainingPlan = useTrackerStore((state) => state.trainingPlan);
  const foodLogs = useTrackerStore((state) => state.foodLogs);
  const workoutLogs = useTrackerStore((state) => state.workoutLogs);
  const bodyMetricLogs = useTrackerStore((state) => state.bodyMetricLogs);

  const nutritionSummary = useMemo(
    () => getTodayNutritionSummary(foodLogs, settings),
    [foodLogs, settings],
  );
  const weekWorkoutSummary = useMemo(
    () => getCurrentWeekWorkoutSummary(workoutLogs, settings.weeklyTrainingDays),
    [settings.weeklyTrainingDays, workoutLogs],
  );
  const weightChartData = useMemo(() => getWeightChartData(bodyMetricLogs, 7), [bodyMetricLogs]);
  const sevenDayAverage = useMemo(() => getAverageWeightByDays(bodyMetricLogs, 7), [bodyMetricLogs]);
  const weightStatus = useMemo(
    () => getWeightGoalStatus(bodyMetricLogs, settings),
    [bodyMetricLogs, settings],
  );
  const todayPlan = useMemo(
    () => getTodayPlanInfo(trainingPlan, settings.weeklyTrainingDays),
    [settings.weeklyTrainingDays, trainingPlan],
  );

  const calorieProgress = Math.min(
    100,
    (nutritionSummary.calories / Math.max(1, settings.calorieTarget)) * 100,
  );
  const proteinProgress = Math.min(
    100,
    (nutritionSummary.protein / Math.max(1, settings.proteinTarget)) * 100,
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-emerald-700">Dashboard</p>
          <h1 className="text-2xl font-semibold text-slate-900">Today at a glance</h1>
        </div>
        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">MVP local mode</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Goal className="h-4 w-4 text-emerald-600" />
              Today plan
            </CardTitle>
            <CardDescription>Auto-suggested from your schedule</CardDescription>
          </CardHeader>
          <CardContent>
            {todayPlan ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-700">
                  Week {todayPlan.weekNumber} / Day {todayPlan.dayNumber}
                </p>
                <p className="text-lg font-semibold text-slate-900">{todayPlan.title}</p>
                <p className="text-sm text-slate-600">{todayPlan.exerciseCount} exercises queued</p>
                <Link
                  href="/workout"
                  className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700"
                >
                  Start logging
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <EmptyState title="No plan found" description="Create or import a plan in the plan page." />
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Salad className="h-4 w-4 text-orange-600" />
              Nutrition today
            </CardTitle>
            <CardDescription>Calories and protein gaps</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Calories</span>
                <span className="font-medium text-slate-900">
                  {nutritionSummary.calories} / {settings.calorieTarget} kcal
                </span>
              </div>
              <Progress value={calorieProgress} />
              <p className="text-xs text-slate-500">
                {formatRemaining(nutritionSummary.remainingCalories, "kcal")}
              </p>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-600">Protein</span>
                <span className="font-medium text-slate-900">
                  {nutritionSummary.protein} / {settings.proteinTarget} g
                </span>
              </div>
              <Progress value={proteinProgress} />
              <p className="text-xs text-slate-500">
                {formatRemaining(nutritionSummary.remainingProtein, "g")}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Flame className="h-4 w-4 text-rose-600" />
              Weekly workout progress
            </CardTitle>
            <CardDescription>Completed / planned sessions</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-2xl font-semibold text-slate-900">
              {weekWorkoutSummary.completedCount}/{weekWorkoutSummary.plannedCount}
            </p>
            <Progress value={weekWorkoutSummary.completionRate} />
            <p className="text-xs text-slate-500">
              Completion {Math.round(weekWorkoutSummary.completionRate)}%
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200/80 bg-white/90 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingDown className="h-4 w-4 text-cyan-700" />
              Last 7 days body weight
            </CardTitle>
            <CardDescription>Used for dynamic 7-day average</CardDescription>
          </CardHeader>
          <CardContent>
            {weightChartData.some((item) => item.weight !== null) ? (
              <SimpleLineChart
                data={weightChartData}
                lines={[{ key: "weight", color: "#0f766e", name: "Weight (kg)" }]}
              />
            ) : (
              <EmptyState title="No weight data" description="Add entries in the body page." />
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/90">
          <CardHeader>
            <CardTitle className="text-base">Weekly status</CardTitle>
            <CardDescription>Weight trend target check</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600">7-day average weight</p>
            <p className="text-2xl font-semibold text-slate-900">
              {sevenDayAverage !== null ? `${sevenDayAverage.toFixed(1)} kg` : "Not enough data"}
            </p>
            <Badge
              className={
                weightStatus.status === "on-track"
                  ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100"
                  : weightStatus.status === "too-fast"
                    ? "bg-amber-100 text-amber-700 hover:bg-amber-100"
                    : weightStatus.status === "too-slow"
                      ? "bg-rose-100 text-rose-700 hover:bg-rose-100"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-100"
              }
            >
              {weightStatus.status === "on-track"
                ? "On track"
                : weightStatus.status === "too-fast"
                  ? "Too fast"
                  : weightStatus.status === "too-slow"
                    ? "Too slow"
                    : "Insufficient data"}
            </Badge>
            <p className="text-sm leading-6 text-slate-600">{weightStatus.message}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}