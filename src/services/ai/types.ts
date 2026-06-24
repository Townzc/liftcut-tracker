import type {
  DietPreference,
  FitnessGoal,
  Gender,
  TrainingExperience,
  TrainingLocation,
} from "@/types";

export type AiProviderName = "deepseek" | "local" | "openai_compatible";

export interface AiProviderConfig {
  provider: AiProviderName;
  baseURL: string;
  apiKey: string;
  model: string;
}

export interface AiProfileSnapshot {
  gender: Gender;
  age: number;
  height: number;
  currentWeight: number;
  targetWeight: number;
  weeklyTrainingDays: number;
  calorieTarget: number;
  proteinTarget: number;
  targetWeeklyLossMin: number;
  targetWeeklyLossMax: number;
  fitnessGoal: FitnessGoal;
  trainingExperience: TrainingExperience;
  trainingLocation: TrainingLocation;
  availableEquipment: string[];
  sessionDurationMinutes: number;
  dietPreference: DietPreference;
  foodRestrictions: string;
  injuryNotes: string;
  lifestyleNotes: string;
}
