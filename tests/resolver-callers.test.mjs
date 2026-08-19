// Two resolvers differ by name alone: resolveDepositionStorageRoot resolves without judging, and
// depositionStorageRoot enforces. A future caller reaching for the wrong one is a silent unguarded
// write path, which is the condition the enforcement change exists to eliminate.
//
// This reads the source rather than the behaviour, which is normally the wrong instinct -- but the
// property being protected IS a property of the call graph, and there is no runtime observation
// that distinguishes "nothing else calls it" from "nothing else called it during this test".
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", ".git", ".next", "dist", ".venv-pedalboard", ".wrangler"]);

// A git worktree checked out inside the repo is a second copy of every source file, which would
// show up as a duplicate caller and fail this test for the wrong reason. Skipped by MECHANISM --
// a worktree always carries a .git entry at its root -- rather than by directory name. A name in
// the SKIP list would be a hole: any future path called ".verify-staged" would become invisible
// to the scan, which is the opposite of what a guard against unguarded callers should do.
const isNestedCheckout = directory => fs.existsSync(path.join(directory, ".git"));

function sourceFiles(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes:true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (isNestedCheckout(full)) continue; found.push(...sourceFiles(full)); }
    else if (/\.(mjs|js|ts|tsx)$/.test(entry.name)) found.push(full);
  }
  return found;
}

test("resolveDepositionStorageRoot has exactly one caller", () => {
  const callers = [];
  for (const file of sourceFiles(root)) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    if (relative === "server/storage-config.mjs") continue;               // where it is defined
    if (relative.startsWith("tests/")) continue;                          // tests may name it freely
    const source = fs.readFileSync(file, "utf8");
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      if (/\bresolveDepositionStorageRoot\b/.test(line)) callers.push(`${relative}:${index + 1}`);
    }
  }
  // Two lines in one file: the import and the call. One caller.
  assert.deepEqual(
    [...new Set(callers.map(entry => entry.split(":")[0]))],
    ["scripts/local-status.mjs"],
    `resolveDepositionStorageRoot does not enforce the sync-root refusal. A new caller is an unguarded path. Found: ${callers.join(", ")}`,
  );
});

test("nothing outside storage-config resolves the deposition root by hand", () => {
  // The other way the guard gets bypassed: rebuilding path.join(homedir(), "depos") in place
  // rather than calling either resolver.
  const offenders = [];
  for (const file of sourceFiles(root)) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    if (relative === "server/storage-config.mjs" || relative.startsWith("tests/")) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      if (/homedir\(\)[^)]*["'`]depos["'`]|["'`]depos["'`][^)]*homedir\(\)/.test(line)) offenders.push(`${relative}:${index + 1}`);
    }
  }
  assert.deepEqual(offenders, [], `the deposition root must come from storage-config.mjs so it is classified: ${offenders.join(", ")}`);
});
