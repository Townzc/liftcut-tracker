export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export interface UserSettings {
  height: number;
  currentWeight: number;
  targetWeight: number;
  weeklyTrainingDays: number;
  calorieTarget: number;
  proteinTarget: number;
  targetWeeklyLossMin: number;
  targetWeeklyLossMax: number;
}

export interface ExercisePlan {
  id: string;
  name: string;
  sets: number;
  repRange: string;
  targetRpe: number;
  notes: string;
  alternativeExercises?: string[];
}

export interface PlanDay {
  dayNumber: number;
  title: string;
  exercises: ExercisePlan[];
  notes: string;
}

export interface PlanWeek {
  weekNumber: number;
  days: PlanDay[];
}

export interface TrainingPlan {
  id: string;
  name: string;
  weeks: PlanWeek[];
}

export interface ExerciseLog {
  exercisePlanId: string;
  name: string;
  actualWeight: number;
  actualReps: number;
  actualRpe: number;
  completed: boolean;
}

export interface WorkoutLog {
  id: string;
  date: string;
  weekNumber: number;
  dayNumber: number;
  durationMinutes: number;
  completed: boolean;
  notes: string;
  exercises: ExerciseLog[];
}

export interface FoodLog {
  id: string;
  date: string;
  mealType: MealType;
  foodName: string;
  calories: number;
  protein: number;
}

export interface BodyMetricLog {
  id: string;
  date: string;
  weight: number;
  waist: number;
  notes?: string;
}

export interface QuickFoodItem {
  id: string;
  name: string;
  calories: number;
  protein: number;
  mealType: MealType;
}

export interface AppDataSnapshot {
  settings: UserSettings;
  trainingPlan: TrainingPlan;
  workoutLogs: WorkoutLog[];
  foodLogs: FoodLog[];
  bodyMetricLogs: BodyMetricLog[];
  quickFoods: QuickFoodItem[];
}

