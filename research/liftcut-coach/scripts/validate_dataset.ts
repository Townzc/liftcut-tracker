import { researchExampleSchema, readJsonl, validateResearchOutput } from "./_shared";

interface InvalidRecord {
  line: number;
  reasons: string[];
}

async function main(): Promise<void> {
  const [filePath] = process.argv.slice(2);
  if (!filePath) {
    console.error(
      "Usage: npm run research:validate -- <dataset.jsonl>",
    );
    process.exitCode = 2;
    return;
  }

  const lines = await readJsonl(filePath);
  const invalidRecords: InvalidRecord[] = [];
  let valid = 0;

  for (const line of lines) {
    if (line.parseError) {
      invalidRecords.push({
        line: line.lineNumber,
        reasons: [`invalid JSON: ${line.parseError}`],
      });
      continue;
    }

    const envelope = researchExampleSchema.safeParse(line.value);
    if (!envelope.success) {
      invalidRecords.push({
        line: line.lineNumber,
        reasons: envelope.error.issues.map((issue) => {
          const path =
            issue.path.map((segment) => String(segment)).join(".") || "(root)";
          return `${path}: ${issue.message}`;
        }),
      });
      continue;
    }

    const output = validateResearchOutput(
      envelope.data.task,
      envelope.data.output,
    );
    if (!output.success) {
      invalidRecords.push({
        line: line.lineNumber,
        reasons: output.reasons,
      });
      continue;
    }

    valid += 1;
  }

  console.log("LiftCut-Coach dataset validation");
  console.log(`File: ${filePath}`);
  console.log(`Total: ${lines.length}`);
  console.log(`Valid: ${valid}`);
  console.log(`Invalid: ${invalidRecords.length}`);

  if (invalidRecords.length > 0) {
    console.log("\nInvalid records:");
    for (const record of invalidRecords) {
      console.log(`- line ${record.line}`);
      for (const reason of record.reasons) {
        console.log(`  - ${reason}`);
      }
    }
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
