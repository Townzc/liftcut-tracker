import { subDays } from "date-fns";

import type {
  AppDataSnapshot,
  BodyMetricLog,
  ExerciseLog,
  ExercisePlan,
  FoodLog,
  PlanDay,
  PlanWeek,
  QuickFoodItem,
  TrainingPlan,
  UserSettings,
  WorkoutLog,
} from "@/types";
import { toDateString } from "@/lib/date";

const dayTemplates: Array<Omit<PlanDay, "exercises"> & { exercises: Omit<ExercisePlan, "id">[] }> = [
  {
    dayNumber: 1,
    title: "Lower + Push",
    notes: "Keep 1-2 reps in reserve on compounds.",
    exercises: [
      {
        name: "Back Squat",
        sets: 4,
        repRange: "5-8",
        targetRpe: 7,
        notes: "Add small load each week",
        alternativeExercises: ["Goblet Squat", "Hack Squat"],
      },
      {
        name: "Bench Press",
        sets: 4,
        repRange: "5-8",
        targetRpe: 7,
        notes: "Pause and stay stable",
        alternativeExercises: ["DB Bench Press", "Machine Press"],
      },
      {
        name: "Romanian Deadlift",
        sets: 3,
        repRange: "6-10",
        targetRpe: 7.5,
        notes: "Control the eccentric",
      },
      {
        name: "Incline DB Press",
        sets: 3,
        repRange: "8-12",
        targetRpe: 8,
        notes: "No momentum",
      },
      {
        name: "Cable Pushdown",
        sets: 3,
        repRange: "10-15",
        targetRpe: 8,
        notes: "Hold peak contraction",
      },
    ],
  },
  {
    dayNumber: 2,
    title: "Pull + Core",
    notes: "Prioritize movement quality.",
    exercises: [
      {
        name: "Deadlift",
        sets: 3,
        repRange: "3-5",
        targetRpe: 7,
        notes: "Reset setup every set",
        alternativeExercises: ["Trap Bar Deadlift", "Block Pull"],
      },
      {
        name: "Pull-Up",
        sets: 4,
        repRange: "6-10",
        targetRpe: 8,
        notes: "Use load or assist as needed",
      },
      {
        name: "Bent-Over Row",
        sets: 3,
        repRange: "8-12",
        targetRpe: 8,
        notes: "Keep trunk stable",
      },
      {
        name: "Seated Cable Row",
        sets: 3,
        repRange: "10-15",
        targetRpe: 8,
        notes: "Elbows down and back",
      },
      {
        name: "Plank",
        sets: 3,
        repRange: "40-60 sec",
        targetRpe: 7,
        notes: "Keep neutral pelvis",
      },
    ],
  },
  {
    dayNumber: 3,
    title: "Lower + Shoulders",
    notes: "Control each rep and tempo.",
    exercises: [
      {
        name: "Front Squat",
        sets: 4,
        repRange: "4-6",
        targetRpe: 7.5,
        notes: "Keep core braced",
        alternativeExercises: ["Leg Press", "Safety Bar Squat"],
      },
      {
        name: "Leg Curl",
        sets: 3,
        repRange: "10-15",
        targetRpe: 8,
        notes: "Slow eccentric",
      },
      {
        name: "Overhead Press",
        sets: 4,
        repRange: "5-8",
        targetRpe: 7.5,
        notes: "Avoid overextension",
        alternativeExercises: ["Arnold Press", "Machine Shoulder Press"],
      },
      {
        name: "Lateral Raise",
        sets: 4,
        repRange: "12-20",
        targetRpe: 8.5,
        notes: "Full control",
      },
      {
        name: "Farmer Carry",
        sets: 3,
        repRange: "30-45 m",
        targetRpe: 8,
        notes: "Stay upright",
      },
    ],
  },
];

export const defaultSettings: UserSettings = {
  height: 176,
  currentWeight: 78,
  targetWeight: 72,
  weeklyTrainingDays: 3,
  calorieTarget: 2200,
  proteinTarget: 160,
  targetWeeklyLossMin: 0.3,
  targetWeeklyLossMax: 0.8,
};

export const defaultQuickFoods: QuickFoodItem[] = [
  { id: "egg", name: "Egg", calories: 78, protein: 6, mealType: "breakfast" },
  { id: "milk", name: "Milk", calories: 120, protein: 8, mealType: "breakfast" },
  { id: "yogurt", name: "Greek Yogurt", calories: 90, protein: 9, mealType: "snack" },
  { id: "whey", name: "Whey Protein", calories: 130, protein: 24, mealType: "snack" },
  { id: "chicken", name: "Chicken Breast", calories: 165, protein: 31, mealType: "lunch" },
  { id: "rice", name: "Rice", calories: 180, protein: 3, mealType: "dinner" },
];

function buildWeek(weekNumber: number): PlanWeek {
  const blockProgression = Math.floor((weekNumber - 1) / 4) * 0.5;

  return {
    weekNumber,
    days: dayTemplates.map((day) => ({
      dayNumber: day.dayNumber,
      title: day.title,
      notes: `${day.notes} Week ${weekNumber}: add small load or reps if quality stays high.`,
      exercises: day.exercises.map((exercise, exerciseIndex) => ({
        ...exercise,
        id: `w${weekNumber}-d${day.dayNumber}-e${exerciseIndex + 1}`,
        targetRpe: Math.min(9.5, Number((exercise.targetRpe + blockProgression).toFixed(1))),
      })),
    })),
  };
}

export function createDemoTrainingPlan(): TrainingPlan {
  return {
    id: "demo-12-week-fat-loss-strength",
    name: "12 Week Fat Loss Strength Plan (Demo)",
    weeks: Array.from({ length: 12 }, (_, idx) => buildWeek(idx + 1)),
  };
}

function buildFoodLog(
  date: string,
  foodName: string,
  calories: number,
  protein: number,
  mealType: FoodLog["mealType"],
): FoodLog {
  return {
    id: `${date}-${foodName}-${mealType}`,
    date,
    foodName,
    calories,
    protein,
    mealType,
  };
}

function buildBodyLogs(): BodyMetricLog[] {
  const baseWeight = 78.6;
  const baseWaist = 86.5;

  return Array.from({ length: 21 }, (_, idx) => {
    const date = toDateString(subDays(new Date(), 20 - idx));
    const weight = Number((baseWeight - idx * 0.08 + (idx % 4) * 0.05).toFixed(1));
    const waist = Number((baseWaist - idx * 0.05 + (idx % 3) * 0.04).toFixed(1));

    return {
      id: `body-${date}`,
      date,
      weight,
      waist,
      notes: idx % 7 === 0 ? "Morning fasted" : "",
    };
  });
}

function buildWorkoutExerciseLogs(plan: TrainingPlan, weekNumber: number, dayNumber: number): ExerciseLog[] {
  const week = plan.weeks.find((item) => item.weekNumber === weekNumber);
  const day = week?.days.find((item) => item.dayNumber === dayNumber);

  if (!day) {
    return [];
  }

  return day.exercises.map((exercise, idx) => ({
    exercisePlanId: exercise.id,
    name: exercise.name,
    actualWeight: Number((40 + idx * 5 + weekNumber * 0.5).toFixed(1)),
    actualReps: Math.max(5, Number.parseInt(exercise.repRange.split("-")[0] || "8", 10)),
    actualRpe: Number((exercise.targetRpe + 0.2).toFixed(1)),
    completed: true,
  }));
}

function buildWorkoutLogs(plan: TrainingPlan): WorkoutLog[] {
  const today = new Date();
  const dates = [subDays(today, 5), subDays(today, 3), subDays(today, 1)];

  return dates.map((date, idx) => {
    const weekNumber = 1;
    const dayNumber = idx + 1;

    return {
      id: `workout-${toDateString(date)}-${dayNumber}`,
      date: toDateString(date),
      weekNumber,
      dayNumber,
      durationMinutes: 62 + idx * 7,
      completed: true,
      notes: idx === 1 ? "Felt average, reduced load on final set" : "Good training pace",
      exercises: buildWorkoutExerciseLogs(plan, weekNumber, dayNumber),
    };
  });
}

function buildFoodLogs(): FoodLog[] {
  const today = toDateString(new Date());
  const yesterday = toDateString(subDays(new Date(), 1));

  return [
    buildFoodLog(today, "Egg", 156, 12, "breakfast"),
    buildFoodLog(today, "Milk", 120, 8, "breakfast"),
    buildFoodLog(today, "Chicken Breast", 230, 42, "lunch"),
    buildFoodLog(today, "Rice", 180, 3, "lunch"),
    buildFoodLog(today, "Whey Protein", 130, 24, "snack"),
    buildFoodLog(yesterday, "Greek Yogurt", 90, 9, "snack"),
    buildFoodLog(yesterday, "Chicken Breast", 200, 38, "dinner"),
  ];
}

export function createDemoSnapshot(): AppDataSnapshot {
  const trainingPlan = createDemoTrainingPlan();

  return {
    settings: defaultSettings,
    trainingPlan,
    workoutLogs: buildWorkoutLogs(trainingPlan),
    foodLogs: buildFoodLogs(),
    bodyMetricLogs: buildBodyLogs(),
    quickFoods: defaultQuickFoods,
  };
}