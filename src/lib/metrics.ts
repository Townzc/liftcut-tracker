import { subDays } from "date-fns";

import type {
  BodyMetricLog,
  FoodLog,
  TrainingPlan,
  UserSettings,
  WorkoutLog,
} from "@/types";
import {
  compareDateAsc,
  formatDisplayDate,
  getCurrentWeekRange,
  getLastNDates,
  parseDateString,
  toDateString,
} from "@/lib/date";

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total / values.length;
}

export function getTodayNutritionSummary(
  foodLogs: FoodLog[],
  settings: UserSettings,
  date = toDateString(new Date()),
): {
  calories: number;
  protein: number;
  remainingCalories: number;
  remainingProtein: number;
} {
  const todayLogs = foodLogs.filter((log) => log.date === date);

  const calories = todayLogs.reduce((sum, log) => sum + log.calories, 0);
  const protein = todayLogs.reduce((sum, log) => sum + log.protein, 0);

  return {
    calories,
    protein,
    remainingCalories: settings.calorieTarget - calories,
    remainingProtein: settings.proteinTarget - protein,
  };
}

export function getCurrentWeekWorkoutSummary(
  workoutLogs: WorkoutLog[],
  plannedDays: number,
): {
  completedCount: number;
  plannedCount: number;
  completionRate: number;
} {
  const { start, end } = getCurrentWeekRange();
  const weekLogs = workoutLogs.filter((log) => log.date >= start && log.date <= end);
  const completedCount = weekLogs.filter((log) => log.completed).length;
  const plannedCount = Math.max(1, plannedDays);

  return {
    completedCount,
    plannedCount,
    completionRate: Math.min(100, (completedCount / plannedCount) * 100),
  };
}

export function getWeightChartData(
  bodyMetricLogs: BodyMetricLog[],
  days = 7,
): Array<{ date: string; weight: number | null; waist: number | null; label: string }> {
  const map = new Map(bodyMetricLogs.map((log) => [log.date, log]));

  return getLastNDates(days).map((date) => {
    const log = map.get(date);
    return {
      date,
      weight: log?.weight ?? null,
      waist: log?.waist ?? null,
      label: formatDisplayDate(date),
    };
  });
}

export function getAverageWeightByDays(
  bodyMetricLogs: BodyMetricLog[],
  days: number,
  endDate = new Date(),
): number | null {
  const start = subDays(endDate, days - 1);
  const values = bodyMetricLogs
    .filter((log) => {
      const date = parseDateString(log.date);
      return date >= start && date <= endDate;
    })
    .map((log) => log.weight);

  return average(values);
}

export function getWeeklyWeightChange(bodyMetricLogs: BodyMetricLog[]): number | null {
  const recentAverage = getAverageWeightByDays(bodyMetricLogs, 7, new Date());
  const previousAverage = getAverageWeightByDays(bodyMetricLogs, 7, subDays(new Date(), 7));

  if (recentAverage === null || previousAverage === null) {
    return null;
  }

  return Number((previousAverage - recentAverage).toFixed(2));
}

export function getWeightGoalStatus(
  bodyMetricLogs: BodyMetricLog[],
  settings: UserSettings,
): {
  status: "on-track" | "too-slow" | "too-fast" | "insufficient";
  weeklyLoss: number | null;
} {
  const weeklyLoss = getWeeklyWeightChange(bodyMetricLogs);

  if (weeklyLoss === null) {
    return {
      status: "insufficient",
      weeklyLoss,
    };
  }

  if (weeklyLoss < settings.targetWeeklyLossMin) {
    return {
      status: "too-slow",
      weeklyLoss,
    };
  }

  if (weeklyLoss > settings.targetWeeklyLossMax) {
    return {
      status: "too-fast",
      weeklyLoss,
    };
  }

  return {
    status: "on-track",
    weeklyLoss,
  };
}

export function getBodyLogsSorted(bodyMetricLogs: BodyMetricLog[]): BodyMetricLog[] {
  return [...bodyMetricLogs].sort((a, b) => compareDateAsc(a.date, b.date));
}

export function getSuggestedTrainingDayNumber(weeklyTrainingDays: number): number {
  const dayOfWeek = new Date().getDay();
  const normalized = dayOfWeek === 0 ? 7 : dayOfWeek;
  return ((normalized - 1) % Math.max(1, weeklyTrainingDays)) + 1;
}

export function getTodayPlanInfo(trainingPlan: TrainingPlan, weeklyTrainingDays: number): {
  weekNumber: number;
  dayNumber: number;
  title: string;
  exerciseCount: number;
} | null {
  const weekNumber = 1;
  const dayNumber = getSuggestedTrainingDayNumber(weeklyTrainingDays);
  const week = trainingPlan.weeks.find((item) => item.weekNumber === weekNumber);
  const day = week?.days.find((item) => item.dayNumber === dayNumber);

  if (!day) {
    return null;
  }

  return {
    weekNumber,
    dayNumber,
    title: day.title,
    exerciseCount: day.exercises.length,
  };
}

export function getNutritionByDate(foodLogs: FoodLog[], date: string): {
  calories: number;
  protein: number;
} {
  return foodLogs
    .filter((log) => log.date === date)
    .reduce(
      (acc, log) => {
        acc.calories += log.calories;
        acc.protein += log.protein;
        return acc;
      },
      { calories: 0, protein: 0 },
    );
}

export function getBodyTrendData(logs: BodyMetricLog[]): Array<{
  date: string;
  label: string;
  weight: number;
  waist: number;
}> {
  return getBodyLogsSorted(logs).map((log) => ({
    date: log.date,
    label: formatDisplayDate(log.date),
    weight: log.weight,
    waist: log.waist,
  }));
}