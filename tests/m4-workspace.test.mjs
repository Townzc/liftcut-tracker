import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, basename, relative, isAbsolute } from "node:path";
import { checkWorkspaceBindings, CORE_EXPORTS } from "../research/m4-parser/scripts/check-workspace.mjs";

function fixture(t, stale = false, missing = false) {
  const root = mkdtempSync(join(tmpdir(), "m4-workspace-"));
  t.after(() => {
    const within = relative(realpathSync(tmpdir()), realpathSync(root));
    assert.ok(within && !within.startsWith("..") && !isAbsolute(within) && basename(root).startsWith("m4-workspace-"));
    rmSync(root, { recursive: true, force: true });
  });
  const repo = join(root, "current"), old = join(root, "old");
  for (const checkout of [repo, old]) {
    mkdirSync(join(checkout, "packages/core/src/eval"), { recursive: true });
    writeFileSync(join(checkout, "package.json"), "{}");
    writeFileSync(join(checkout, "packages/core/package.json"), JSON.stringify({ name: "@liftcut/core", exports: { "./*": "./src/*.ts" } }));
    for (const name of CORE_EXPORTS) {
      if (missing && checkout === old && name === "parse-label-grounding") continue;
      writeFileSync(join(checkout, "packages/core/src", name + ".ts"), "export const fixture = true;\n");
    }
  }
  mkdirSync(join(repo, "node_modules/@liftcut"), { recursive: true });
  symlinkSync(join(stale ? old : repo, "packages/core"), join(repo, "node_modules/@liftcut/core"), "junction");
  for (const dependency of ["tsx", "zod"]) {
    const file = join(repo, "node_modules", dependency, "index.js");
    mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, "module.exports = {};\n");
  }
  return repo;
}

test("M4 preflight resolves the current workspace and records source hashes", t => {
  const result = checkWorkspaceBindings(fixture(t));
  assert.equal(result.verified, true); assert.equal(result.files.length, CORE_EXPORTS.length);
  assert.equal(result.modelCalls, 0); assert.match(result.files[0].sha256, /^[a-f0-9]{64}$/);
});
test("M4 preflight rejects old workspace links even when file bytes match", t => {
  assert.throws(() => checkWorkspaceBindings(fixture(t, true)), /workspace preflight failed/);
});
test("M4 preflight rejects a cached checkout missing newer scoring modules", t => {
  assert.throws(() => checkWorkspaceBindings(fixture(t, true, true)), error =>
    /workspace preflight failed/.test(error.message) && error.cause?.code === "MODULE_NOT_FOUND");
});
