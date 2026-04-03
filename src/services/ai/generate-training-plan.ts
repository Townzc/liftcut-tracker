import {
  aiTrainingPlanSchema,
  type AiTrainingGenerationConstraints,
  type AiTrainingPlan,
} from "@/lib/ai/schemas";
import { callDeepSeekForJson } from "@/services/ai/deepseek-client";
import { AiServiceError } from "@/services/ai/errors";
import {
  buildTrainingPlanPrompt,
  TRAINING_PROMPT_VERSION,
} from "@/services/ai/prompts";
import type { AiProfileSnapshot } from "@/services/ai/types";

export interface TrainingGenerationResult {
  modelName: string;
  promptVersion: string;
  rawResponse: unknown;
  parsedPlan: AiTrainingPlan;
}

export async function generateTrainingPlanWithDeepSeek(input: {
  profile: AiProfileSnapshot;
  constraints: AiTrainingGenerationConstraints;
}): Promise<TrainingGenerationResult> {
  const prompt = buildTrainingPlanPrompt(input.profile, input.constraints);
  const response = await callDeepSeekForJson({
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
  });

  const parsed = aiTrainingPlanSchema.safeParse(response.json);
  if (!parsed.success) {
    throw new AiServiceError(
      "AI_SCHEMA_VALIDATION_FAILED",
      "AI output failed schema validation.",
      parsed.error.issues[0]?.message || "Unknown schema validation error.",
    );
  }

  return {
    modelName: response.model,
    promptVersion: TRAINING_PROMPT_VERSION,
    rawResponse: response.json,
    parsedPlan: parsed.data,
  };
}
