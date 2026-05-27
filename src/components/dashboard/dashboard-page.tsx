"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { ArrowRight, CalendarCheck, Flame, Goal, Salad, Sparkles, TrendingDown, Weight } from "lucide-react";

import { useAuth } from "@/components/auth/auth-provider";
import { UserAvatar } from "@/components/shared/user-avatar";
import { SimpleLineChart } from "@/components/charts/simple-line-chart";
import { EmptyState } from "@/components/shared/empty-state";
import { PRHighlights } from "@/components/dashboard/pr-highlights";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
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
import { isBasicProfileComplete, toBasicProfileFieldsFromSettings } from "@/lib/profile-completion";
import { useTrackerStore } from "@/store/use-tracker-store";
import { cn } from "@/lib/utils";

function formatRemaining(
  value: number,
  unit: string,
  t: ReturnType<typeof useTranslations>,
): string {
  if (value > 0) {
    return t("remaining", { value, unit });
  }

  if (value < 0) {
    return t("overBy", { value: Math.abs(value), unit });
  }

  return t("reached");
}

export function DashboardPage() {
  const t = useTranslations("dashboard");
  const tNav = useTranslations("nav");
  const { authMode, profile, user } = useAuth();

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
  const latestWorkout = useMemo(() => workoutLogs[0] ?? null, [workoutLogs]);
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
  const email = profile?.email || user?.email || "";
  const displayName = profile?.displayName || email.split("@")[0] || t("defaultName");
  const basicProfileComplete = useMemo(
    () => isBasicProfileComplete(toBasicProfileFieldsFromSettings(settings)),
    [settings],
  );
  const hasNutritionTargets = settings.calorieTarget > 0 && settings.proteinTarget > 0;
  const hasWeeklyTrainingDays = settings.weeklyTrainingDays > 0;
  const hasWeightLossTarget = settings.targetWeeklyLossMin > 0 || settings.targetWeeklyLossMax > 0;

  const calorieProgress = Math.min(
    100,
    (nutritionSummary.calories / Math.max(1, settings.calorieTarget)) * 100,
  );
  const proteinProgress = Math.min(
    100,
    (nutritionSummary.protein / Math.max(1, settings.proteinTarget)) * 100,
  );

  const weeklyLossText =
    weightStatus.weeklyLoss !== null ? Math.abs(weightStatus.weeklyLoss).toFixed(2) : "0";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-emerald-700 dark:text-emerald-400">{tNav("dashboard")}</p>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t("title")}</h1>
        </div>
        <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/30">{t("badge")}</Badge>
      </div>

      <Card className="border-slate-200/80 bg-white/90 dark:border-slate-700/50 dark:bg-slate-800/90">
        <CardContent className="flex items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 items-center gap-3">
            <UserAvatar displayName={displayName} email={email} avatarUrl={profile?.avatarUrl} />
            <div className="min-w-0">
              <p className="truncate text-sm text-slate-500 dark:text-slate-400">{t("welcomeSubtitle")}</p>
              <p className="truncate text-lg font-semibold text-slate-900 dark:text-slate-100">
                {t("welcomeTitle", { name: displayName })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {authMode !== "guest" && !basicProfileComplete ? (
        <Card className="border-amber-200/80 bg-amber-50/80 dark:border-amber-800/50 dark:bg-amber-900/20">
          <CardHeader>
            <CardTitle className="text-base text-amber-900 dark:text-amber-100">{t("profileIncompleteTitle")}</CardTitle>
            <CardDescription className="text-amber-800 dark:text-amber-300">{t("profileIncompleteDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/onboarding" className={cn(buttonVariants(), "w-full md:w-auto")}>
              {t("goOnboarding")}
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-slate-200/80 bg-white/90 dark:border-slate-700/50 dark:bg-slate-800/90">
        <CardHeader>
          <CardTitle className="text-base">{t("actionCenterTitle")}</CardTitle>
          <CardDescription>{t("actionCenterDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <Link href={todayPlan ? "/workout" : "/plan/ai"} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-emerald-200 hover:bg-emerald-50 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-emerald-800/50 dark:hover:bg-emerald-900/20">
            <CalendarCheck className="mb-3 h-5 w-5 text-emerald-700 dark:text-emerald-400" />
            <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">{todayPlan ? t("actionWorkoutTitle") : t("actionPlanTitle")}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{todayPlan ? t("actionWorkoutDesc") : t("actionPlanDesc")}</p>
          </Link>
          <Link href="/nutrition" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-orange-200 hover:bg-orange-50 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-orange-800/50 dark:hover:bg-orange-900/20">
            <Salad className="mb-3 h-5 w-5 text-orange-700 dark:text-orange-400" />
            <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">{t("actionNutritionTitle")}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{t("actionNutritionDesc")}</p>
          </Link>
          <Link href="/body" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-cyan-200 hover:bg-cyan-50 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-cyan-800/50 dark:hover:bg-cyan-900/20">
            <Weight className="mb-3 h-5 w-5 text-cyan-700 dark:text-cyan-400" />
            <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">{t("actionBodyTitle")}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{t("actionBodyDesc")}</p>
          </Link>
          <Link href="/plan/ai" className="rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-lime-200 hover:bg-lime-50 dark:border-slate-700 dark:bg-slate-800/50 dark:hover:border-lime-800/50 dark:hover:bg-lime-900/20">
            <Sparkles className="mb-3 h-5 w-5 text-lime-700 dark:text-lime-400" />
            <p className="text-sm font-semibold text-slate-950 dark:text-slate-50">{t("actionAiTitle")}</p>
            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{t("actionAiDesc")}</p>
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200/80 bg-white/90 dark:border-slate-700/50 dark:bg-slate-800/90">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Goal className="h-4 w-4 text-emerald-600" />
              {t("todayPlanTitle")}
            </CardTitle>
            <CardDescription>{t("todayPlanDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {todayPlan ? (
              <div className="space-y-3">
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  {t("weekDayLabel", { week: todayPlan.weekNumber, day: todayPlan.dayNumber })}
                </p>
                <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{todayPlan.title}</p>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  {t("exerciseQueued", { count: todayPlan.exerciseCount })}
                </p>
                <Link
                  href="/workout"
                  className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700 dark:text-emerald-400"
                >
                  {t("goWorkout")}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <EmptyState title={t("noPlanTitle")} description={t("noPlanDesc")} />
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/90 dark:border-slate-700/50 dark:bg-slate-800/90">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Salad className="h-4 w-4 text-orange-600" />
              {t("nutritionTitle")}
            </CardTitle>
            <CardDescription>{t("nutritionDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasNutritionTargets ? (
              <>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-400">{t("calories")}</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {nutritionSummary.calories} / {settings.calorieTarget} kcal
                    </span>
                  </div>
                  <Progress value={calorieProgress} />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatRemaining(nutritionSummary.remainingCalories, "kcal", t)}
                  </p>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-400">{t("protein")}</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {nutritionSummary.protein} / {settings.proteinTarget} g
                    </span>
                  </div>
                  <Progress value={proteinProgress} />
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {formatRemaining(nutritionSummary.remainingProtein, "g", t)}
                  </p>
                </div>

                {nutritionSummary.calories === 0 && nutritionSummary.protein === 0 ? (
                  <Link href="/nutrition" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
                    {t("goNutrition")}
                  </Link>
                ) : null}
              </>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800/50 dark:bg-amber-900/20 dark:text-amber-300">
                {t("nutritionTargetUnset")}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/90 dark:border-slate-700/50 dark:bg-slate-800/90">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Flame className="h-4 w-4 text-rose-600" />
              {t("weeklyWorkoutTitle")}
            </CardTitle>
            <CardDescription>{t("weeklyWorkoutDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {hasWeeklyTrainingDays ? (
              <>
                <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                  {weekWorkoutSummary.completedCount}/{weekWorkoutSummary.plannedCount}
                </p>
                <Progress value={weekWorkoutSummary.completionRate} />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t("completion", { value: Math.round(weekWorkoutSummary.completionRate) })}
                </p>
              </>
            ) : (
              <p className="text-sm text-amber-800 dark:text-amber-300">{t("weeklyTrainingUnset")}</p>
            )}
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
              {latestWorkout ? (
                <p>
                  {t("latestWorkout", {
                    date: latestWorkout.date,
                    status: latestWorkout.completed ? t("latestWorkoutDone") : t("latestWorkoutPending"),
                  })}
                </p>
              ) : (
                <p>{t("latestWorkoutEmpty")}</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-slate-200/80 bg-white/90 dark:border-slate-700/50 dark:bg-slate-800/90 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingDown className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
              {t("weightTrendTitle")}
            </CardTitle>
            <CardDescription>{t("weightTrendDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {weightChartData.some((item) => item.weight !== null) ? (
              <SimpleLineChart
                data={weightChartData}
                lines={[{ key: "weight", color: "#0f766e", name: "Weight (kg)" }]}
              />
            ) : (
              <EmptyState title={t("noWeightTitle")} description={t("noWeightDesc")} />
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 bg-white/90 dark:border-slate-700/50 dark:bg-slate-800/90">
          <CardHeader>
            <CardTitle className="text-base">{t("weeklyStatusTitle")}</CardTitle>
            <CardDescription>{t("weeklyStatusDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-400">{t("avgWeight")}</p>
            <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {sevenDayAverage !== null ? `${sevenDayAverage.toFixed(1)} kg` : t("statusInsufficient")}
            </p>
            <Badge
              className={
                weightStatus.status === "on-track"
                  ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-400 dark:hover:bg-emerald-900/30"
                  : weightStatus.status === "too-fast"
                    ? "bg-amber-100 text-amber-700 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-400 dark:hover:bg-amber-900/30"
                    : weightStatus.status === "too-slow"
                      ? "bg-rose-100 text-rose-700 hover:bg-rose-100 dark:bg-rose-900/30 dark:text-rose-400 dark:hover:bg-rose-900/30"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-100 dark:bg-slate-800/50 dark:text-slate-300 dark:hover:bg-slate-800/50"
              }
            >
              {weightStatus.status === "on-track"
                ? t("statusOnTrack")
                : weightStatus.status === "too-fast"
                  ? t("statusTooFast")
                  : weightStatus.status === "too-slow"
                    ? t("statusTooSlow")
                    : t("statusInsufficient")}
            </Badge>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">
              {!hasWeightLossTarget
                ? t("lossTargetUnset")
                : weightStatus.status === "insufficient"
                ? t("statusMessageInsufficient")
                : weightStatus.status === "too-fast"
                  ? t("statusMessageTooFast", { value: weeklyLossText })
                  : weightStatus.status === "too-slow"
                    ? t("statusMessageTooSlow", { value: weeklyLossText })
                    : t("statusMessageOnTrack", { value: weeklyLossText })}
            </p>
          </CardContent>
        </Card>
      </div>

      <PRHighlights />
    </div>
  );
}

