import "server-only";

export {
  generateStructuredTrainingPlan,
  type TrainingGenerationResult,
} from "@/services/ai/generate-training-plan";
export {
  generateStructuredNutritionPlan,
  type NutritionGenerationResult,
} from "@/services/ai/generate-nutrition-plan";
