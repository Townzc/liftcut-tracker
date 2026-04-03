import type { FitnessGoal, Gender, TrainingExperience } from "@/types";

export interface PlanGenerationInput {
  age: number;
  sex?: Exclude<Gender, "unknown"> | "unknown";
  height: number;
  weight: number;
  goal: FitnessGoal;
  trainingDaysPerWeek: number;
  trainingExperience: TrainingExperience;
  preferredExercises: string[];
  injuriesOrLimitations: string;
  notes: string;
}

export interface PlanGenerationOutputExercise {
  name: string;
  sets: number;
  repRange: string;
  targetRpe: number;
  notes: string;
  alternativeExercises: string[];
}

export interface PlanGenerationOutputDay {
  dayNumber: number;
  title: string;
  notes: string;
  exercises: PlanGenerationOutputExercise[];
}

export interface PlanGenerationOutputWeek {
  weekNumber: number;
  focus: string;
  days: PlanGenerationOutputDay[];
}

export interface PlanGenerationOutput {
  planName: string;
  weeks: PlanGenerationOutputWeek[];
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
  goal: FitnessGoal;
}

export interface PlanRecommendationOutput {
  shouldAdjustPlan: boolean;
  recommendationSummary: string;
  suggestedAdjustments: string[];
  confidence?: number;
}
