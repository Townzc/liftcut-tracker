import type { AiLocale, AiNutritionPlan, AiTrainingPlan } from "@/lib/ai/schemas";

const CJK_REGEXP = /[\u3400-\u9FFF]/;
const ASCII_WORD_REGEXP = /[A-Za-z]{2,}/g;

function collectTextSample(...values: Array<string | undefined | null>): string[] {
  return values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function scoreChinese(texts: string[]): number {
  if (texts.length === 0) {
    return 0;
  }
  const hits = texts.filter((text) => CJK_REGEXP.test(text)).length;
  return hits / texts.length;
}

function scoreEnglish(texts: string[]): number {
  if (texts.length === 0) {
    return 0;
  }
  const hits = texts.filter((text) => {
    const words = text.match(ASCII_WORD_REGEXP) ?? [];
    return words.length >= 2;
  }).length;
  return hits / texts.length;
}

function summarize(texts: string[]): string {
  return texts.slice(0, 5).join(" | ");
}

export function verifyTrainingPlanLanguage(
  locale: AiLocale,
  plan: AiTrainingPlan,
): { matched: boolean; detail?: string } {
  const sample = collectTextSample(
    plan.plan_name,
    plan.summary,
    plan.reasoning_summary,
    ...plan.warnings,
    ...plan.weeks.map((week) => week.focus),
    ...plan.weeks.flatMap((week) => week.days.map((day) => day.title)),
    ...plan.weeks.flatMap((week) => week.days.map((day) => day.notes)),
  );

  if (sample.length === 0) {
    return { matched: true };
  }

  if (locale === "zh-CN") {
    const zhScore = scoreChinese(sample);
    if (zhScore < 0.5) {
      return {
        matched: false,
        detail: `Expected zh-CN output, but detected low Chinese ratio (${zhScore.toFixed(2)}). sample=${summarize(sample)}`,
      };
    }
  } else {
    const enScore = scoreEnglish(sample);
    if (enScore < 0.5) {
      return {
        matched: false,
        detail: `Expected en output, but detected low English ratio (${enScore.toFixed(2)}). sample=${summarize(sample)}`,
      };
    }
  }

  return { matched: true };
}

export function verifyNutritionPlanLanguage(
  locale: AiLocale,
  plan: AiNutritionPlan,
): { matched: boolean; detail?: string } {
  const sample = collectTextSample(
    plan.plan_name,
    plan.summary,
    ...plan.warnings,
    ...plan.days.map((day) => day.notes),
    ...plan.days.flatMap((day) => day.meals.map((meal) => meal.title)),
    ...plan.days.flatMap((day) => day.meals.flatMap((meal) => meal.foods.map((food) => food.notes))),
  );

  if (sample.length === 0) {
    return { matched: true };
  }

  if (locale === "zh-CN") {
    const zhScore = scoreChinese(sample);
    if (zhScore < 0.5) {
      return {
        matched: false,
        detail: `Expected zh-CN output, but detected low Chinese ratio (${zhScore.toFixed(2)}). sample=${summarize(sample)}`,
      };
    }
  } else {
    const enScore = scoreEnglish(sample);
    if (enScore < 0.5) {
      return {
        matched: false,
        detail: `Expected en output, but detected low English ratio (${enScore.toFixed(2)}). sample=${summarize(sample)}`,
      };
    }
  }

  return { matched: true };
}

