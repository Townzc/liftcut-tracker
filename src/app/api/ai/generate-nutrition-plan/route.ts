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
import {
  aiConfigStatus,
  consumeGuestAiQuotaFromRequest,
  requireApiContext,
  toAiErrorResponse,
} from "@/app/api/ai/_lib";

export async function POST(request: Request) {
  const auth = await requireApiContext(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  const { supabase } = auth;

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

  let profile = body.profile_snapshot;
  if (auth.mode === "authenticated" && auth.user) {
    try {
      profile = await fetchAiProfileSnapshot(supabase, auth.user.id);
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
  }

  if (!profile) {
    return NextResponse.json(
      {
        ok: false,
        error: "PROFILE_LOAD_FAILED",
        message: "Please complete your profile before generating AI plans.",
      },
      { status: 400 },
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

  let quotaToken = null;
  try {
    quotaToken = await consumeGuestAiQuotaFromRequest(request, auth.mode);
  } catch (error) {
    return toAiErrorResponse(error);
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

    let generationId: string | null = null;
    if (auth.mode === "authenticated" && auth.user) {
      generationId = await insertNutritionGenerationHistory(supabase, {
        userId: auth.user.id,
        goalType: body.constraints.goal_type || profile.fitnessGoal,
        profile,
        constraints: { ...body.constraints, locale: body.locale },
        modelName: result.modelName,
        promptVersion: result.promptVersion,
        rawResponse: result.rawResponse,
        parsedPlan: result.parsedPlan,
        status: "success",
      });
    }

    const response = NextResponse.json({
      ok: true,
      aiConfigured: aiConfigStatus().configured,
      mode: auth.mode,
      generationId,
      model: result.modelName,
      promptVersion: result.promptVersion,
      plan: result.parsedPlan,
      guestQuota:
        auth.mode === "guest" && quotaToken
          ? { used: quotaToken.used, remaining: quotaToken.remaining, limit: 10 }
          : undefined,
    });
    quotaToken?.apply(response);
    return response;
  } catch (error) {
    if (auth.mode === "authenticated" && auth.user) {
      const config = getDeepSeekConfigOptional();
      await insertNutritionGenerationHistory(supabase, {
        userId: auth.user.id,
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
    }

    const response = toAiErrorResponse(error);
    quotaToken?.apply(response);
    return response;
  }
}
