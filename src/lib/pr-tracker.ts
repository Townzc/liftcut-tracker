import { bestOneRepMax, estimateOneRepMax, type OneRepMaxEstimate } from "@liftcut/core/one-rep-max";
import type { WorkoutLog } from "@liftcut/core/types";
import { formatDisplayDate } from "@/lib/date";

export interface PersonalRecord {
  exerciseName: string;
  maxWeight: number;
  maxWeightDate: string;
  maxReps: number;
  maxRepsDate: string;
  bestEstimated1RM: number | null;
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
  estimated1RM: number | null;
  maxWeight: number;
}

// No estimate above 12 reps; unknown stays null rather than 0.
function estimate1RM(weight: number, reps: number): number | null {
  return estimateOneRepMax({ date: "", weightKg: weight, reps })?.kg ?? null;
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
      if (exercise.actualWeight == null || exercise.actualReps == null) continue;
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
    let best1RM: number | null = null;
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
      if (e1RM !== null && (best1RM === null || e1RM > best1RM)) {
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
      bestEstimated1RM: best1RM,
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
    { weight: number; weightDate: string; reps: number; repsDate: string; best1RM: number | null; best1RMDate: string }
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

    if (e1RM !== null && (current.best1RM === null || e1RM > current.best1RM)) {
      allPRs.push({
        exerciseName: entry.name,
        type: "1rm",
        value: e1RM,
        date: entry.date,
        previousValue: current.best1RM,
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

  const byDate = new Map<string, { maxWeight: number; best1RM: number | null }>();

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
      if (e1RM !== null && (current.best1RM === null || e1RM > current.best1RM)) current.best1RM = e1RM;
    }
  }

  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({
      date,
      label: formatDisplayDate(date),
      estimated1RM: data.best1RM,
      maxWeight: data.maxWeight,
    }));
}

/** Best estimate per exercise with its source set; null when no set qualifies (e.g. only > 12 reps). */
export function getOneRepMaxByExercise(workoutLogs: WorkoutLog[]): { exerciseName: string; estimate: OneRepMaxEstimate<ExerciseEntry & { weightKg: number }> | null }[] {
  const grouped = new Map<string, (ExerciseEntry & { weightKg: number })[]>();
  for (const entry of collectCompletedExercises(workoutLogs))
    grouped.set(entry.name, [...(grouped.get(entry.name) ?? []), { ...entry, weightKg: entry.weight }]);
  return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([exerciseName, sets]) => ({ exerciseName, estimate: bestOneRepMax(sets) }));
}
