import { NextResponse } from "next/server";
import { z } from "zod";

import { generateNutritionPlanRequestSchema } from "@/lib/ai/schemas";
import { getDeepSeekConfigOptional } from "@/services/ai/config";
import { AiServiceError } from "@/services/ai/errors";
import { generateNutritionPlanWithDeepSeek } from "@/services/ai/generate-nutrition-plan";
import { verifyNutritionPlanLanguage } from "@/services/ai/language-check";
import { insertNutritionGenerationHistory } from "@/services/ai/persistence";
import { NUTRITION_PROMPT_VERSION } from "@/services/ai/prompts";
import {
  aiConfigStatus,
  consumeGuestAiQuotaFromRequest,
  requireApiContext,
  toAiErrorResponse,
} from "@/app/api/ai/_lib";
import {
  assertNutritionProfileComplete,
  resolveAiProfileForRequest,
} from "@/app/api/ai/_profile";

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

  const profileResult = await resolveAiProfileForRequest({
    mode: auth.mode,
    supabase,
    user: auth.user,
    requestProfile: body.profile_snapshot,
  });
  if (profileResult.errorResponse) {
    return profileResult.errorResponse;
  }

  const profile = profileResult.profile;
  if (!profile) {
    return NextResponse.json({ ok: false, error: "PROFILE_LOAD_FAILED" }, { status: 400 });
  }

  try {
    assertNutritionProfileComplete(profile);
  } catch (error) {
    return toAiErrorResponse(error);
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
