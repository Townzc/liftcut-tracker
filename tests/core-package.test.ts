import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { actualWeightSchema } from "@liftcut/core/workout-values";
import { exerciseLogSchema } from "@liftcut/core/schemas";
import { planKindSchema } from "@liftcut/core/agent-contracts";

const coreSource = join(process.cwd(), "packages/core/src");

test("shared core imports only its own files and zod", () => {
  // The mobile app bundles this package too: no web aliases, framework, server or Node APIs.
  const files = readdirSync(coreSource, { recursive: true, encoding: "utf8" }).filter(f => f.endsWith(".ts"));
  assert.ok(files.length >= 7);
  for (const file of files) {
    const text = readFileSync(join(coreSource, file), "utf8");
    for (const [, specifier] of text.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g))
      assert.ok(specifier === "zod" || specifier.startsWith("./"), `${file} imports ${specifier}`);
  }
});

test("web code resolves shared contracts through the package name", () => {
  assert.equal(actualWeightSchema.parse(""), null);
  assert.equal(exerciseLogSchema.shape.actualReps.parse(undefined), null);
  assert.deepEqual(planKindSchema.options, ["training", "nutrition"]);
});
