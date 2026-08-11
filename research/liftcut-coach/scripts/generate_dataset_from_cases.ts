import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { loadEnvConfig } from "@next/env";
import { z } from "zod";

import {
  aiNutritionPlanSchema,
  aiTrainingPlanSchema,
  generateNutritionPlanRequestSchema,
  generateTrainingPlanRequestSchema,
} from "@/lib/ai/schemas";
import { getAiProviderConfig } from "@/services/ai/config";
import { AiServiceError } from "@/services/ai/errors";
import {
  generateStructuredNutritionPlan,
  generateStructuredTrainingPlan,
} from "@/services/ai/provider";

import {
  formatZodIssues,
  readJsonl,
  researchRequestCaseSchema,
  writeJsonl,
} from "./_shared";

const failedGenerationRecordSchema = z.object({
  id: z.string().trim().min(1),
  task: z.string().trim().min(1),
  status: z.literal("failed"),
  stage: z.enum([
    "input_json",
    "input_schema",
    "generation",
    "output_schema",
  ]),
  reasons: z.array(z.string()),
  latency_ms: z.number().nonnegative(),
  case: z.unknown(),
});

type FailedGenerationRecord = z.infer<typeof failedGenerationRecordSchema>;
type ResearchRequestCase = z.infer<typeof researchRequestCaseSchema>;
type GeneratedExample = ResearchRequestCase & { output: unknown };

function getStringProperty(value: unknown, property: string): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const propertyValue = Reflect.get(value, property);
  return typeof propertyValue === "string" && propertyValue.trim()
    ? propertyValue.trim()
    : null;
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function safeFailureReasons(error: unknown): string[] {
  if (error instanceof AiServiceError) {
    return [`${error.code}: ${error.message}`];
  }
  return [error instanceof Error ? error.message : String(error)];
}

function failureStageForError(error: unknown): FailedGenerationRecord["stage"] {
  if (
    error instanceof AiServiceError &&
    error.code === "AI_SCHEMA_VALIDATION_FAILED"
  ) {
    return "output_schema";
  }
  if (error instanceof z.ZodError) {
    return "input_schema";
  }
  return "generation";
}

function logCase(
  id: string,
  task: string,
  status: "valid" | "failed" | "skipped",
  latencyMs: number,
): void {
  console.log(
    `id=${id} task=${task} status=${status} latency_ms=${Math.round(latencyMs)}`,
  );
}

async function readExistingIds(outputPath: string): Promise<Set<string>> {
  let lines;
  try {
    lines = await readJsonl(outputPath);
  } catch (error) {
    if (isFileNotFound(error)) {
      return new Set();
    }
    throw error;
  }

  const ids = new Set<string>();
  for (const line of lines) {
    if (line.parseError) {
      throw new Error(
        `${outputPath}:${line.lineNumber} contains invalid JSON: ${line.parseError}`,
      );
    }

    const id = getStringProperty(line.value, "id");
    if (!id) {
      throw new Error(
        `${outputPath}:${line.lineNumber} is missing a non-empty id required for resume support`,
      );
    }
    ids.add(id);
  }
  return ids;
}

async function readExistingFailures(
  failedPath: string,
): Promise<Map<string, FailedGenerationRecord>> {
  let lines;
  try {
    lines = await readJsonl(failedPath);
  } catch (error) {
    if (isFileNotFound(error)) {
      return new Map();
    }
    throw error;
  }

  const failures = new Map<string, FailedGenerationRecord>();
  for (const line of lines) {
    if (line.parseError) {
      throw new Error(
        `${failedPath}:${line.lineNumber} contains invalid JSON: ${line.parseError}`,
      );
    }

    const parsed = failedGenerationRecordSchema.safeParse(line.value);
    if (!parsed.success) {
      throw new Error(
        `${failedPath}:${line.lineNumber} has an invalid failure record: ${formatZodIssues(parsed.error.issues).join(" | ")}`,
      );
    }
    failures.set(parsed.data.id, parsed.data);
  }
  return failures;
}

async function persistFailures(
  failedPath: string,
  failures: ReadonlyMap<string, FailedGenerationRecord>,
): Promise<void> {
  await writeJsonl(failedPath, [...failures.values()]);
}

async function appendExample(
  outputPath: string,
  example: GeneratedExample,
): Promise<void> {
  await appendFile(outputPath, `${JSON.stringify(example)}\n`, "utf8");
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const [casesPath, outputPath] = process.argv.slice(2);
  if (!casesPath || !outputPath) {
    console.error(
      "Usage: npm run research:generate -- <cases.jsonl> <output_examples.jsonl>",
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

  const failedPath = `${outputPath}.failed.jsonl`;
  await mkdir(dirname(outputPath), { recursive: true });

  const lines = await readJsonl(casesPath);
  const existingIds = await readExistingIds(outputPath);
  const existingFailures = await readExistingFailures(failedPath);

  let removedStaleFailure = false;
  for (const id of existingIds) {
    removedStaleFailure = existingFailures.delete(id) || removedStaleFailure;
  }
  if (removedStaleFailure) {
    await persistFailures(failedPath, existingFailures);
  }

  let generated = 0;
  let valid = 0;
  let failed = 0;
  let skipped = 0;

  console.log(
    `Generating dataset provider=${config.provider} model=${config.model} total=${lines.length}`,
  );

  for (const line of lines) {
    const fallbackId = `line-${line.lineNumber}`;
    const fallbackTask = getStringProperty(line.value, "task") ?? "unknown";

    if (line.parseError) {
      const failure: FailedGenerationRecord = {
        id: fallbackId,
        task: fallbackTask,
        status: "failed",
        stage: "input_json",
        reasons: [`invalid JSON: ${line.parseError}`],
        latency_ms: 0,
        case: line.raw,
      };
      existingFailures.set(failure.id, failure);
      await persistFailures(failedPath, existingFailures);
      failed += 1;
      logCase(failure.id, failure.task, "failed", 0);
      continue;
    }

    const rawId = getStringProperty(line.value, "id");
    if (rawId && existingIds.has(rawId)) {
      skipped += 1;
      logCase(rawId, fallbackTask, "skipped", 0);
      continue;
    }

    const parsedCase = researchRequestCaseSchema.safeParse(line.value);
    if (!parsedCase.success) {
      const id = rawId ?? fallbackId;
      const failure: FailedGenerationRecord = {
        id,
        task: fallbackTask,
        status: "failed",
        stage: "input_schema",
        reasons: formatZodIssues(parsedCase.error.issues),
        latency_ms: 0,
        case: line.value,
      };
      existingFailures.set(id, failure);
      await persistFailures(failedPath, existingFailures);
      failed += 1;
      logCase(id, failure.task, "failed", 0);
      continue;
    }

    const requestCase = parsedCase.data;
    const startedAt = performance.now();

    try {
      let example: GeneratedExample;

      if (requestCase.task === "generate_training_plan") {
        const request = generateTrainingPlanRequestSchema.parse(
          requestCase.input,
        );
        const result = await generateStructuredTrainingPlan({
          profile:
            request.profile_snapshot ?? requestCase.input.profile_snapshot,
          constraints: request.constraints,
          locale: request.locale,
          logValidationFailures: false,
        });
        generated += 1;

        const output = aiTrainingPlanSchema.safeParse(result.parsedPlan);
        if (!output.success) {
          const latencyMs = performance.now() - startedAt;
          const failure: FailedGenerationRecord = {
            id: requestCase.id,
            task: requestCase.task,
            status: "failed",
            stage: "output_schema",
            reasons: formatZodIssues(output.error.issues),
            latency_ms: Math.round(latencyMs),
            case: requestCase,
          };
          existingFailures.set(requestCase.id, failure);
          await persistFailures(failedPath, existingFailures);
          failed += 1;
          logCase(requestCase.id, requestCase.task, "failed", latencyMs);
          continue;
        }

        example = { ...requestCase, output: output.data };
      } else {
        const request = generateNutritionPlanRequestSchema.parse(
          requestCase.input,
        );
        const result = await generateStructuredNutritionPlan({
          profile:
            request.profile_snapshot ?? requestCase.input.profile_snapshot,
          constraints: request.constraints,
          locale: request.locale,
          logValidationFailures: false,
        });
        generated += 1;

        const output = aiNutritionPlanSchema.safeParse(result.parsedPlan);
        if (!output.success) {
          const latencyMs = performance.now() - startedAt;
          const failure: FailedGenerationRecord = {
            id: requestCase.id,
            task: requestCase.task,
            status: "failed",
            stage: "output_schema",
            reasons: formatZodIssues(output.error.issues),
            latency_ms: Math.round(latencyMs),
            case: requestCase,
          };
          existingFailures.set(requestCase.id, failure);
          await persistFailures(failedPath, existingFailures);
          failed += 1;
          logCase(requestCase.id, requestCase.task, "failed", latencyMs);
          continue;
        }

        example = { ...requestCase, output: output.data };
      }

      await appendExample(outputPath, example);
      existingIds.add(requestCase.id);
      if (existingFailures.delete(requestCase.id)) {
        await persistFailures(failedPath, existingFailures);
      }
      valid += 1;
      logCase(
        requestCase.id,
        requestCase.task,
        "valid",
        performance.now() - startedAt,
      );
    } catch (error) {
      const latencyMs = performance.now() - startedAt;
      const failure: FailedGenerationRecord = {
        id: requestCase.id,
        task: requestCase.task,
        status: "failed",
        stage: failureStageForError(error),
        reasons: safeFailureReasons(error),
        latency_ms: Math.round(latencyMs),
        case: requestCase,
      };
      existingFailures.set(requestCase.id, failure);
      await persistFailures(failedPath, existingFailures);
      failed += 1;
      logCase(requestCase.id, requestCase.task, "failed", latencyMs);
    }
  }

  console.log("\nLiftCut-Coach dataset generation");
  console.log(`total: ${lines.length}`);
  console.log(`generated: ${generated}`);
  console.log(`valid: ${valid}`);
  console.log(`failed: ${failed}`);
  console.log(`skipped: ${skipped}`);
  console.log(`output: ${outputPath}`);
  console.log(`failed_output: ${failedPath}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
