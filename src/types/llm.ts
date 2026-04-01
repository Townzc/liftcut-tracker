export type PlanGoal = "fat_loss" | "muscle_gain" | "strength" | "general_fitness";
export type TrainingExperience = "beginner" | "intermediate" | "advanced";

export interface PlanGenerationInput {
  age: number;
  sex?: "male" | "female" | "other";
  height: number;
  weight: number;
  goal: PlanGoal;
  trainingDaysPerWeek: number;
  trainingExperience: TrainingExperience;
  preferredExercises: string[];
  injuriesOrLimitations: string[];
  notes: string;
}

export interface GeneratedExercise {
  name: string;
  sets: number;
  repRange: string;
  targetRpe: number;
  notes?: string;
  alternativeExercises?: string[];
}

export interface GeneratedPlanDay {
  dayNumber: number;
  title: string;
  notes?: string;
  exercises: GeneratedExercise[];
}

export interface GeneratedPlanWeek {
  weekNumber: number;
  days: GeneratedPlanDay[];
}

export interface PlanGenerationOutput {
  planName: string;
  weeks: GeneratedPlanWeek[];
  days: number;
  exercises: number;
  rationale?: string;
}

export interface PlanRecommendationInput {
  currentPlanName?: string;
  trainingDaysPerWeek: number;
  recentWorkoutSummary: {
    totalSessions: number;
    completedSessions: number;
    averageRpe?: number;
  };
  nutritionSummary?: {
    avgCalories?: number;
    avgProtein?: number;
  };
  bodyTrendSummary?: {
    weeklyWeightChange?: number;
    weeklyWaistChange?: number;
  };
  goal: PlanGoal;
}

export interface PlanRecommendationOutput {
  shouldAdjustPlan: boolean;
  recommendationSummary: string;
  suggestedAdjustments: string[];
  confidence?: number;
}
