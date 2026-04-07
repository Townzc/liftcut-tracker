import {
  type AiLocale,
  aiNutritionPlanSchema,
  type AiNutritionGenerationConstraints,
  type AiNutritionPlan,
} from "@/lib/ai/schemas";
import { callDeepSeekForJson } from "@/services/ai/deepseek-client";
import { AiServiceError } from "@/services/ai/errors";
import {
  buildNutritionPlanPrompt,
  NUTRITION_PROMPT_VERSION,
} from "@/services/ai/prompts";
import type { AiProfileSnapshot } from "@/services/ai/types";

export interface NutritionGenerationResult {
  modelName: string;
  promptVersion: string;
  rawResponse: unknown;
  parsedPlan: AiNutritionPlan;
}

export async function generateNutritionPlanWithDeepSeek(input: {
  profile: AiProfileSnapshot;
  constraints: AiNutritionGenerationConstraints;
  locale: AiLocale;
}): Promise<NutritionGenerationResult> {
  const prompt = buildNutritionPlanPrompt(input.profile, input.constraints, input.locale);
  const response = await callDeepSeekForJson({
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
  });

  const parsed = aiNutritionPlanSchema.safeParse(response.json);
  if (!parsed.success) {
    throw new AiServiceError(
      "AI_SCHEMA_VALIDATION_FAILED",
      "AI output failed schema validation.",
      parsed.error.issues[0]?.message || "Unknown schema validation error.",
    );
  }

  return {
    modelName: response.model,
    promptVersion: NUTRITION_PROMPT_VERSION,
    rawResponse: response.json,
    parsedPlan: parsed.data,
  };
}
