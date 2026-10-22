import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CORE_EXPORTS = ["parse-label-grounding", "parse-label", "eval/parse-label-eval",
  "parse-label-grounding-v2", "parse-label-roles", "workout-draft-context"];

/** Dependencies may be cached; workspace source must resolve to this checkout.
 * A byte-identical old package is still a stale binding for future changes. */
export function checkWorkspaceBindings(root) {
  const repo = realpathSync(root), localRequire = createRequire(join(repo, "package.json"));
  try {
    const core = realpathSync(join(repo, "packages/core"));
    const files = CORE_EXPORTS.map(name => {
      const expected = realpathSync(join(core, "src", name + ".ts"));
      const actual = realpathSync(localRequire.resolve("@liftcut/core/" + name));
      if (actual !== expected) throw new Error(`Stale workspace binding: @liftcut/core/${name}`);
      return { name, sha256: createHash("sha256").update(readFileSync(actual)).digest("hex") };
    });
    for (const dependency of ["tsx", "zod"]) localRequire.resolve(dependency);
    return { verified: true, files, modelCalls: 0 };
  } catch (cause) {
    throw new Error("M4 workspace preflight failed. Install dependencies for this checkout; do not reuse another checkout's node_modules workspace links.", { cause });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== "--root")) throw new Error("Usage: check-workspace.mjs [--root CHECKOUT]");
  const root = args[1] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  console.log(JSON.stringify(checkWorkspaceBindings(root), null, 2));
}
