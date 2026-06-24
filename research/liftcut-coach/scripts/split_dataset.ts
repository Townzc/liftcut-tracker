import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { readJsonl, writeJsonl } from "./_shared";

const SHUFFLE_SEED = 20260624;

function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function shuffle<T>(values: readonly T[]): T[] {
  const result = [...values];
  const random = createRandom(SHUFFLE_SEED);
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function allocateCounts(total: number, ratios: readonly number[]): number[] {
  const exact = ratios.map((ratio) => ratio * total);
  const counts = exact.map((value) => Math.floor(value));
  let remaining = total - counts.reduce((sum, value) => sum + value, 0);

  const priorities = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  for (let index = 0; index < priorities.length && remaining > 0; index += 1) {
    counts[priorities[index].index] += 1;
    remaining -= 1;
  }

  return counts;
}

async function main(): Promise<void> {
  const [inputPath, outputDirectory, trainText, valText, testText] =
    process.argv.slice(2);
  if (!inputPath || !outputDirectory || !trainText || !valText || !testText) {
    console.error(
      "Usage: npm run research:split -- <input.jsonl> <output_dir> <train> <val> <test>",
    );
    process.exitCode = 2;
    return;
  }

  const ratios = [trainText, valText, testText].map(Number);
  if (
    ratios.some((ratio) => !Number.isFinite(ratio) || ratio < 0 || ratio > 1) ||
    Math.abs(ratios.reduce((sum, value) => sum + value, 0) - 1) > 1e-9
  ) {
    throw new Error("Split ratios must be numbers between 0 and 1 and sum to 1.");
  }

  const lines = await readJsonl(inputPath);
  const invalidLine = lines.find((line) => line.parseError);
  if (invalidLine) {
    throw new Error(
      `Input contains invalid JSON at line ${invalidLine.lineNumber}: ${invalidLine.parseError}`,
    );
  }

  const values = lines.map((line) => line.value);
  const shuffled = shuffle(values);
  const [trainCount, valCount, testCount] = allocateCounts(
    shuffled.length,
    ratios,
  );

  const train = shuffled.slice(0, trainCount);
  const validation = shuffled.slice(trainCount, trainCount + valCount);
  const test = shuffled.slice(
    trainCount + valCount,
    trainCount + valCount + testCount,
  );

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeJsonl(join(outputDirectory, "train.jsonl"), train),
    writeJsonl(join(outputDirectory, "val.jsonl"), validation),
    writeJsonl(join(outputDirectory, "test.jsonl"), test),
  ]);

  console.log("LiftCut-Coach dataset split");
  console.log(`Seed: ${SHUFFLE_SEED}`);
  console.log(`Total: ${shuffled.length}`);
  console.log(`Train: ${train.length}`);
  console.log(`Validation: ${validation.length}`);
  console.log(`Test: ${test.length}`);
  console.log(`Output: ${outputDirectory}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
