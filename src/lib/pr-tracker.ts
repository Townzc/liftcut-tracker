import type { WorkoutLog } from "@/types";
import { formatDisplayDate } from "@/lib/date";

export interface PersonalRecord {
  exerciseName: string;
  maxWeight: number;
  maxWeightDate: string;
  maxReps: number;
  maxRepsDate: string;
  bestEstimated1RM: number;
  best1RMDate: string;
}

export interface RecentPR {
  exerciseName: string;
  type: "weight" | "reps" | "1rm";
  value: number;
  date: string;
  previousValue: number | null;
}

export interface ExerciseProgressPoint {
  date: string;
  label: string;
  estimated1RM: number;
  maxWeight: number;
}

function estimate1RM(weight: number, reps: number): number {
  if (reps <= 0 || weight <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (36 / (37 - reps));
}

interface ExerciseEntry {
  name: string;
  weight: number;
  reps: number;
  date: string;
}

function collectCompletedExercises(workoutLogs: WorkoutLog[]): ExerciseEntry[] {
  const entries: ExerciseEntry[] = [];

  for (const log of workoutLogs) {
    if (!log.completed) continue;

    for (const exercise of log.exercises) {
      if (!exercise.completed) continue;
      if (exercise.actualWeight <= 0 || exercise.actualReps <= 0) continue;

      entries.push({
        name: exercise.name,
        weight: exercise.actualWeight,
        reps: exercise.actualReps,
        date: log.date,
      });
    }
  }

  return entries;
}

export function getPersonalRecords(workoutLogs: WorkoutLog[]): PersonalRecord[] {
  const entries = collectCompletedExercises(workoutLogs);
  const grouped = new Map<string, ExerciseEntry[]>();

  for (const entry of entries) {
    const list = grouped.get(entry.name) ?? [];
    list.push(entry);
    grouped.set(entry.name, list);
  }

  const records: PersonalRecord[] = [];

  for (const [name, exerciseEntries] of grouped) {
    let maxWeight = 0;
    let maxWeightDate = "";
    let maxReps = 0;
    let maxRepsDate = "";
    let best1RM = 0;
    let best1RMDate = "";

    for (const entry of exerciseEntries) {
      if (entry.weight > maxWeight) {
        maxWeight = entry.weight;
        maxWeightDate = entry.date;
      }

      if (entry.reps > maxReps) {
        maxReps = entry.reps;
        maxRepsDate = entry.date;
      }

      const e1RM = estimate1RM(entry.weight, entry.reps);
      if (e1RM > best1RM) {
        best1RM = e1RM;
        best1RMDate = entry.date;
      }
    }

    records.push({
      exerciseName: name,
      maxWeight,
      maxWeightDate,
      maxReps,
      maxRepsDate,
      bestEstimated1RM: Math.round(best1RM * 10) / 10,
      best1RMDate,
    });
  }

  return records;
}

export function getRecentPRs(workoutLogs: WorkoutLog[], limit = 3): RecentPR[] {
  const entries = collectCompletedExercises(workoutLogs);
  const sorted = [...entries].sort(
    (a, b) => a.date.localeCompare(b.date),
  );

  const bestSoFar = new Map<
    string,
    { weight: number; weightDate: string; reps: number; repsDate: string; best1RM: number; best1RMDate: string }
  >();

  const allPRs: RecentPR[] = [];

  for (const entry of sorted) {
    const current = bestSoFar.get(entry.name);
    const e1RM = estimate1RM(entry.weight, entry.reps);

    if (!current) {
      bestSoFar.set(entry.name, {
        weight: entry.weight,
        weightDate: entry.date,
        reps: entry.reps,
        repsDate: entry.date,
        best1RM: e1RM,
        best1RMDate: entry.date,
      });
      allPRs.push({
        exerciseName: entry.name,
        type: "weight",
        value: entry.weight,
        date: entry.date,
        previousValue: null,
      });
      continue;
    }

    if (entry.weight > current.weight) {
      allPRs.push({
        exerciseName: entry.name,
        type: "weight",
        value: entry.weight,
        date: entry.date,
        previousValue: current.weight,
      });
      current.weight = entry.weight;
      current.weightDate = entry.date;
    }

    if (entry.reps > current.reps) {
      allPRs.push({
        exerciseName: entry.name,
        type: "reps",
        value: entry.reps,
        date: entry.date,
        previousValue: current.reps,
      });
      current.reps = entry.reps;
      current.repsDate = entry.date;
    }

    if (e1RM > current.best1RM) {
      allPRs.push({
        exerciseName: entry.name,
        type: "1rm",
        value: Math.round(e1RM * 10) / 10,
        date: entry.date,
        previousValue: Math.round(current.best1RM * 10) / 10,
      });
      current.best1RM = e1RM;
      current.best1RMDate = entry.date;
    }
  }

  return allPRs.slice(-limit).reverse();
}

export function getExerciseProgressData(
  workoutLogs: WorkoutLog[],
  exerciseName: string,
): ExerciseProgressPoint[] {
  const entries = collectCompletedExercises(workoutLogs)
    .filter((e) => e.name === exerciseName)
    .sort((a, b) => a.date.localeCompare(b.date));

  const byDate = new Map<string, { maxWeight: number; best1RM: number }>();

  for (const entry of entries) {
    const e1RM = estimate1RM(entry.weight, entry.reps);
    const current = byDate.get(entry.date);

    if (!current) {
      byDate.set(entry.date, {
        maxWeight: entry.weight,
        best1RM: e1RM,
      });
    } else {
      current.maxWeight = Math.max(current.maxWeight, entry.weight);
      current.best1RM = Math.max(current.best1RM, e1RM);
    }
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      label: formatDisplayDate(date),
      estimated1RM: Math.round(data.best1RM * 10) / 10,
      maxWeight: data.maxWeight,
    }));
}
