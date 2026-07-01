/**
 * Programmatic seed case generator for LiftCut-Coach.
 *
 * Usage:
 *   npx tsx research/liftcut-coach/scripts/generate_seed_cases.ts <output.jsonl> [target_count]
 *
 * Generates diverse training + nutrition plan seed cases by systematically
 * combining goals, experience levels, locales, body profiles, equipment,
 * injuries, diet preferences, and food restrictions.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

// ── Seeded PRNG ─────────────────────────────────────────────────────────────

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffleInPlace<T>(arr: T[], rand: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ── Dimension values ─────────────────────────────────────────────────────────

const GOALS = ["fat_loss", "muscle_gain", "maintenance", "recomposition"] as const;
const EXPERIENCES = ["beginner", "intermediate", "advanced"] as const;
const LOCATIONS = ["gym", "home", "mixed"] as const;
const TRAINING_DAYS = [3, 4, 5, 6] as const;
const LOCALES = ["zh-CN", "en"] as const;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- used as type only
const GENDERS = ["male", "female"] as const;
const SESSION_DURATIONS = [45, 60, 75, 90, 120] as const;
const DIET_PREFS = ["none", "high_protein", "vegetarian", "low_carb", "balanced"] as const;

// ── Profile templates ────────────────────────────────────────────────────────

interface Profile {
  gender: (typeof GENDERS)[number];
  age: number;
  height: number;
  currentWeight: number;
  targetWeight: number;
}

const PROFILES_KG: Profile[] = [
  { gender: "male", age: 18, height: 175, currentWeight: 72, targetWeight: 68 },
  { gender: "male", age: 21, height: 178, currentWeight: 83, targetWeight: 78 },
  { gender: "male", age: 24, height: 180, currentWeight: 88, targetWeight: 80 },
  { gender: "male", age: 28, height: 175, currentWeight: 78, targetWeight: 73 },
  { gender: "male", age: 32, height: 172, currentWeight: 85, targetWeight: 75 },
  { gender: "male", age: 35, height: 180, currentWeight: 90, targetWeight: 82 },
  { gender: "male", age: 40, height: 176, currentWeight: 82, targetWeight: 76 },
  { gender: "male", age: 45, height: 174, currentWeight: 78, targetWeight: 74 },
  { gender: "male", age: 50, height: 173, currentWeight: 80, targetWeight: 75 },
  { gender: "female", age: 18, height: 163, currentWeight: 55, targetWeight: 52 },
  { gender: "female", age: 22, height: 165, currentWeight: 60, targetWeight: 55 },
  { gender: "female", age: 25, height: 168, currentWeight: 65, targetWeight: 58 },
  { gender: "female", age: 30, height: 167, currentWeight: 70, targetWeight: 62 },
  { gender: "female", age: 35, height: 162, currentWeight: 63, targetWeight: 57 },
  { gender: "female", age: 40, height: 165, currentWeight: 68, targetWeight: 62 },
  { gender: "female", age: 45, height: 160, currentWeight: 62, targetWeight: 58 },
  { gender: "female", age: 50, height: 158, currentWeight: 65, targetWeight: 60 },
];

const PROFILES_LBS: Profile[] = [
  { gender: "male", age: 19, height: 177, currentWeight: 165, targetWeight: 155 },
  { gender: "male", age: 22, height: 183, currentWeight: 190, targetWeight: 175 },
  { gender: "male", age: 26, height: 175, currentWeight: 172, targetWeight: 160 },
  { gender: "male", age: 30, height: 180, currentWeight: 200, targetWeight: 185 },
  { gender: "male", age: 34, height: 178, currentWeight: 185, targetWeight: 170 },
  { gender: "male", age: 38, height: 175, currentWeight: 195, targetWeight: 180 },
  { gender: "male", age: 42, height: 182, currentWeight: 210, targetWeight: 195 },
  { gender: "male", age: 48, height: 176, currentWeight: 188, targetWeight: 175 },
  { gender: "male", age: 52, height: 174, currentWeight: 180, targetWeight: 168 },
  { gender: "female", age: 19, height: 165, currentWeight: 125, targetWeight: 118 },
  { gender: "female", age: 23, height: 168, currentWeight: 140, targetWeight: 130 },
  { gender: "female", age: 27, height: 163, currentWeight: 135, targetWeight: 125 },
  { gender: "female", age: 31, height: 170, currentWeight: 155, targetWeight: 142 },
  { gender: "female", age: 35, height: 165, currentWeight: 145, targetWeight: 135 },
  { gender: "female", age: 40, height: 160, currentWeight: 138, targetWeight: 128 },
  { gender: "female", age: 45, height: 167, currentWeight: 150, targetWeight: 140 },
  { gender: "female", age: 50, height: 162, currentWeight: 142, targetWeight: 133 },
];

// ── Equipment ────────────────────────────────────────────────────────────────

const EQUIPMENT_ZH: Record<string, string[][]> = {
  gym: [
    ["杠铃", "哑铃", "龙门架", "腿举机", "高位下拉", "坐姿划船机"],
    ["杠铃", "哑铃", "器械", "椭圆机"],
    ["杠铃", "哑铃", "龙门架", "绳索", "史密斯机"],
    ["杠铃", "哑铃", "腿举机", "腿弯举机", "高位下拉"],
  ],
  home: [
    ["哑铃", "弹力带"],
    ["哑铃", "弹力带", "瑜伽垫"],
    ["哑铃", "壶铃", "弹力带"],
    ["弹力带", "瑜伽垫"],
    ["哑铃", "引体向上杆"],
  ],
  mixed: [
    ["杠铃", "哑铃", "弹力带"],
    ["哑铃", "壶铃", "弹力带", "引体向上杆"],
    ["杠铃", "哑铃", "器械"],
  ],
};

const EQUIPMENT_EN: Record<string, string[][]> = {
  gym: [
    ["barbell", "dumbbell", "cable machine", "leg press", "lat pulldown", "seated row"],
    ["barbell", "dumbbell", "machines", "elliptical"],
    ["barbell", "dumbbell", "cable machine", "smith machine"],
    ["barbell", "dumbbell", "leg press", "leg curl", "lat pulldown"],
  ],
  home: [
    ["dumbbell", "resistance bands"],
    ["dumbbell", "resistance bands", "yoga mat"],
    ["dumbbell", "kettlebell", "resistance bands"],
    ["resistance bands", "yoga mat"],
    ["dumbbell", "pull-up bar"],
  ],
  mixed: [
    ["barbell", "dumbbell", "resistance bands"],
    ["dumbbell", "kettlebell", "resistance bands", "pull-up bar"],
    ["barbell", "dumbbell", "machines"],
  ],
};

// ── Injury / lifestyle / notes templates ─────────────────────────────────────

interface BilingualTemplate {
  zh: string;
  en: string;
}

const INJURIES: BilingualTemplate[] = [
  { zh: "", en: "" },
  { zh: "久坐后腰部轻微酸痛", en: "Mild lower back discomfort after prolonged sitting" },
  { zh: "深蹲时膝盖偶尔不适", en: "Occasional knee discomfort during squats" },
  { zh: "右肩活动度受限", en: "Limited right shoulder mobility" },
  { zh: "左手腕旧伤，弯曲时不适", en: "Old left wrist injury, discomfort when bending" },
  { zh: "颈椎不适，低头时加重", en: "Neck discomfort, worsens when looking down" },
  { zh: "左膝半月板术后恢复中", en: "Recovering from left knee meniscus surgery" },
  { zh: "腰椎间盘突出史，避免过伸", en: "History of lumbar disc herniation, avoid hyperextension" },
  { zh: "右脚踝扭伤恢复期", en: "Recovering from right ankle sprain" },
  { zh: "肩袖损伤史，避免过头动作", en: "Rotator cuff injury history, avoid overhead movements" },
  { zh: "膝盖髌骨软化，避免跳跃", en: "Patellar chondromalacia, avoid jumping" },
  { zh: "高血压，避免憋气和大重量", en: "High blood pressure, avoid breath-holding and heavy loads" },
];

const LIFESTYLES: BilingualTemplate[] = [
  { zh: "", en: "" },
  { zh: "程序员，每天久坐8小时以上", en: "Software developer, sitting 8+ hours daily" },
  { zh: "大学生，作息不太规律", en: "College student, irregular schedule" },
  { zh: "销售工作，经常出差应酬", en: "Sales representative, frequent travel and dining out" },
  { zh: "全职妈妈，时间碎片化", en: "Stay-at-home parent, fragmented schedule" },
  { zh: "倒班工作，睡眠质量一般", en: "Shift worker, average sleep quality" },
  { zh: "自由职业，在家办公，活动量少", en: "Freelancer, working from home, low activity" },
  { zh: "教师，站立时间较长", en: "Teacher, standing most of the day" },
  { zh: "外卖骑手，体力劳动强度大", en: "Delivery rider, high physical demand" },
  { zh: "研究生，经常熬夜写论文", en: "Graduate student, frequent late nights" },
];

const TRAINING_NOTES: BilingualTemplate[] = [
  { zh: "", en: "" },
  { zh: "重点减脂，兼顾力量维持", en: "Focus on fat loss while maintaining strength" },
  { zh: "希望增加肌肉围度", en: "Prioritize muscle hypertrophy" },
  { zh: "改善体态，纠正圆肩驼背", en: "Improve posture, correct rounded shoulders" },
  { zh: "提升运动表现，增强爆发力", en: "Enhance athletic performance and power" },
  { zh: "新手入门，建立训练习惯", en: "Beginner, establish training habits" },
  { zh: "时间有限，追求效率", en: "Limited time, maximize efficiency" },
  { zh: "以复合动作为主", en: "Emphasis on compound movements" },
  { zh: "想加强薄弱部位", en: "Want to strengthen weak areas" },
];

const TRAINING_FOCUSES: BilingualTemplate[] = [
  { zh: "", en: "" },
  { zh: "上肢力量", en: "Upper body strength" },
  { zh: "下肢力量", en: "Lower body strength" },
  { zh: "核心稳定", en: "Core stability" },
  { zh: "背部和肩部", en: "Back and shoulders" },
  { zh: "胸肌和手臂", en: "Chest and arms" },
  { zh: "全身均衡发展", en: "Balanced full-body development" },
  { zh: "臀腿塑形", en: "Glute and leg shaping" },
];

const NUTRITION_NOTES: BilingualTemplate[] = [
  { zh: "", en: "" },
  { zh: "希望食谱简单易做，适合上班族", en: "Prefer simple, quick-to-prepare meals" },
  { zh: "偏好中式家常菜", en: "Prefer home-style cooking" },
  { zh: "希望高蛋白、低碳水", en: "High protein, moderate carbs preferred" },
  { zh: "希望食物种类丰富，不要太单调", en: "Want variety in food choices" },
  { zh: "希望有加餐安排，避免饥饿感", en: "Include snacks to prevent hunger" },
  { zh: "学生党，预算有限", en: "Budget-friendly meals for students" },
  { zh: "便当带饭方便", en: "Meal prep friendly" },
];

const FOOD_RESTRICTIONS: BilingualTemplate[] = [
  { zh: "", en: "" },
  { zh: "乳糖不耐受", en: "Lactose intolerant" },
  { zh: "麸质过敏，避免小麦制品", en: "Gluten allergy, avoid wheat products" },
  { zh: "不吃猪肉", en: "No pork" },
  { zh: "清真饮食", en: "Halal diet" },
  { zh: "海鲜过敏", en: "Seafood allergy" },
  { zh: "素食", en: "Vegetarian" },
  { zh: "坚果过敏", en: "Nut allergy" },
  { zh: "鸡蛋过敏", en: "Egg allergy" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function pick<T>(arr: readonly T[], idx: number): T {
  return arr[((idx % arr.length) + arr.length) % arr.length];
}

function wrapIdx(arr: unknown[], idx: number): number {
  return ((idx % arr.length) + arr.length) % arr.length;
}

interface SeedCase {
  id: string;
  task: string;
  instruction: string;
  input: {
    locale: string;
    profile_snapshot: Record<string, unknown>;
    constraints: Record<string, unknown>;
  };
}

function computeCalorieTarget(profile: Profile, goal: string): number {
  const isMale = profile.gender === "male";
  const bmr = isMale
    ? 10 * profile.currentWeight + 6.25 * profile.height - 5 * profile.age + 5
    : 10 * profile.currentWeight + 6.25 * profile.height - 5 * profile.age - 161;
  const tdee = bmr * 1.4;
  switch (goal) {
    case "fat_loss": return Math.round((tdee - 400) / 10) * 10;
    case "muscle_gain": return Math.round((tdee + 300) / 10) * 10;
    default: return Math.round(tdee / 10) * 10;
  }
}

function computeProteinTarget(profile: Profile, goal: string): number {
  const weightKg = profile.currentWeight < 100 ? profile.currentWeight : Math.round(profile.currentWeight * 0.4536);
  switch (goal) {
    case "fat_loss": return Math.round(weightKg * 2.0);
    case "muscle_gain": return Math.round(weightKg * 2.2);
    default: return Math.round(weightKg * 1.6);
  }
}

function weeklyLoss(goal: string): { min: number; max: number } {
  if (goal === "fat_loss") return { min: 0.3, max: 0.7 };
  if (goal === "recomposition") return { min: 0.1, max: 0.3 };
  return { min: 0, max: 0 };
}

function pickBilingual(templates: BilingualTemplate[], locale: string, idx: number): string {
  const t = pick(templates, idx);
  return locale === "zh-CN" ? t.zh : t.en;
}

// ── Generators ───────────────────────────────────────────────────────────────

function generateTrainingCases(target: number, _rand: () => number): SeedCase[] {
  const cases: SeedCase[] = [];
  let idx = 0;

  while (cases.length < target) {
    for (const goal of GOALS) {
      if (cases.length >= target) break;
      for (const experience of EXPERIENCES) {
        if (cases.length >= target) break;
        for (const location of LOCATIONS) {
          if (cases.length >= target) break;
          for (const days of TRAINING_DAYS) {
            if (cases.length >= target) break;
            for (const locale of LOCALES) {
              if (cases.length >= target) break;

              const profiles = locale === "zh-CN" ? PROFILES_KG : PROFILES_LBS;
              const profile = pick(profiles, idx);
              const equipmentSets = locale === "zh-CN" ? EQUIPMENT_ZH : EQUIPMENT_EN;
              const locationEquipment = equipmentSets[location] ?? equipmentSets.mixed;
              const equipment = locationEquipment[wrapIdx(locationEquipment, idx)];
              const duration = pick(SESSION_DURATIONS, idx);
              const injury = pickBilingual(INJURIES, locale, idx);
              const lifestyle = pickBilingual(LIFESTYLES, locale, idx);
              const note = pickBilingual(TRAINING_NOTES, locale, idx);
              const focus = pickBilingual(TRAINING_FOCUSES, locale, idx);
              const wl = weeklyLoss(goal);
              const calTarget = computeCalorieTarget(profile, goal);
              const protTarget = computeProteinTarget(profile, goal);

              const id = `train_${goal}_${location}_${days}d_${locale.replace("-", "")}_${String(idx).padStart(4, "0")}`;
              const instruction = locale === "zh-CN"
                ? "根据用户资料和约束生成训练计划，必须返回合法 JSON。"
                : "Generate a structured workout plan for LiftCut Tracker. Return JSON only.";

              cases.push({
                id,
                task: "generate_training_plan",
                instruction,
                input: {
                  locale,
                  profile_snapshot: {
                    gender: profile.gender,
                    age: profile.age,
                    height: profile.height,
                    currentWeight: profile.currentWeight,
                    targetWeight: profile.targetWeight,
                    weeklyTrainingDays: days,
                    calorieTarget: calTarget,
                    proteinTarget: protTarget,
                    targetWeeklyLossMin: wl.min,
                    targetWeeklyLossMax: wl.max,
                    fitnessGoal: goal,
                    trainingExperience: experience,
                    trainingLocation: location,
                    availableEquipment: equipment,
                    sessionDurationMinutes: duration,
                    dietPreference: "none",
                    foodRestrictions: "",
                    injuryNotes: injury,
                    lifestyleNotes: lifestyle,
                  },
                  constraints: {
                    goal_type: goal,
                    weekly_training_days: days,
                    session_duration_minutes: duration,
                    training_location: location,
                    preferred_focus: focus,
                    notes: note,
                  },
                },
              });
              idx++;
            }
          }
        }
      }
    }
  }

  return cases.slice(0, target);
}

function generateNutritionCases(target: number, _rand: () => number): SeedCase[] {
  const cases: SeedCase[] = [];
  let idx = 0;

  while (cases.length < target) {
    for (const goal of GOALS) {
      if (cases.length >= target) break;
      for (const dietPref of DIET_PREFS) {
        if (cases.length >= target) break;
        for (const foodRestriction of FOOD_RESTRICTIONS) {
          if (cases.length >= target) break;
          for (const locale of LOCALES) {
            if (cases.length >= target) break;

            const profiles = locale === "zh-CN" ? PROFILES_KG : PROFILES_LBS;
            const profile = pick(profiles, idx);
            const injury = pick(INJURIES, idx);
            const lifestyle = pick(LIFESTYLES, idx);
            const note = pick(NUTRITION_NOTES, idx);
            const wl = weeklyLoss(goal);
            const calTarget = computeCalorieTarget(profile, goal);
            const protTarget = computeProteinTarget(profile, goal);

            const days = pick(TRAINING_DAYS, idx);
            const experience = pick(EXPERIENCES, idx);
            const location = pick(LOCATIONS, idx);
            const duration = pick(SESSION_DURATIONS, idx);
            const equipmentSets = locale === "zh-CN" ? EQUIPMENT_ZH : EQUIPMENT_EN;
            const locationEquipment = equipmentSets[location] ?? equipmentSets.mixed;
            const equipment = locationEquipment[wrapIdx(locationEquipment, idx)];

            const id = `nutr_${goal}_${dietPref}_${locale.replace("-", "")}_${String(idx).padStart(4, "0")}`;
            const instruction = locale === "zh-CN"
              ? "根据用户资料和约束生成饮食计划，必须返回合法 JSON。"
              : "Generate a structured nutrition plan for LiftCut Tracker. Return JSON only.";

            const frText = locale === "zh-CN" ? foodRestriction.zh : foodRestriction.en;
            const injText = locale === "zh-CN" ? injury.zh : injury.en;
            const lifeText = locale === "zh-CN" ? lifestyle.zh : lifestyle.en;
            const noteText = locale === "zh-CN" ? note.zh : note.en;

            cases.push({
              id,
              task: "generate_nutrition_plan",
              instruction,
              input: {
                locale,
                profile_snapshot: {
                  gender: profile.gender,
                  age: profile.age,
                  height: profile.height,
                  currentWeight: profile.currentWeight,
                  targetWeight: profile.targetWeight,
                  weeklyTrainingDays: days,
                  calorieTarget: calTarget,
                  proteinTarget: protTarget,
                  targetWeeklyLossMin: wl.min,
                  targetWeeklyLossMax: wl.max,
                  fitnessGoal: goal,
                  trainingExperience: experience,
                  trainingLocation: location,
                  availableEquipment: equipment,
                  sessionDurationMinutes: duration,
                  dietPreference: dietPref,
                  foodRestrictions: frText,
                  injuryNotes: injText,
                  lifestyleNotes: lifeText,
                },
                constraints: {
                  goal_type: goal,
                  diet_preference: dietPref,
                  food_restrictions: frText,
                  notes: noteText,
                },
              },
            });
            idx++;
          }
        }
      }
    }
  }

  return cases.slice(0, target);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const [outputPath, countArg] = process.argv.slice(2);
  if (!outputPath) {
    console.error("Usage: npx tsx generate_seed_cases.ts <output.jsonl> [target_count]");
    process.exitCode = 2;
    return;
  }

  const totalCount = Number(countArg) || 3000;
  const trainingCount = Math.ceil(totalCount / 2);
  const nutritionCount = totalCount - trainingCount;

  const rand = createRandom(20260626);

  console.log(`Generating ${totalCount} seed cases (${trainingCount} training + ${nutritionCount} nutrition)...`);

  const trainingCases = generateTrainingCases(trainingCount, rand);
  const nutritionCases = generateNutritionCases(nutritionCount, rand);

  const allCases = [...trainingCases, ...nutritionCases];
  shuffleInPlace(allCases, rand);

  await mkdir(dirname(outputPath), { recursive: true });
  const lines = allCases.map((c) => JSON.stringify(c)).join("\n");
  await appendFile(outputPath, `${lines}\n`, "utf8");

  // Stats
  const tasks = { training: 0, nutrition: 0 };
  const localeCounts = new Map<string, number>();
  const goalCounts = new Map<string, number>();

  for (const c of allCases) {
    tasks[c.task === "generate_training_plan" ? "training" : "nutrition"]++;
    localeCounts.set(c.input.locale, (localeCounts.get(c.input.locale) ?? 0) + 1);
    const goal = (c.input.profile_snapshot.fitnessGoal as string) ?? "unknown";
    goalCounts.set(goal, (goalCounts.get(goal) ?? 0) + 1);
  }

  console.log(`\nSeed case generation complete`);
  console.log(`Total: ${allCases.length}`);
  console.log(`Training: ${tasks.training}`);
  console.log(`Nutrition: ${tasks.nutrition}`);
  console.log(`\nBy locale:`);
  for (const [locale, count] of localeCounts) {
    console.log(`  ${locale}: ${count}`);
  }
  console.log(`\nBy goal:`);
  for (const [goal, count] of goalCounts) {
    console.log(`  ${goal}: ${count}`);
  }
  console.log(`\nOutput: ${outputPath}`);
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
    console.error(error.stack);
  } else {
    console.error(String(error));
  }
  process.exitCode = 1;
});
