import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { z } from "zod";

import { aiProfileSnapshotSchema } from "@/lib/ai/schemas";
import { AiServiceError } from "@/services/ai/errors";
import { fetchAiProfileSnapshot } from "@/services/ai/persistence";
import type { ApiAuthMode } from "@/app/api/ai/_lib";

type AiProfileSnapshot = z.infer<typeof aiProfileSnapshotSchema>;

export function withGuestAiProfileDefaults(
  profile: AiProfileSnapshot | undefined,
  mode: ApiAuthMode,
): AiProfileSnapshot | undefined {
  if (mode !== "guest") {
    return profile;
  }

  const base = profile ?? aiProfileSnapshotSchema.parse({});
  const targetWeightFallback = base.fitnessGoal === "muscle_gain" ? 78 : 70;

  return {
    ...base,
    age: base.age > 0 ? base.age : 30,
    height: base.height > 0 ? base.height : 170,
    currentWeight: base.currentWeight > 0 ? base.currentWeight : 75,
    targetWeight: base.targetWeight > 0 ? base.targetWeight : targetWeightFallback,
    weeklyTrainingDays: base.weeklyTrainingDays > 0 ? base.weeklyTrainingDays : 3,
    calorieTarget: base.calorieTarget > 0 ? base.calorieTarget : 2200,
    proteinTarget: base.proteinTarget > 0 ? base.proteinTarget : 130,
    targetWeeklyLossMin: base.targetWeeklyLossMin > 0 ? base.targetWeeklyLossMin : 0.25,
    targetWeeklyLossMax: base.targetWeeklyLossMax > 0 ? base.targetWeeklyLossMax : 0.75,
    sessionDurationMinutes: base.sessionDurationMinutes > 0 ? base.sessionDurationMinutes : 60,
  };
}

export async function resolveAiProfileForRequest(input: {
  mode: ApiAuthMode;
  supabase: SupabaseClient;
  user: User | null;
  requestProfile?: AiProfileSnapshot;
}): Promise<{ profile: AiProfileSnapshot | null; errorResponse: NextResponse | null }> {
  let profile = input.requestProfile;

  if (input.mode === "authenticated" && input.user) {
    try {
      profile = await fetchAiProfileSnapshot(input.supabase, input.user.id);
    } catch {
      return {
        profile: null,
        errorResponse: NextResponse.json(
          {
            ok: false,
            error: "PROFILE_LOAD_FAILED",
            message: "Failed to load profile settings before AI generation.",
          },
          { status: 500 },
        ),
      };
    }
  }

  profile = withGuestAiProfileDefaults(profile, input.mode);

  if (!profile) {
    return {
      profile: null,
      errorResponse: NextResponse.json(
        {
          ok: false,
          error: "PROFILE_LOAD_FAILED",
          message: "Please complete your profile before generating AI plans.",
        },
        { status: 400 },
      ),
    };
  }

  return { profile, errorResponse: null };
}

export function assertTrainingProfileComplete(profile: AiProfileSnapshot, weeklyTrainingDays: number): void {
  if (
    profile.age <= 0 ||
    profile.height <= 0 ||
    profile.currentWeight <= 0 ||
    profile.targetWeight <= 0 ||
    weeklyTrainingDays <= 0
  ) {
    throw new AiServiceError(
      "AI_PROFILE_INCOMPLETE",
      "Please complete your basic profile before generating AI plans.",
    );
  }
}

export function assertNutritionProfileComplete(profile: AiProfileSnapshot): void {
  if (profile.currentWeight <= 0 || profile.targetWeight <= 0) {
    throw new AiServiceError(
      "AI_PROFILE_INCOMPLETE",
      "Please complete current and target weight before generating nutrition plans.",
    );
  }
}
