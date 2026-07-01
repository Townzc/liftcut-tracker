/**
 * Convert SFT test set (Alpaca format: instruction/input/output) to eval case format
 * (id/task/request) used by eval_ai_provider.ts.
 *
 * Also supports researchExampleSchema format (id/task/instruction/input/output).
 *
 * Usage:
 *   npx tsx research/liftcut-coach/scripts/convert_test_to_eval.ts \
 *     research/liftcut-coach/data/v1/processed/seed_full_splits_v2/test.jsonl \
 *     research/liftcut-coach/data/v1/eval/eval_cases_v2_test.jsonl
 */

import {
  researchExampleSchema,
  readJsonl,
  researchTaskSchema,
  writeJsonl,
} from "./_shared";

import { z } from "zod";

const alpacaRecordSchema = z.object({
  instruction: z.string(),
  input: z.string(),
  output: z.unknown().optional(),
});

function extractTask(instruction: string): z.infer<typeof researchTaskSchema> {
  if (instruction.includes("generate_training_plan")) {
    return "generate_training_plan";
  }
  return "generate_nutrition_plan";
}

async function main(): Promise<void> {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error(
      "Usage: npx tsx convert_test_to_eval.ts <input.jsonl> <output.jsonl>",
    );
    process.exitCode = 2;
    return;
  }

  const lines = await readJsonl(inputPath);
  const evalCases: unknown[] = [];
  let skipped = 0;

  for (const line of lines) {
    if (line.parseError) {
      console.error(
        `Line ${line.lineNumber}: invalid JSON: ${line.parseError}`,
      );
      skipped++;
      continue;
    }

    // Try researchExampleSchema first (has id, task, input)
    const example = researchExampleSchema.safeParse(line.value);
    if (example.success) {
      evalCases.push({
        id: example.data.id ?? `case-${line.lineNumber}`,
        task: example.data.task,
        request: example.data.input,
      });
      continue;
    }

    // Try Alpaca format (instruction, input as JSON string)
    const alpaca = alpacaRecordSchema.safeParse(line.value);
    if (alpaca.success) {
      let parsedInput: unknown;
      try {
        parsedInput = JSON.parse(alpaca.data.input);
      } catch {
        console.error(
          `Line ${line.lineNumber}: input is not valid JSON, skipping`,
        );
        skipped++;
        continue;
      }

      const task = extractTask(alpaca.data.instruction);
      evalCases.push({
        id: `case-${line.lineNumber}`,
        task,
        request: parsedInput,
      });
      continue;
    }

    console.error(
      `Line ${line.lineNumber}: unrecognized format, skipping`,
    );
    skipped++;
  }

  await writeJsonl(outputPath, evalCases);
  console.log(`Converted ${evalCases.length} cases to ${outputPath}`);
  if (skipped > 0) {
    console.log(`Skipped ${skipped} lines`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
