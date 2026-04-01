import type { PlanGenerationInput, PlanGenerationOutput } from "@/types/llm";

export interface LlmPlanGenerator {
  generatePlan(input: PlanGenerationInput): Promise<PlanGenerationOutput>;
}

class StubLlmPlanGenerator implements LlmPlanGenerator {
  async generatePlan(input: PlanGenerationInput): Promise<PlanGenerationOutput> {
    void input;
    // Placeholder for future server-side model integration.
    // API keys must never be exposed in the client.
    throw new Error("LLM plan generation is not enabled yet.");
  }
}

export const llmPlanGenerator: LlmPlanGenerator = new StubLlmPlanGenerator();
