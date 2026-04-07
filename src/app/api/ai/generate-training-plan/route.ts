import { NextResponse } from "next/server";
import { z } from "zod";

import { generateTrainingPlanRequestSchema } from "@/lib/ai/schemas";
import { getDeepSeekConfigOptional } from "@/services/ai/config";
import { AiServiceError } from "@/services/ai/errors";
import { generateTrainingPlanWithDeepSeek } from "@/services/ai/generate-training-plan";
import { verifyTrainingPlanLanguage } from "@/services/ai/language-check";
import {
  fetchAiProfileSnapshot,
  insertTrainingGenerationHistory,
} from "@/services/ai/persistence";
import { TRAINING_PROMPT_VERSION } from "@/services/ai/prompts";
import { aiConfigStatus, requireApiUser, toAiErrorResponse } from "@/app/api/ai/_lib";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  const { supabase, user } = auth;

  let body: z.infer<typeof generateTrainingPlanRequestSchema>;
  try {
    body = generateTrainingPlanRequestSchema.parse(await request.json());
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

  if (
    profile.age <= 0 ||
    profile.height <= 0 ||
    profile.currentWeight <= 0 ||
    profile.targetWeight <= 0 ||
    (body.constraints.weekly_training_days ?? profile.weeklyTrainingDays) <= 0
  ) {
    return toAiErrorResponse(
      new AiServiceError(
        "AI_PROFILE_INCOMPLETE",
        "Please complete your basic profile before generating AI plans.",
      ),
    );
  }

  try {
    const result = await generateTrainingPlanWithDeepSeek({
      profile,
      constraints: body.constraints,
      locale: body.locale,
    });

    const languageCheck = verifyTrainingPlanLanguage(body.locale, result.parsedPlan);
    if (!languageCheck.matched) {
      throw new AiServiceError(
        "AI_LANGUAGE_MISMATCH",
        "AI response language does not match current locale. Please regenerate.",
        languageCheck.detail,
      );
    }

    const generationId = await insertTrainingGenerationHistory(supabase, {
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
    await insertTrainingGenerationHistory(supabase, {
      userId: user.id,
      goalType: body.constraints.goal_type || profile.fitnessGoal,
      profile,
      constraints: { ...body.constraints, locale: body.locale },
      modelName: config?.model || "deepseek-chat",
      promptVersion: TRAINING_PROMPT_VERSION,
      rawResponse: null,
      parsedPlan: null,
      status: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return toAiErrorResponse(error);
  }
}
