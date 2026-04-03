import { NextResponse } from "next/server";
import { z } from "zod";

import { saveNutritionPlanRequestSchema } from "@/lib/ai/schemas";
import { saveAiNutritionPlanAsFormalPlan } from "@/services/ai/persistence";
import { requireApiUser } from "@/app/api/ai/_lib";

export async function POST(request: Request) {
  const auth = await requireApiUser();
  if (auth.errorResponse) {
    return auth.errorResponse;
  }

  const { supabase, user } = auth;

  let body: z.infer<typeof saveNutritionPlanRequestSchema>;
  try {
    body = saveNutritionPlanRequestSchema.parse(await request.json());
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

  try {
    const result = await saveAiNutritionPlanAsFormalPlan(supabase, user.id, body.plan, body.activate);

    if (body.generation_id) {
      const { error: updateError } = await supabase
        .from("ai_nutrition_plan_generations")
        .update({
          parsed_plan_json: body.plan,
          status: "success",
          updated_at: new Date().toISOString(),
        })
        .eq("id", body.generation_id)
        .eq("user_id", user.id);
      if (updateError) {
        console.error("[api/ai/save-nutrition-plan] failed to update generation record", updateError);
      }
    }

    return NextResponse.json({
      ok: true,
      planId: result.planId,
      planName: result.planName,
    });
  } catch (error) {
    console.error("[api/ai/save-nutrition-plan] failed", error);
    return NextResponse.json(
      {
        ok: false,
        error: "SAVE_NUTRITION_PLAN_FAILED",
        message: "Failed to save AI nutrition plan.",
      },
      { status: 500 },
    );
  }
}
