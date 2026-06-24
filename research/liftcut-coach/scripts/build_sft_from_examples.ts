import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";

import {
  readJsonl,
  researchExampleSchema,
  validateResearchOutput,
  writeJsonl,
} from "./_shared";

interface AlpacaRecord {
  instruction: string;
  input: string;
  output: string;
}

async function main(): Promise<void> {
  const [outputPath, ...inputPaths] = process.argv.slice(2);
  if (!outputPath || inputPaths.length === 0) {
    console.error(
      "Usage: npm run research:build-sft -- <output.jsonl> <examples.jsonl> [more.jsonl...]",
    );
    process.exitCode = 2;
    return;
  }

  const records: AlpacaRecord[] = [];

  for (const inputPath of inputPaths) {
    const lines = await readJsonl(inputPath);
    for (const line of lines) {
      if (line.parseError) {
        throw new Error(
          `${inputPath}:${line.lineNumber} contains invalid JSON: ${line.parseError}`,
        );
      }

      const envelope = researchExampleSchema.safeParse(line.value);
      if (!envelope.success) {
        throw new Error(
          `${inputPath}:${line.lineNumber} has an invalid envelope: ${envelope.error.message}`,
        );
      }

      const output = validateResearchOutput(
        envelope.data.task,
        envelope.data.output,
      );
      if (!output.success) {
        throw new Error(
          `${inputPath}:${line.lineNumber} has an invalid output: ${output.reasons.join(" | ")}`,
        );
      }

      records.push({
        instruction: `${envelope.data.instruction}\nTask: ${envelope.data.task}`,
        input: JSON.stringify(envelope.data.input),
        output: JSON.stringify(envelope.data.output),
      });
    }
  }

  await mkdir(dirname(outputPath), { recursive: true });
  await writeJsonl(outputPath, records);
  console.log(`Wrote ${records.length} LLaMA-Factory Alpaca records to ${outputPath}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
