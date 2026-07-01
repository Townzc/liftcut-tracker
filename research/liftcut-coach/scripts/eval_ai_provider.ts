import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import {
  aiNutritionPlanRawSchema,
  aiNutritionPlanSchema,
  aiTrainingPlanRawSchema,
  aiTrainingPlanSchema,
  normalizeAiNutritionPlan,
  normalizeAiTrainingPlan,
  type AiNutritionGenerationConstraints,
  type AiTrainingGenerationConstraints,
} from "@/lib/ai/schemas";
import { loadEnvConfig } from "@next/env";
import { callAiProviderForJson } from "@/services/ai/client";
import { getAiProviderConfig } from "@/services/ai/config";
import { AiServiceError } from "@/services/ai/errors";
import {
  buildNutritionPlanPrompt,
  buildTrainingPlanPrompt,
} from "@/services/ai/prompts";

import { evalCaseSchema, formatZodIssues, percent, readJsonl } from "./_shared";

// ── Metrics ──────────────────────────────────────────────────────────────────

interface EvalMetrics {
  total: number;
  jsonParseSuccess: number;
  rawSchemaPass: number;
  normalizedSchemaPass: number;
  finalSchemaPass: number;
  wrapperKeyErrors: number;
  enumErrors: number;
  constraintPass: number;
  latencies: number[];
  totalTokens: number;
}

interface FailedCase {
  id: string;
  task: string;
  stage: string;
  reason: string;
  rawPreview: string;
}

interface CaseResult {
  id: string;
  task: string;
  status: "pass" | "fail";
  stage: string;
  latencyMs: number;
  wrapperKeyError: boolean;
  enumError: boolean;
  constraintIssues: string[];
}

const WRAPPER_KEYS = [
  "nutrition_plan",
  "meal_plan",
  "plan",
  "data",
  "result",
  "output",
] as const;

const VALID_MEAL_TYPES = new Set(["breakfast", "lunch", "dinner", "snack"]);

const VALID_GOAL_TYPES = new Set([
  "fat_loss",
  "muscle_gain",
  "maintenance",
  "recomposition",
]);

// ── Detection helpers ────────────────────────────────────────────────────────

function hasWrapperKey(json: unknown): string[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return [];
  }
  const obj = json as Record<string, unknown>;
  return WRAPPER_KEYS.filter((key) => key in obj);
}

function findEnumErrors(json: unknown): string[] {
  const errors: string[] = [];

  function walk(value: unknown, path: string): void {
    if (!value || typeof value !== "object") return;

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], `${path}[${i}]`);
      }
      return;
    }

    const obj = value as Record<string, unknown>;

    // Check meal_type
    if ("meal_type" in obj && typeof obj.meal_type === "string") {
      if (!VALID_MEAL_TYPES.has(obj.meal_type)) {
        errors.push(`${path}.meal_type="${obj.meal_type}"`);
      }
    }

    // Check goal_type at top level
    if ("goal_type" in obj && typeof obj.goal_type === "string") {
      if (!VALID_GOAL_TYPES.has(obj.goal_type)) {
        errors.push(`${path}.goal_type="${obj.goal_type}"`);
      }
    }

    // Recurse
    for (const [key, val] of Object.entries(obj)) {
      if (key === "meal_type" || key === "goal_type") continue;
      if (val && typeof val === "object") {
        const nextPath = path ? `${path}.${key}` : key;
        walk(val, nextPath);
      }
    }
  }

  walk(json, "");
  return errors;
}

// ── Constraint checks ────────────────────────────────────────────────────────

function checkTrainingConstraints(
  plan: unknown,
  constraints: Record<string, unknown>,
): string[] {
  const issues: string[] = [];
  if (!plan || typeof plan !== "object") return ["plan is not an object"];

  const p = plan as Record<string, unknown>;
  const weeks = Array.isArray(p.weeks) ? p.weeks : [];

  const expectedDays = constraints.weekly_training_days;
  const expectedDuration = constraints.session_duration_minutes;

  for (const week of weeks) {
    if (!week || typeof week !== "object") continue;
    const w = week as Record<string, unknown>;
    const days = Array.isArray(w.days) ? w.days : [];

    if (
      typeof expectedDays === "number" &&
      days.length > expectedDays
    ) {
      issues.push(
        `week ${w.week_number}: ${days.length} days > ${expectedDays}`,
      );
    }

    for (const day of days) {
      if (!day || typeof day !== "object") continue;
      const d = day as Record<string, unknown>;
      const exercises = Array.isArray(d.exercises) ? d.exercises : [];

      if (exercises.length === 0) {
        issues.push(
          `week ${w.week_number} day ${d.day_number}: no exercises`,
        );
      }

      if (
        typeof expectedDuration === "number" &&
        typeof d.estimated_duration_minutes === "number" &&
        d.estimated_duration_minutes > expectedDuration + 15
      ) {
        issues.push(
          `week ${w.week_number} day ${d.day_number}: ${d.estimated_duration_minutes}min > ${expectedDuration + 15}min tolerance`,
        );
      }
    }
  }

  return issues;
}

function checkNutritionConstraints(plan: unknown): string[] {
  const issues: string[] = [];
  if (!plan || typeof plan !== "object") return ["plan is not an object"];

  const p = plan as Record<string, unknown>;

  if (!p.daily_targets || typeof p.daily_targets !== "object") {
    issues.push("missing daily_targets");
  } else {
    const dt = p.daily_targets as Record<string, unknown>;
    if (typeof dt.calories !== "number" || dt.calories < 1200 || dt.calories > 5000) {
      issues.push(`calories=${dt.calories} outside 1200-5000`);
    }
    if (typeof dt.protein_g !== "number" || dt.protein_g < 40 || dt.protein_g > 400) {
      issues.push(`protein_g=${dt.protein_g} outside 40-400`);
    }
  }

  const days = Array.isArray(p.days) ? p.days : [];
  if (days.length === 0) {
    issues.push("days is empty");
  }

  for (const day of days) {
    if (!day || typeof day !== "object") continue;
    const d = day as Record<string, unknown>;
    const meals = Array.isArray(d.meals) ? d.meals : [];
    if (meals.length === 0) {
      issues.push(`day ${d.day_number}: no meals`);
    }
    for (const meal of meals) {
      if (!meal || typeof meal !== "object") continue;
      const m = meal as Record<string, unknown>;
      const foods = Array.isArray(m.foods) ? m.foods : [];
      if (foods.length === 0) {
        issues.push(
          `day ${d.day_number} meal ${m.meal_type}: no foods`,
        );
      }
      if (
        typeof m.meal_type === "string" &&
        !VALID_MEAL_TYPES.has(m.meal_type)
      ) {
        issues.push(
          `day ${d.day_number}: invalid meal_type="${m.meal_type}"`,
        );
      }
    }
  }

  return issues;
}

// ── Summary helpers ──────────────────────────────────────────────────────────

function previewJson(value: unknown, maxLen = 500): string {
  try {
    const text = JSON.stringify(value);
    if (text.length <= maxLen) return text;
    return `${text.slice(0, maxLen)}...(truncated)`;
  } catch {
    return "[unserializable]";
  }
}

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)];
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const [filePath, outputPath] = process.argv.slice(2);
  if (!filePath) {
    console.error(
      "Usage: npm run research:eval -- <eval_cases.jsonl> [output_prefix]",
    );
    console.error(
      "  output_prefix defaults to the eval file path without extension.",
    );
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

  const prefix =
    outputPath ?? filePath.replace(/\.jsonl$/, "");
  const failedPath = `${prefix}.failed.jsonl`;
  const resultsPath = `${prefix}.results.jsonl`;

  const lines = await readJsonl(filePath);
  const metrics: EvalMetrics = {
    total: lines.length,
    jsonParseSuccess: 0,
    rawSchemaPass: 0,
    normalizedSchemaPass: 0,
    finalSchemaPass: 0,
    wrapperKeyErrors: 0,
    enumErrors: 0,
    constraintPass: 0,
    latencies: [],
    totalTokens: 0,
  };
  const failedCases: FailedCase[] = [];
  const caseResults: CaseResult[] = [];

  console.log(
    `Evaluating provider=${config.provider} model=${config.model} cases=${lines.length}`,
  );
  console.log(`Results: ${resultsPath}`);
  console.log(`Failures: ${failedPath}`);
  console.log("---");

  for (const line of lines) {
    const fallbackId = `line-${line.lineNumber}`;

    if (line.parseError) {
      failedCases.push({
        id: fallbackId,
        task: "unknown",
        stage: "input_json",
        reason: `invalid JSON: ${line.parseError}`,
        rawPreview: line.raw.slice(0, 200),
      });
      caseResults.push({
        id: fallbackId,
        task: "unknown",
        status: "fail",
        stage: "input_json",
        latencyMs: 0,
        wrapperKeyError: false,
        enumError: false,
        constraintIssues: [],
      });
      continue;
    }

    const evalCase = evalCaseSchema.safeParse(line.value);
    if (!evalCase.success) {
      failedCases.push({
        id: fallbackId,
        task: "unknown",
        stage: "input_schema",
        reason: formatZodIssues(evalCase.error.issues).join(" | "),
        rawPreview: previewJson(line.value),
      });
      caseResults.push({
        id: fallbackId,
        task: "unknown",
        status: "fail",
        stage: "input_schema",
        latencyMs: 0,
        wrapperKeyError: false,
        enumError: false,
        constraintIssues: [],
      });
      continue;
    }

    const caseId = evalCase.data.id ?? fallbackId;
    const task = evalCase.data.task;
    const startedAt = performance.now();

    try {
      // Build prompt and call AI
      let systemPrompt: string;
      let userPrompt: string;

      if (task === "generate_training_plan") {
        const request = evalCase.data.request;
        const prompt = buildTrainingPlanPrompt(
          request.profile_snapshot,
          request.constraints as AiTrainingGenerationConstraints,
          request.locale,
        );
        systemPrompt = prompt.systemPrompt;
        userPrompt = prompt.userPrompt;
      } else {
        const request = evalCase.data.request;
        const prompt = buildNutritionPlanPrompt(
          request.profile_snapshot,
          request.constraints as AiNutritionGenerationConstraints,
          request.locale,
        );
        systemPrompt = prompt.systemPrompt;
        userPrompt = prompt.userPrompt;
      }

      const response = await callAiProviderForJson({
        systemPrompt,
        userPrompt,
      });
      const latencyMs = performance.now() - startedAt;
      metrics.latencies.push(latencyMs);
      metrics.jsonParseSuccess += 1;

      // Check wrapper keys
      const wrappers = hasWrapperKey(response.json);
      const hasWrapper = wrappers.length > 0;
      if (hasWrapper) {
        metrics.wrapperKeyErrors += 1;
      }

      // Check enum errors in raw JSON
      const enumErrs = findEnumErrors(response.json);
      const hasEnumError = enumErrs.length > 0;
      if (hasEnumError) {
        metrics.enumErrors += 1;
      }

      // Raw schema parse
      const rawSchema =
        task === "generate_training_plan"
          ? aiTrainingPlanRawSchema
          : aiNutritionPlanRawSchema;
      const rawParsed = rawSchema.safeParse(response.json);
      if (rawParsed.success) {
        metrics.rawSchemaPass += 1;
      }

      // Normalize
      let normalized: unknown;
      let normalizeSuccess = false;
      try {
        if (task === "generate_training_plan") {
          if (rawParsed.success) {
            normalized = normalizeAiTrainingPlan(rawParsed.data);
            normalizeSuccess = true;
          }
        } else {
          // Nutrition: try unwrap first
          let json = response.json;
          if (
            json &&
            typeof json === "object" &&
            "nutrition_plan" in json &&
            typeof (json as Record<string, unknown>).nutrition_plan ===
              "object"
          ) {
            json = (json as Record<string, unknown>).nutrition_plan;
          }
          const reParsed = aiNutritionPlanRawSchema.safeParse(json);
          if (reParsed.success) {
            normalized = normalizeAiNutritionPlan(reParsed.data);
            normalizeSuccess = true;
          }
        }
      } catch {
        // normalize failed
      }

      if (normalizeSuccess) {
        metrics.normalizedSchemaPass += 1;
      }

      // Final schema
      let finalPass = false;
      if (normalizeSuccess) {
        const finalSchema =
          task === "generate_training_plan"
            ? aiTrainingPlanSchema
            : aiNutritionPlanSchema;
        const finalResult = finalSchema.safeParse(normalized);
        if (finalResult.success) {
          metrics.finalSchemaPass += 1;
          finalPass = true;
        }
      }

      // Constraint check
      let constraintIssues: string[] = [];
      if (finalPass && normalized) {
        if (task === "generate_training_plan") {
          constraintIssues = checkTrainingConstraints(
            normalized,
            evalCase.data.request.constraints,
          );
        } else {
          constraintIssues = checkNutritionConstraints(normalized);
        }
      } else if (!finalPass) {
        constraintIssues.push("final schema did not pass");
      }

      if (constraintIssues.length === 0) {
        metrics.constraintPass += 1;
      }

      const caseStatus =
        finalPass && constraintIssues.length === 0 ? "pass" : "fail";
      const stage = !rawParsed.success
        ? "raw_schema"
        : !normalizeSuccess
          ? "normalize"
          : !finalPass
            ? "final_schema"
            : constraintIssues.length > 0
              ? "constraints"
              : "ok";

      caseResults.push({
        id: caseId,
        task,
        status: caseStatus,
        stage,
        latencyMs,
        wrapperKeyError: hasWrapper,
        enumError: hasEnumError,
        constraintIssues,
      });

      if (caseStatus === "fail") {
        failedCases.push({
          id: caseId,
          task,
          stage,
          reason: [
            hasWrapper ? `wrapper_keys=[${wrappers.join(",")}]` : "",
            hasEnumError ? `enum_errors=[${enumErrs.join(";")}]` : "",
            ...constraintIssues,
          ]
            .filter(Boolean)
            .join(" | "),
          rawPreview: previewJson(response.json),
        });
      }

      const icon = caseStatus === "pass" ? "✓" : "✗";
      console.log(
        `[${icon}] ${caseId} task=${task} stage=${stage} latency=${Math.round(latencyMs)}ms`,
      );
    } catch (error) {
      const latencyMs = performance.now() - startedAt;
      metrics.latencies.push(latencyMs);

      const reason =
        error instanceof AiServiceError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
            ? error.message
            : String(error);

      // JSON was parsed if we got a schema validation error
      if (
        error instanceof AiServiceError &&
        error.code === "AI_SCHEMA_VALIDATION_FAILED"
      ) {
        metrics.jsonParseSuccess += 1;
      }

      failedCases.push({
        id: caseId,
        task,
        stage: "generation",
        reason,
        rawPreview: "",
      });
      caseResults.push({
        id: caseId,
        task,
        status: "fail",
        stage: "generation",
        latencyMs,
        wrapperKeyError: false,
        enumError: false,
        constraintIssues: [],
      });

      console.log(
        `[✗] ${caseId} task=${task} stage=generation latency=${Math.round(latencyMs)}ms: ${reason}`,
      );
    }
  }

  // ── Write outputs ────────────────────────────────────────────────────────

  await mkdir(dirname(resultsPath), { recursive: true });

  // Results JSONL
  const resultLines = caseResults.map((r) => JSON.stringify(r)).join("\n");
  await appendFile(resultsPath, `${resultLines}\n`, "utf8");

  // Failed JSONL
  if (failedCases.length > 0) {
    const failLines = failedCases.map((f) => JSON.stringify(f)).join("\n");
    await appendFile(failedPath, `${failLines}\n`, "utf8");
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  const { total } = metrics;

  console.log("\n" + "=".repeat(70));
  console.log("LiftCut-Coach Evaluation Summary");
  console.log("=".repeat(70));
  console.log(`Provider:  ${config.provider}`);
  console.log(`Model:     ${config.model}`);
  console.log(`Cases:     ${total}`);
  console.log(`Runtime:   ${Math.round(avg(metrics.latencies) * total / 1000)}s total`);
  console.log("");

  // Markdown table
  console.log("| Metric | Count | Rate |");
  console.log("|--------|------:|-----:|");
  console.log(
    `| JSON parse success | ${metrics.jsonParseSuccess}/${total} | ${percent(metrics.jsonParseSuccess, total)} |`,
  );
  console.log(
    `| Raw schema pass | ${metrics.rawSchemaPass}/${total} | ${percent(metrics.rawSchemaPass, total)} |`,
  );
  console.log(
    `| Normalized schema pass | ${metrics.normalizedSchemaPass}/${total} | ${percent(metrics.normalizedSchemaPass, total)} |`,
  );
  console.log(
    `| Final Zod schema pass | ${metrics.finalSchemaPass}/${total} | ${percent(metrics.finalSchemaPass, total)} |`,
  );
  console.log(
    `| Constraint satisfaction | ${metrics.constraintPass}/${total} | ${percent(metrics.constraintPass, total)} |`,
  );
  console.log(
    `| Wrapper key errors | ${metrics.wrapperKeyErrors}/${total} | ${percent(metrics.wrapperKeyErrors, total)} |`,
  );
  console.log(
    `| Enum errors (meal_type etc.) | ${metrics.enumErrors}/${total} | ${percent(metrics.enumErrors, total)} |`,
  );
  console.log("");

  // Latency stats
  console.log("| Latency | Value |");
  console.log("|---------|------:|");
  console.log(`| Average | ${Math.round(avg(metrics.latencies))}ms |`);
  console.log(`| P50 | ${Math.round(p95(metrics.latencies))}ms |`);
  console.log(`| P95 | ${Math.round(p95(metrics.latencies))}ms |`);
  console.log(
    `| Min | ${metrics.latencies.length > 0 ? Math.round(Math.min(...metrics.latencies)) : 0}ms |`,
  );
  console.log(
    `| Max | ${metrics.latencies.length > 0 ? Math.round(Math.max(...metrics.latencies)) : 0}ms |`,
  );
  console.log("");

  // Per-task breakdown
  const trainingResults = caseResults.filter(
    (r) => r.task === "generate_training_plan",
  );
  const nutritionResults = caseResults.filter(
    (r) => r.task === "generate_nutrition_plan",
  );

  if (trainingResults.length > 0 || nutritionResults.length > 0) {
    console.log("| Task | Total | Pass | Fail | Pass Rate |");
    console.log("|------|------:|-----:|-----:|----------:|");
    if (trainingResults.length > 0) {
      const pass = trainingResults.filter((r) => r.status === "pass").length;
      console.log(
        `| Training | ${trainingResults.length} | ${pass} | ${trainingResults.length - pass} | ${percent(pass, trainingResults.length)} |`,
      );
    }
    if (nutritionResults.length > 0) {
      const pass = nutritionResults.filter((r) => r.status === "pass").length;
      console.log(
        `| Nutrition | ${nutritionResults.length} | ${pass} | ${nutritionResults.length - pass} | ${percent(pass, nutritionResults.length)} |`,
      );
    }
    console.log("");
  }

  // Failure breakdown
  if (failedCases.length > 0) {
    const stageCounts = new Map<string, number>();
    for (const f of failedCases) {
      stageCounts.set(f.stage, (stageCounts.get(f.stage) ?? 0) + 1);
    }
    console.log("Failure breakdown by stage:");
    for (const [stage, count] of stageCounts) {
      console.log(`  ${stage}: ${count}`);
    }
    console.log("");
    console.log(`Failed cases written to: ${failedPath}`);
  }

  console.log(`Detailed results written to: ${resultsPath}`);

  if (failedCases.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
