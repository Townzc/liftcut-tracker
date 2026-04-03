import type {
  AiNutritionGenerationConstraints,
  AiTrainingGenerationConstraints,
} from "@/lib/ai/schemas";
import type { AiProfileSnapshot } from "@/services/ai/types";

export const TRAINING_PROMPT_VERSION = "TRAINING_PROMPT_V1";
export const NUTRITION_PROMPT_VERSION = "NUTRITION_PROMPT_V1";

export function buildTrainingPlanPrompt(
  profile: AiProfileSnapshot,
  constraints: AiTrainingGenerationConstraints,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "You are a conservative, practical fitness programming assistant.",
    "Generate safe and executable training plans based on the user's profile and constraints.",
    "Never output markdown or code fences.",
    "Output ONLY valid JSON that matches the requested schema. No extra keys.",
    "Do not provide medical diagnosis.",
    "If injury notes exist, use conservative exercise choices and include warnings.",
    "Avoid extreme volume, avoid impossible progression, and keep recommendations realistic.",
    "Each day must include at least one exercise.",
  ].join(" ");

  const schemaExample = {
    plan_name: "12-Week Fat Loss Strength Plan",
    goal_type: "fat_loss",
    summary: "Structured 12-week plan focused on fat loss and strength maintenance.",
    reasoning_summary: "Kept 3 days/week with moderate volume due to limited schedule.",
    warnings: ["Stop any movement that causes pain and adjust load conservatively."],
    weeks: [
      {
        week_number: 1,
        focus: "Movement quality and baseline loading",
        days: [
          {
            day_number: 1,
            title: "Lower + Push",
            notes: "Keep 1-2 reps in reserve.",
            estimated_duration_minutes: 60,
            exercises: [
              {
                name: "Back Squat",
                sets: 4,
                rep_range: "5-8",
                target_rpe: 7,
                rest_seconds: 120,
                notes: "Prioritize depth and bracing.",
                alternative_exercises: ["Goblet Squat"],
              },
            ],
          },
        ],
      },
    ],
  };

  const userPrompt = JSON.stringify(
    {
      task: "Generate a training plan JSON only.",
      profile,
      constraints,
      required_output_schema: schemaExample,
      requirements: [
        "Keep week/day numbering continuous and valid.",
        "Use practical exercises based on training_location and available_equipment.",
        "When data is missing, make conservative assumptions and mention them in warnings.",
        "RPE should remain in a realistic range.",
      ],
    },
    null,
    2,
  );

  return { systemPrompt, userPrompt };
}

export function buildNutritionPlanPrompt(
  profile: AiProfileSnapshot,
  constraints: AiNutritionGenerationConstraints,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "You are a conservative, practical nutrition planning assistant.",
    "Generate realistic, sustainable meal plans aligned with the user's goals.",
    "Never output markdown or code fences.",
    "Output ONLY valid JSON that matches the requested schema. No extra keys.",
    "Do not provide medical diagnosis.",
    "Never output extreme dieting recommendations.",
    "Respect diet preference and food restrictions strictly.",
  ].join(" ");

  const schemaExample = {
    plan_name: "High-Protein Fat Loss Meal Plan",
    goal_type: "fat_loss",
    summary: "A practical high-protein meal plan for fat loss.",
    warnings: ["Adjust portions based on hunger and weekly progress."],
    daily_targets: {
      calories: 2200,
      protein_g: 160,
      carbs_g: 220,
      fat_g: 60,
      water_ml: 2500,
    },
    days: [
      {
        day_number: 1,
        notes: "Distribute protein across meals.",
        meals: [
          {
            meal_type: "breakfast",
            title: "Protein oatmeal bowl",
            foods: [
              {
                name: "Oats",
                amount: "60g",
                estimated_calories: 230,
                estimated_protein_g: 8,
                notes: "",
                alternatives: ["Whole grain toast"],
              },
            ],
          },
        ],
      },
    ],
  };

  const userPrompt = JSON.stringify(
    {
      task: "Generate a nutrition plan JSON only.",
      profile,
      constraints,
      required_output_schema: schemaExample,
      requirements: [
        "Keep calories and macros in realistic ranges.",
        "Prefer high-protein and easy-to-execute meals.",
        "Provide alternatives for food flexibility.",
        "When data is missing, use conservative defaults and add warnings.",
      ],
    },
    null,
    2,
  );

  return { systemPrompt, userPrompt };
}
