import {
  type AiLocale,
  aiNutritionPlanRawSchema,
  aiNutritionPlanSchema,
  normalizeAiNutritionPlan,
  type AiNutritionGenerationConstraints,
  type AiNutritionPlan,
} from "@/lib/ai/schemas";
import { callAiProviderForJson } from "@/services/ai/client";
import { AiServiceError } from "@/services/ai/errors";
import {
  buildNutritionPlanPrompt,
  NUTRITION_PROMPT_VERSION,
} from "@/services/ai/prompts";
import type {
  AiProfileSnapshot,
  AiProviderName,
} from "@/services/ai/types";

function unwrapNutritionPlanCandidate(value: unknown): unknown {
  if (
    value &&
    typeof value === "object" &&
    "nutrition_plan" in value &&
    typeof (value as Record<string, unknown>).nutrition_plan === "object"
  ) {
    return (value as Record<string, unknown>).nutrition_plan;
  }
  return value;
}

export interface NutritionGenerationResult {
  provider: AiProviderName;
  modelName: string;
  promptVersion: string;
  rawResponse: unknown;
  rawText: string;
  extractedJsonText: string;
  parsedPlan: AiNutritionPlan;
}

function previewText(value: string, maxLength = 2000): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...(truncated)`;
}

function previewJson(value: unknown, maxLength = 3000): string {
  try {
    const text = JSON.stringify(value);
    return previewText(text ?? "", maxLength);
  } catch {
    return "[unserializable]";
  }
}

function formatIssues(issues: Array<{ path: PropertyKey[]; message: string }>): string {
  return issues
    .map((issue, index) => {
      const path = issue.path.map((segment) => String(segment)).join(".") || "(root)";
      return `${index + 1}. ${path}: ${issue.message}`;
    })
    .join(" | ");
}

export async function generateStructuredNutritionPlan(input: {
  profile: AiProfileSnapshot;
  constraints: AiNutritionGenerationConstraints;
  locale: AiLocale;
  logValidationFailures?: boolean;
}): Promise<NutritionGenerationResult> {
  const logValidationFailures = input.logValidationFailures ?? true;
  const prompt = buildNutritionPlanPrompt(input.profile, input.constraints, input.locale);
  const response = await callAiProviderForJson({
    systemPrompt: prompt.systemPrompt,
    userPrompt: prompt.userPrompt,
  });

  const unwrappedJson = unwrapNutritionPlanCandidate(response.json);
  const rawParsed = aiNutritionPlanRawSchema.safeParse(unwrappedJson);
  if (!rawParsed.success) {
    const issues = rawParsed.error.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
    }));
    if (logValidationFailures) {
      console.error("[ai/nutrition] schema validation failed at raw schema", {
        schema: "nutrition_raw",
        rawTextPreview: previewText(response.rawText),
        extractedJsonPreview: previewText(response.extractedJsonText),
        parsedJsonPreview: previewJson(response.json),
        issues,
      });
    }

    throw new AiServiceError(
      "AI_SCHEMA_VALIDATION_FAILED",
      "AI output failed schema validation.",
      `raw_schema: ${formatIssues(issues)}`,
    );
  }

  let normalized: AiNutritionPlan;
  try {
    normalized = normalizeAiNutritionPlan(rawParsed.data);
  } catch (error) {
    if (logValidationFailures) {
      console.error("[ai/nutrition] normalization failed", {
        schema: "nutrition_normalize",
        rawTextPreview: previewText(response.rawText),
        extractedJsonPreview: previewText(response.extractedJsonText),
        parsedJsonPreview: previewJson(response.json),
        message: error instanceof Error ? error.message : String(error),
      });
    }
    throw new AiServiceError(
      "AI_SCHEMA_VALIDATION_FAILED",
      "AI output failed schema validation.",
      `normalize: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const parsed = aiNutritionPlanSchema.safeParse(normalized);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path,
      message: issue.message,
    }));
    if (logValidationFailures) {
      console.error("[ai/nutrition] schema validation failed at final schema", {
        schema: "nutrition_final",
        rawTextPreview: previewText(response.rawText),
        extractedJsonPreview: previewText(response.extractedJsonText),
        parsedJsonPreview: previewJson(response.json),
        normalizedPreview: previewJson(normalized),
        issues,
      });
    }

    throw new AiServiceError(
      "AI_SCHEMA_VALIDATION_FAILED",
      "AI output failed schema validation.",
      `final_schema: ${formatIssues(issues)}`,
    );
  }

  return {
    provider: response.provider,
    modelName: response.model,
    promptVersion: NUTRITION_PROMPT_VERSION,
    rawResponse: normalized,
    rawText: response.rawText,
    extractedJsonText: response.extractedJsonText,
    parsedPlan: parsed.data,
  };
}
