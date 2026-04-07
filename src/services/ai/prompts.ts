import type {
  AiLocale,
  AiNutritionGenerationConstraints,
  AiTrainingGenerationConstraints,
} from "@/lib/ai/schemas";
import type { AiProfileSnapshot } from "@/services/ai/types";

export const TRAINING_PROMPT_VERSION = "TRAINING_PROMPT_V1";
export const NUTRITION_PROMPT_VERSION = "NUTRITION_PROMPT_V1";

function getLocaleRequirements(locale: AiLocale): string[] {
  if (locale === "zh-CN") {
    return [
      "Output language must strictly be Simplified Chinese (zh-CN) for all user-facing text fields.",
      "Do not mix English and Chinese unless a proper noun requires it.",
      "In zh-CN mode, summary, reasoning_summary, warnings, week focus, day title, notes, meal title, and food notes must all be Simplified Chinese.",
      "Exercise names should prefer common Chinese names. If needed, include English alias only in notes.",
    ];
  }

  return [
    "Output language must strictly be English for all user-facing text fields.",
    "Do not mix Chinese and English unless a proper noun requires it.",
    "In en mode, summary, warnings, week focus, day title, notes, meal title, and food notes must all be English.",
  ];
}

function getTrainingSchemaExample(locale: AiLocale) {
  if (locale === "zh-CN") {
    return {
      plan_name: "12周减脂力量训练计划",
      goal_type: "fat_loss",
      summary: "这是一个以减脂为主、兼顾力量维持的12周训练计划。",
      reasoning_summary: "考虑每周3练与恢复能力，采用中等训练量并强调动作质量。",
      warnings: ["如出现疼痛，请立即停止相关动作并下调训练负荷。"],
      weeks: [
        {
          week_number: 1,
          focus: "基础动作适应与技术稳定",
          days: [
            {
              day_number: 1,
              title: "下肢与推训练",
              notes: "复合动作保留1到2次余力。",
              estimated_duration_minutes: 60,
              exercises: [
                {
                  name: "杠铃深蹲",
                  sets: 4,
                  rep_range: "5-8",
                  target_rpe: 7,
                  rest_seconds: 120,
                  notes: "优先保证核心稳定与动作深度。",
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
    summary: "A 12-week structured plan for fat loss with strength retention.",
    reasoning_summary: "Moderate volume and stable progression based on schedule and recovery.",
    warnings: ["Stop any movement that causes pain and reduce load conservatively."],
    weeks: [
      {
        week_number: 1,
        focus: "Movement quality and baseline loading",
        days: [
          {
            day_number: 1,
            title: "Lower Body + Push",
            notes: "Keep 1-2 reps in reserve on compound lifts.",
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

function getNutritionSchemaExample(locale: AiLocale) {
  if (locale === "zh-CN") {
    return {
      plan_name: "高蛋白减脂饮食计划",
      goal_type: "fat_loss",
      summary: "以高蛋白和可执行性为优先的日常减脂饮食建议。",
      warnings: ["请根据饥饿感和每周进度微调份量，避免极端节食。"],
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
          notes: "尽量将蛋白质分配到每一餐。",
          meals: [
            {
              meal_type: "breakfast",
              title: "高蛋白燕麦碗",
              foods: [
                {
                  name: "燕麦",
                  amount: "60g",
                  estimated_calories: 230,
                  estimated_protein_g: 8,
                  notes: "可与牛奶或酸奶搭配。",
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
    plan_name: "High-Protein Fat Loss Meal Plan",
    goal_type: "fat_loss",
    summary: "A practical high-protein meal plan optimized for fat loss adherence.",
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
        notes: "Distribute protein evenly across meals.",
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
    "Generate practical plans based on user profile, goal, schedule, location, equipment, experience, and injury constraints.",
    "Do not provide medical diagnosis.",
    "If injury notes exist, choose conservative movements and include clear warnings.",
    "Avoid extreme volume, unrealistic progression, and unsafe prescriptions.",
    "Output must be VALID JSON only. No markdown. No code fences. No extra keys outside schema.",
    ...getLocaleRequirements(locale),
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      task: "Generate a training plan JSON only.",
      locale,
      profile,
      constraints,
      required_output_schema_example: getTrainingSchemaExample(locale),
      hard_requirements: [
        "Keep week/day numbering continuous and valid.",
        "Each day must include at least one exercise.",
        "Use practical exercises aligned with training_location and available_equipment.",
        "When profile data is limited, use conservative assumptions and state them in warnings.",
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
  locale: AiLocale,
): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    "You are a conservative, professional nutrition planning assistant.",
    "Generate realistic, sustainable, executable meal guidance aligned with user goals.",
    "Do not provide medical diagnosis.",
    "Do not produce extreme low-calorie diets.",
    "Respect diet preference and food restrictions strictly.",
    "Output must be VALID JSON only. No markdown. No code fences. No extra keys outside schema.",
    ...getLocaleRequirements(locale),
  ].join(" ");

  const userPrompt = JSON.stringify(
    {
      task: "Generate a nutrition plan JSON only.",
      locale,
      profile,
      constraints,
      required_output_schema_example: getNutritionSchemaExample(locale),
      hard_requirements: [
        "Keep calories and macro ranges realistic.",
        "Prefer high adherence, simple substitutions, and practical daily execution.",
        "Include alternatives for flexibility.",
        "When profile data is limited, use conservative assumptions and state them in warnings.",
      ],
    },
    null,
    2,
  );

  return { systemPrompt, userPrompt };
}
