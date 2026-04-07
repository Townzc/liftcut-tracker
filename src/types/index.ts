export type AppLocale = "zh-CN" | "en";
export type AuthMode = "none" | "guest" | "authenticated";
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";
export type QuickFoodBasisType = "per_100g" | "per_serving";
export type Gender = "male" | "female" | "other" | "unknown";
export type FitnessGoal = "fat_loss" | "muscle_gain" | "maintenance" | "recomposition";
export type TrainingExperience = "beginner" | "intermediate" | "advanced";
export type TrainingLocation = "gym" | "home" | "mixed";
export type DietPreference = "none" | "high_protein" | "vegetarian" | "low_carb" | "balanced";

export interface UserProfile {
  id: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
  preferredLanguage: AppLocale;
  createdAt: string;
  updatedAt?: string;
}

export interface UserSettings {
  userId: string;
  gender: Gender;
  age: number;
  fitnessGoal: FitnessGoal;
  trainingExperience: TrainingExperience;
  trainingLocation: TrainingLocation;
  availableEquipment: string[];
  sessionDurationMinutes: number;
  dietPreference: DietPreference;
  foodRestrictions: string;
  injuryNotes: string;
  lifestyleNotes: string;
  height: number;
  currentWeight: number;
  targetWeight: number;
  weeklyTrainingDays: number;
  calorieTarget: number;
  proteinTarget: number;
  targetWeeklyLossMin: number;
  targetWeeklyLossMax: number;
  updatedAt: string;
}

export interface ExercisePlan {
  id: string;
  dayId: string;
  name: string;
  sets: number;
  repRange: string;
  targetRpe: number;
  notes: string;
  alternativeExercises?: string[];
}

export interface PlanDay {
  id: string;
  weekId: string;
  dayNumber: number;
  title: string;
  exercises: ExercisePlan[];
  notes: string;
}

export interface PlanWeek {
  id: string;
  trainingPlanId: string;
  weekNumber: number;
  days: PlanDay[];
}

export interface TrainingPlan {
  id: string;
  userId: string;
  name: string;
  notes: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  weeks: PlanWeek[];
}

export interface TrainingPlanSummary {
  id: string;
  userId: string;
  name: string;
  notes: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ExerciseLog {
  id: string;
  workoutLogId: string;
  exercisePlanId: string;
  name: string;
  actualWeight: number;
  actualReps: number;
  actualRpe: number;
  completed: boolean;
}

export interface WorkoutLog {
  id: string;
  userId: string;
  date: string;
  trainingPlanId: string;
  weekNumber: number;
  dayNumber: number;
  durationMinutes: number;
  completed: boolean;
  notes: string;
  createdAt: string;
  exercises: ExerciseLog[];
}

export interface FoodLog {
  id: string;
  userId: string;
  date: string;
  mealType: MealType;
  foodName: string;
  calories: number;
  protein: number;
  createdAt: string;
}

export interface BodyMetricLog {
  id: string;
  userId: string;
  date: string;
  weight: number;
  waist: number;
  notes?: string;
  createdAt: string;
}

export interface QuickFoodItem {
  id: string;
  name: string;
  calories: number;
  protein: number;
  mealType: MealType;
  basisType: QuickFoodBasisType;
  servingSize: string;
  unitLabel: string;
  displayText: string;
}

export interface AppDataSnapshot {
  settings: UserSettings;
  trainingPlan: TrainingPlan;
  workoutLogs: WorkoutLog[];
  foodLogs: FoodLog[];
  bodyMetricLogs: BodyMetricLog[];
  quickFoods: QuickFoodItem[];
}

export interface ParsedLineError {
  lineNumber: number;
  content: string;
  reason: string;
}
