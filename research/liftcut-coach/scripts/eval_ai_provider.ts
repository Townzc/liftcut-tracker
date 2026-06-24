import {
  aiNutritionPlanSchema,
  aiTrainingPlanSchema,
  generateNutritionPlanRequestSchema,
  generateTrainingPlanRequestSchema,
  type AiNutritionPlan,
  type AiTrainingGenerationConstraints,
  type AiTrainingPlan,
} from "@/lib/ai/schemas";
import { loadEnvConfig } from "@next/env";
import { getAiProviderConfig } from "@/services/ai/config";
import { AiServiceError } from "@/services/ai/errors";
import {
  generateStructuredNutritionPlan,
  generateStructuredTrainingPlan,
} from "@/services/ai/provider";

import { evalCaseSchema, percent, readJsonl } from "./_shared";

interface FailedCase {
  id: string;
  reason: string;
}

function checkTrainingConstraints(
  plan: AiTrainingPlan,
  constraints: AiTrainingGenerationConstraints,
): string[] {
  const issues: string[] = [];

  if (plan.weeks.length < 1 || plan.weeks.length > 16) {
    issues.push("weeks must contain 1-16 items");
  }

  for (const week of plan.weeks) {
    if (
      constraints.weekly_training_days !== undefined &&
      week.days.length > constraints.weekly_training_days
    ) {
      issues.push(
        `week ${week.week_number} has ${week.days.length} days, above weekly_training_days=${constraints.weekly_training_days}`,
      );
    }

    for (const day of week.days) {
      if (day.exercises.length === 0) {
        issues.push(
          `week ${week.week_number} day ${day.day_number} has no exercises`,
        );
      }
      if (
        constraints.session_duration_minutes !== undefined &&
        day.estimated_duration_minutes >
          constraints.session_duration_minutes + 15
      ) {
        issues.push(
          `week ${week.week_number} day ${day.day_number} exceeds the session duration tolerance`,
        );
      }
      for (const exercise of day.exercises) {
        if (exercise.target_rpe < 4 || exercise.target_rpe > 10) {
          issues.push(
            `week ${week.week_number} day ${day.day_number} has target_rpe outside 4-10`,
          );
        }
      }
    }
  }

  return issues;
}

function checkNutritionConstraints(plan: AiNutritionPlan): string[] {
  const issues: string[] = [];
  const targets = plan.daily_targets;

  if (!aiNutritionPlanSchema.safeParse(plan).success) {
    issues.push("nutrition plan is outside the strict schema");
  }
  if (targets.calories < 1200 || targets.calories > 5000) {
    issues.push("calories are outside 1200-5000");
  }
  if (targets.protein_g < 40 || targets.protein_g > 400) {
    issues.push("protein_g is outside 40-400");
  }
  if (targets.carbs_g < 30 || targets.carbs_g > 700) {
    issues.push("carbs_g is outside 30-700");
  }
  if (targets.fat_g < 20 || targets.fat_g > 200) {
    issues.push("fat_g is outside 20-200");
  }
  if (targets.water_ml < 1000 || targets.water_ml > 6000) {
    issues.push("water_ml is outside 1000-6000");
  }
  if (plan.days.length === 0) {
    issues.push("days must not be empty");
  }
  if (
    plan.days.some(
      (day) =>
        day.meals.length === 0 ||
        day.meals.some((meal) => meal.foods.length === 0),
    )
  ) {
    issues.push("meals and foods must not be empty");
  }

  return issues;
}

function safeFailureReason(error: unknown): string {
  if (error instanceof AiServiceError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function jsonWasParsed(error: unknown): boolean {
  return (
    error instanceof AiServiceError &&
    error.code === "AI_SCHEMA_VALIDATION_FAILED"
  );
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const [filePath] = process.argv.slice(2);
  if (!filePath) {
    console.error("Usage: npm run research:eval -- <eval_cases.jsonl>");
    process.exitCode = 2;
    return;
  }

  const config = getAiProviderConfig();
  if (!config) {
    console.error(
      "The selected AI provider is not configured. Check .env.local or exported environment variables.",
    );
    process.exitCode = 2;
    return;
  }

  const lines = await readJsonl(filePath);
  const failures: FailedCase[] = [];
  const latencies: number[] = [];
  let jsonParseSuccess = 0;
  let schemaPass = 0;
  let constraintPass = 0;

  console.log(
    `Evaluating provider=${config.provider} model=${config.model} cases=${lines.length}`,
  );

  for (const line of lines) {
    const fallbackId = `line-${line.lineNumber}`;
    if (line.parseError) {
      failures.push({
        id: fallbackId,
        reason: `invalid JSON: ${line.parseError}`,
      });
      continue;
    }

    const evalCase = evalCaseSchema.safeParse(line.value);
    if (!evalCase.success) {
      failures.push({
        id: fallbackId,
        reason: `invalid eval case: ${evalCase.error.message}`,
      });
      continue;
    }

    const caseId = evalCase.data.id ?? fallbackId;
    const startedAt = performance.now();

    try {
      let constraintIssues: string[];

      if (evalCase.data.task === "generate_training_plan") {
        const request = generateTrainingPlanRequestSchema.parse(
          evalCase.data.request,
        );
        const result = await generateStructuredTrainingPlan({
          profile:
            request.profile_snapshot ??
            evalCase.data.request.profile_snapshot,
          constraints: request.constraints,
          locale: request.locale,
          logValidationFailures: false,
        });
        jsonParseSuccess += 1;
        if (!aiTrainingPlanSchema.safeParse(result.parsedPlan).success) {
          throw new Error("training plan failed the strict schema");
        }
        schemaPass += 1;
        constraintIssues = checkTrainingConstraints(
          result.parsedPlan,
          request.constraints,
        );
      } else {
        const request = generateNutritionPlanRequestSchema.parse(
          evalCase.data.request,
        );
        const result = await generateStructuredNutritionPlan({
          profile:
            request.profile_snapshot ??
            evalCase.data.request.profile_snapshot,
          constraints: request.constraints,
          locale: request.locale,
          logValidationFailures: false,
        });
        jsonParseSuccess += 1;
        if (!aiNutritionPlanSchema.safeParse(result.parsedPlan).success) {
          throw new Error("nutrition plan failed the strict schema");
        }
        schemaPass += 1;
        constraintIssues = checkNutritionConstraints(result.parsedPlan);
      }

      if (constraintIssues.length === 0) {
        constraintPass += 1;
        console.log(`[pass] ${caseId}`);
      } else {
        failures.push({
          id: caseId,
          reason: `constraint checks failed: ${constraintIssues.join(" | ")}`,
        });
        console.log(`[fail] ${caseId}: constraint checks failed`);
      }
    } catch (error) {
      if (jsonWasParsed(error)) {
        jsonParseSuccess += 1;
      }
      failures.push({
        id: caseId,
        reason: safeFailureReason(error),
      });
      console.log(`[fail] ${caseId}: ${safeFailureReason(error)}`);
    } finally {
      latencies.push(performance.now() - startedAt);
    }
  }

  const averageLatency =
    latencies.length === 0
      ? 0
      : latencies.reduce((sum, value) => sum + value, 0) / latencies.length;

  console.log("\nLiftCut-Coach provider evaluation");
  console.log(`Provider: ${config.provider}`);
  console.log(`Model: ${config.model}`);
  console.log(`Total cases: ${lines.length}`);
  console.log(
    `JSON parse success: ${jsonParseSuccess}/${lines.length} (${percent(jsonParseSuccess, lines.length)})`,
  );
  console.log(
    `Zod schema pass: ${schemaPass}/${lines.length} (${percent(schemaPass, lines.length)})`,
  );
  console.log(
    `Constraint pass: ${constraintPass}/${lines.length} (${percent(constraintPass, lines.length)})`,
  );
  console.log(`Average latency: ${averageLatency.toFixed(0)} ms`);
  console.log(
    `Failed case ids: ${failures.length > 0 ? failures.map((item) => item.id).join(", ") : "(none)"}`,
  );

  if (failures.length > 0) {
    console.log("\nFailure reasons:");
    for (const failure of failures) {
      console.log(`- ${failure.id}: ${failure.reason}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
