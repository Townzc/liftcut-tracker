import { NextResponse } from "next/server";

import { aiConfigStatus, requireApiContext } from "@/app/api/ai/_lib";

export async function GET(request: Request) {
  const auth = await requireApiContext(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  if (auth.mode === "guest") {
    return NextResponse.json({
      ok: true,
      aiConfigured: aiConfigStatus().configured,
      training: [],
      nutrition: [],
      mode: "guest",
    });
  }

  const { supabase, user } = auth;
  if (!user) {
    return NextResponse.json(
      {
        ok: false,
        error: "UNAUTHORIZED",
        message: "You need to sign in before using AI history.",
      },
      { status: 401 },
    );
  }

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

export async function DELETE(request: Request) {
  const auth = await requireApiContext(request);
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  if (auth.mode !== "authenticated" || !auth.user) {
    return NextResponse.json(
      {
        ok: false,
        error: "GUEST_HISTORY_LOCAL_ONLY",
        message: "Guest history is stored locally and should be deleted on the client.",
      },
      { status: 400 },
    );
  }

  const { supabase, user } = auth;
  const url = new URL(request.url);
  const type = (url.searchParams.get("type") || "").toLowerCase();
  const id = url.searchParams.get("id");

  if (!["training", "nutrition", "all"].includes(type)) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_REQUEST",
        message: "Invalid type. Use training | nutrition | all.",
      },
      { status: 400 },
    );
  }

  try {
    if (type === "training") {
      if (id) {
        const { error } = await supabase
          .from("ai_training_plan_generations")
          .delete()
          .eq("id", id)
          .eq("user_id", user.id);
        if (error) {
          throw error;
        }
      } else {
        const { error } = await supabase
          .from("ai_training_plan_generations")
          .delete()
          .eq("user_id", user.id);
        if (error) {
          throw error;
        }
      }
    }

    if (type === "nutrition") {
      if (id) {
        const { error } = await supabase
          .from("ai_nutrition_plan_generations")
          .delete()
          .eq("id", id)
          .eq("user_id", user.id);
        if (error) {
          throw error;
        }
      } else {
        const { error } = await supabase
          .from("ai_nutrition_plan_generations")
          .delete()
          .eq("user_id", user.id);
        if (error) {
          throw error;
        }
      }
    }

    if (type === "all") {
      const { error: trainingError } = await supabase
        .from("ai_training_plan_generations")
        .delete()
        .eq("user_id", user.id);
      if (trainingError) {
        throw trainingError;
      }

      const { error: nutritionError } = await supabase
        .from("ai_nutrition_plan_generations")
        .delete()
        .eq("user_id", user.id);
      if (nutritionError) {
        throw nutritionError;
      }
    }

    return NextResponse.json({
      ok: true,
      type,
      id: id ?? null,
    });
  } catch (error) {
    console.error("[api/ai/history] delete failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: "AI_HISTORY_DELETE_FAILED",
        message: "Failed to delete AI generation history.",
      },
      { status: 500 },
    );
  }
}
