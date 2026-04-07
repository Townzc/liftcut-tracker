import { NextResponse } from "next/server";
import { z } from "zod";

import { generateNutritionPlanRequestSchema } from "@/lib/ai/schemas";
import { getDeepSeekConfigOptional } from "@/services/ai/config";
import { AiServiceError } from "@/services/ai/errors";
import { generateNutritionPlanWithDeepSeek } from "@/services/ai/generate-nutrition-plan";
import { verifyNutritionPlanLanguage } from "@/services/ai/language-check";
import {
  fetchAiProfileSnapshot,
  insertNutritionGenerationHistory,
} from "@/services/ai/persistence";
import { NUTRITION_PROMPT_VERSION } from "@/services/ai/prompts";
import { aiConfigStatus, requireApiUser, toAiErrorResponse } from "@/app/api/ai/_lib";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  const { supabase, user } = auth;

  let body: z.infer<typeof generateNutritionPlanRequestSchema>;
  try {
    body = generateNutritionPlanRequestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_REQUEST",
        message: "Invalid request payload.",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    );
  }

  let profile;
  try {
    profile = await fetchAiProfileSnapshot(supabase, user.id);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "PROFILE_LOAD_FAILED",
        message: "Failed to load profile settings before AI generation.",
      },
      { status: 500 },
    );
  }

  if (profile.currentWeight <= 0 || profile.targetWeight <= 0) {
    return toAiErrorResponse(
      new AiServiceError(
        "AI_PROFILE_INCOMPLETE",
        "Please complete current and target weight before generating nutrition plans.",
      ),
    );
  }

  try {
    const result = await generateNutritionPlanWithDeepSeek({
      profile,
      constraints: body.constraints,
      locale: body.locale,
    });

    const languageCheck = verifyNutritionPlanLanguage(body.locale, result.parsedPlan);
    if (!languageCheck.matched) {
      throw new AiServiceError(
        "AI_LANGUAGE_MISMATCH",
        "AI response language does not match current locale. Please regenerate.",
        languageCheck.detail,
      );
    }

    const generationId = await insertNutritionGenerationHistory(supabase, {
      userId: user.id,
      goalType: body.constraints.goal_type || profile.fitnessGoal,
      profile,
      constraints: { ...body.constraints, locale: body.locale },
      modelName: result.modelName,
      promptVersion: result.promptVersion,
      rawResponse: result.rawResponse,
      parsedPlan: result.parsedPlan,
      status: "success",
    });

    return NextResponse.json({
      ok: true,
      aiConfigured: aiConfigStatus().configured,
      generationId,
      model: result.modelName,
      promptVersion: result.promptVersion,
      plan: result.parsedPlan,
    });
  } catch (error) {
    const config = getDeepSeekConfigOptional();
    await insertNutritionGenerationHistory(supabase, {
      userId: user.id,
      goalType: body.constraints.goal_type || profile.fitnessGoal,
      profile,
      constraints: { ...body.constraints, locale: body.locale },
      modelName: config?.model || "deepseek-chat",
      promptVersion: NUTRITION_PROMPT_VERSION,
      rawResponse: null,
      parsedPlan: null,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return toAiErrorResponse(error);
  }
}
