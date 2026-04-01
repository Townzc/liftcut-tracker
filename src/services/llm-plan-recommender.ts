import type { PlanRecommendationInput, PlanRecommendationOutput } from "@/types/llm";

export interface LlmPlanRecommender {
  recommend(input: PlanRecommendationInput): Promise<PlanRecommendationOutput>;
}

class StubLlmPlanRecommender implements LlmPlanRecommender {
  async recommend(input: PlanRecommendationInput): Promise<PlanRecommendationOutput> {
    void input;
    // Placeholder for future server-side recommendation workflows.
    // Keep model calls behind route handlers / server actions.
    throw new Error("LLM plan recommendation is not enabled yet.");
  }
}

export const llmPlanRecommender: LlmPlanRecommender = new StubLlmPlanRecommender();
