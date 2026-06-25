import { readFile, writeFile } from "node:fs/promises";

import { z } from "zod";

import {
  aiLocaleSchema,
  aiNutritionPlanSchema,
  aiProfileSnapshotSchema,
  aiTrainingPlanSchema,
} from "@/lib/ai/schemas";

export const researchTaskSchema = z.enum([
  "generate_training_plan",
  "generate_nutrition_plan",
]);

const jsonObjectSchema = z.record(z.string(), z.unknown());

const researchInputSchema = z.object({
  locale: aiLocaleSchema.default("zh-CN"),
  profile_snapshot: aiProfileSnapshotSchema,
  constraints: jsonObjectSchema.default({}),
});

export const researchRequestCaseSchema = z.object({
  id: z.string().trim().min(1),
  task: researchTaskSchema,
  instruction: z.string().trim().min(1),
  input: researchInputSchema,
});

export const researchExampleSchema = z
  .object({
    id: z.string().trim().min(1).optional(),
    task: researchTaskSchema,
    instruction: z.string().trim().min(1),
    input: researchInputSchema,
    output: z.unknown(),
  })
  .superRefine((value, context) => {
    if (!Object.prototype.hasOwnProperty.call(value, "output")) {
      context.addIssue({
        code: "custom",
        path: ["output"],
        message: "output is required",
      });
    }
  });

export const evalCaseSchema = z.object({
  id: z.string().trim().min(1).optional(),
  task: researchTaskSchema,
  request: z.object({
    locale: aiLocaleSchema.default("zh-CN"),
    profile_snapshot: aiProfileSnapshotSchema,
    constraints: jsonObjectSchema.default({}),
  }),
});

export interface JsonlLine {
  lineNumber: number;
  raw: string;
  value?: unknown;
  parseError?: string;
}

export async function readJsonl(filePath: string): Promise<JsonlLine[]> {
  const text = await readFile(filePath, "utf8");
  return text
    .split(/\r?\n/)
    .map((raw, index) => ({ raw: raw.trim(), lineNumber: index + 1 }))
    .filter((line) => line.raw.length > 0)
    .map((line) => {
      try {
        return {
          ...line,
          value: JSON.parse(line.raw) as unknown,
        };
      } catch (error) {
        return {
          ...line,
          parseError: error instanceof Error ? error.message : String(error),
        };
      }
    });
}

export async function writeJsonl(
  filePath: string,
  values: readonly unknown[],
): Promise<void> {
  const content = values.map((value) => JSON.stringify(value)).join("\n");
  await writeFile(filePath, content ? `${content}\n` : "", "utf8");
}

export function formatZodIssues(
  issues: ReadonlyArray<{ path: PropertyKey[]; message: string }>,
): string[] {
  return issues.map((issue) => {
    const path =
      issue.path.map((segment) => String(segment)).join(".") || "(root)";
    return `${path}: ${issue.message}`;
  });
}

export function validateResearchOutput(
  task: z.infer<typeof researchTaskSchema>,
  output: unknown,
): { success: true } | { success: false; reasons: string[] } {
  const result =
    task === "generate_training_plan"
      ? aiTrainingPlanSchema.safeParse(output)
      : aiNutritionPlanSchema.safeParse(output);

  if (result.success) {
    return { success: true };
  }

  return {
    success: false,
    reasons: formatZodIssues(result.error.issues),
  };
}

export function percent(count: number, total: number): string {
  if (total === 0) {
    return "0.00%";
  }
  return `${((count / total) * 100).toFixed(2)}%`;
}
