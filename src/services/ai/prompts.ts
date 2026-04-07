import type {
  AiLocale,
  AiNutritionGenerationConstraints,
  AiTrainingGenerationConstraints,
} from "@/lib/ai/schemas";
import type { AiProfileSnapshot } from "@/services/ai/types";

export const TRAINING_PROMPT_VERSION = "TRAINING_PROMPT_V1";
export const NUTRITION_PROMPT_VERSION = "NUTRITION_PROMPT_V1";

function localeRequirements(locale: AiLocale): string[] {
  if (locale === "zh-CN") {
    return [
      "Output language must strictly follow locale zh-CN.",
      "All user-facing text must be Simplified Chinese.",
      "Do not mix English unless a proper noun requires it.",
      "plan_name, summary, reasoning_summary, warnings, week focus, day title, day notes, exercise notes, meal title, and food notes must be Simplified Chinese.",
      "Exercise names should prefer common Chinese names.",
    ];
  }

  return [
    "Output language must strictly follow locale en.",
    "All user-facing text must be English.",
    "Do not mix Chinese unless a proper noun requires it.",
  ];
}

function trainingSchemaExample(locale: AiLocale) {
  if (locale === "zh-CN") {
    return {
      plan_name: "12周减脂力量训练计划",
      goal_type: "fat_loss",
      summary: "以减脂为主并兼顾力量维持的结构化训练计划。",
      reasoning_summary: "结合每周训练频率、恢复能力与可用器械进行保守安排。",
      warnings: ["如出现疼痛请停止相关动作并降低训练负荷。"],
      weeks: [
        {
          week_number: 1,
          focus: "基础动作适应",
          days: [
            {
              day_number: 1,
              title: "上肢推与下肢",
              notes: "复合动作保留1到2次余力。",
              estimated_duration_minutes: 60,
              exercises: [
                {
                  name: "杠铃深蹲",
                  sets: 4,
                  rep_range: "5-8",
                  target_rpe: 7,
                  rest_seconds: 120,
                  notes: "先保证动作标准再提升重量。",
                  alternative_exercises: ["高脚杯深蹲"],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  return {
    plan_name: "12-Week Fat Loss Strength Plan",
    goal_type: "fat_loss",
    summary: "A structured fat-loss plan with strength retention.",
    reasoning_summary: "Conservative programming based on frequency, recovery, and equipment.",
    warnings: ["Stop any movement that causes pain and reduce load."],
    weeks: [
      {
        week_number: 1,
        focus: "Movement quality",
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
                notes: "Prioritize bracing and depth.",
                alternative_exercises: ["Goblet Squat"],
              },
            ],
          },
        ],
      },
    ],
  };
}

function nutritionSchemaExample(locale: AiLocale) {
  if (locale === "zh-CN") {
    return {
      plan_name: "高蛋白减脂饮食计划",
      goal_type: "fat_loss",
      summary: "高蛋白、可执行、便于长期坚持的饮食方案。",
      warnings: ["避免极端低热量饮食，按每周变化微调份量。"],
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
          notes: "蛋白质尽量分配到每一餐。",
          meals: [
            {
              meal_type: "breakfast",
              title: "高蛋白早餐",
              foods: [
                {
                  name: "燕麦",
                  amount: "60g",
                  estimated_calories: 230,
                  estimated_protein_g: 8,
                  notes: "可搭配牛奶或无糖酸奶。",
                  alternatives: ["全麦面包"],
                },
              ],
            },
          ],
        },
      ],
    };
  }

  return {
    plan_name: "High-Protein Fat Loss Nutrition Plan",
    goal_type: "fat_loss",
    summary: "High-adherence meal guidance focused on fat loss.",
    warnings: ["Avoid extreme calorie restriction and adjust portions weekly."],
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
        notes: "Spread protein intake across meals.",
        meals: [
          {
            meal_type: "breakfast",
            title: "Protein breakfast",
            foods: [
              {
                name: "Oats",
                amount: "60g",
                estimated_calories: 230,
                estimated_protein_g: 8,
                notes: "Pair with milk or yogurt.",
                alternatives: ["Whole grain toast"],
              },
            ],
          },
        ],
      },
    ],
  };
}

export function buildTrainingPlanPrompt(
  profile: AiProfileSnapshot,
  constraints: AiTrainingGenerationConstraints,
  locale: AiLocale,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "You are a conservative, professional, executable fitness planning assistant.",
    "Return ONLY valid JSON, no markdown, no code block fences, no prose outside JSON.",
    "Do not output keys outside the required schema.",
    "Do not provide medical diagnosis.",
    "If injury_notes exist, use conservative exercise choices and include warnings.",
    "Avoid extreme training volume and unsafe progression.",
    "All numeric fields must be JSON numbers, not strings.",
    "All list fields must be JSON arrays, not comma-joined strings.",
    ...localeRequirements(locale),
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      task: "Generate a training plan JSON object.",
      locale,
      profile,
      constraints,
      required_fields: [
        "plan_name",
        "goal_type",
        "summary",
        "reasoning_summary",
        "warnings",
        "weeks[].week_number",
        "weeks[].focus",
        "weeks[].days[].day_number",
        "weeks[].days[].title",
        "weeks[].days[].notes",
        "weeks[].days[].estimated_duration_minutes",
        "weeks[].days[].exercises[].name",
        "weeks[].days[].exercises[].sets",
        "weeks[].days[].exercises[].rep_range",
        "weeks[].days[].exercises[].target_rpe",
        "weeks[].days[].exercises[].rest_seconds",
        "weeks[].days[].exercises[].notes",
        "weeks[].days[].exercises[].alternative_exercises",
      ],
      hard_requirements: [
        "weeks must contain at least 1 week.",
        "each week must contain at least 1 day.",
        "each day must contain at least 1 exercise.",
        "sets should be realistic (1-10).",
        "target_rpe should be realistic (4-10).",
      ],
      required_output_schema_example: trainingSchemaExample(locale),
    },
    null,
    2,
  );

  return { systemPrompt, userPrompt };
}

export function buildNutritionPlanPrompt(
  profile: AiProfileSnapshot,
  constraints: AiNutritionGenerationConstraints,
  locale: AiLocale,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "You are a conservative, professional nutrition planning assistant.",
    "Return ONLY valid JSON, no markdown, no code block fences, no prose outside JSON.",
    "Do not output keys outside the required schema.",
    "Do not provide medical diagnosis.",
    "Avoid extreme low-calorie diets.",
    "Respect diet preference and food restrictions.",
    "All numeric fields must be JSON numbers, not strings.",
    "All list fields must be JSON arrays, not comma-joined strings.",
    ...localeRequirements(locale),
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      task: "Generate a nutrition plan JSON object.",
      locale,
      profile,
      constraints,
      required_fields: [
        "plan_name",
        "goal_type",
        "summary",
        "warnings",
        "daily_targets.calories",
        "daily_targets.protein_g",
        "daily_targets.carbs_g",
        "daily_targets.fat_g",
        "daily_targets.water_ml",
        "days[].day_number",
        "days[].notes",
        "days[].meals[].meal_type",
        "days[].meals[].title",
        "days[].meals[].foods[].name",
        "days[].meals[].foods[].amount",
        "days[].meals[].foods[].estimated_calories",
        "days[].meals[].foods[].estimated_protein_g",
        "days[].meals[].foods[].notes",
        "days[].meals[].foods[].alternatives",
      ],
      hard_requirements: [
        "days must contain at least 1 day.",
        "each meal must contain at least 1 food item.",
        "calories and macros should be realistic and executable.",
      ],
      required_output_schema_example: nutritionSchemaExample(locale),
    },
    null,
    2,
  );

  return { systemPrompt, userPrompt };
}
