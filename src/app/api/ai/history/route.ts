import { NextResponse } from "next/server";

import { aiConfigStatus, requireApiUser } from "@/app/api/ai/_lib";

export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  const { supabase, user } = auth;
  const url = new URL(request.url);
  const type = (url.searchParams.get("type") || "all").toLowerCase();
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") || 20)));

  try {
    let trainingHistory: Array<Record<string, unknown>> = [];
    let nutritionHistory: Array<Record<string, unknown>> = [];

    if (type === "all" || type === "training") {
      const { data, error } = await supabase
        .from("ai_training_plan_generations")
        .select("id, goal_type, model_name, prompt_version, status, error_message, parsed_plan_json, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw error;
      }
      trainingHistory = data ?? [];
    }

    if (type === "all" || type === "nutrition") {
      const { data, error } = await supabase
        .from("ai_nutrition_plan_generations")
        .select("id, goal_type, model_name, prompt_version, status, error_message, parsed_plan_json, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw error;
      }
      nutritionHistory = data ?? [];
    }

    return NextResponse.json({
      ok: true,
      aiConfigured: aiConfigStatus().configured,
      training: trainingHistory,
      nutrition: nutritionHistory,
    });
  } catch (error) {
    console.error("[api/ai/history] failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: "AI_HISTORY_FETCH_FAILED",
        message: "Failed to load AI generation history.",
        aiConfigured: aiConfigStatus().configured,
      },
      { status: 500 },
    );
  }
}
