// The guard that classifies a storage root is only worth having if something refuses to write to
// a bad one. Before this suite existed, classifyStorageRoot had exactly one caller -- a status
// script the reporter had to remember to run -- so a deposition root under OneDrive was detected
// by nobody at the moment it mattered.
//
// The paths here are the real ones on the machine this was written on, including the actual
// OneDrive mirror, because a synthetic path proves the string comparison and not the mechanism.
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { ALLOW_SYNCED_ROOT } from "../server/storage-safety.mjs";
import { assertStorageRootIsLocal, depositionStorageRoot, resolveDepositionStorageRoot } from "../server/storage-config.mjs";
import { formatterRoot } from "../server/insertion-pages/word-service.mjs";

const SYNCED_HOME = String.raw`C:\Users\pat\OneDrive`;
const environment = extra => ({ OneDrive:SYNCED_HOME, ...extra });

test("a deposition root inside a sync client's root is refused", () => {
  assert.throws(
    () => depositionStorageRoot(environment({ DEPO_PRO_DEPOSITIONS_ROOT:String.raw`C:\Users\pat\OneDrive\Documents 1\ChatGPT\Depo-Pro-New` })),
    error => {
      assert.match(error.message, /not safe for evidentiary storage/);
      assert.match(error.message, /SYNCED_STORAGE_ROOT/);
      assert.match(error.message, /OneDrive/);
      assert.match(error.message, /Depo-Pro-New/);
      return true;
    },
  );
});

test("a local deposition root on the same machine is accepted", () => {
  const root = String.raw`C:\Users\pat\depos`;
  assert.equal(depositionStorageRoot(environment({ DEPO_PRO_DEPOSITIONS_ROOT:root })), path.resolve(root));
});

test("a UNC deposition root is refused", () => {
  assert.throws(
    () => depositionStorageRoot(environment({ DEPO_PRO_DEPOSITIONS_ROOT:String.raw`\\server\evidence\depos` })),
    /REMOTE_STORAGE_ROOT/,
  );
});

test("the default root derived from the home directory is checked too, not only the override", () => {
  // The override is the obvious way in. The default is the one that changes underneath you when
  // OneDrive's Known Folder Move redirects a profile directory.
  assert.throws(
    () => depositionStorageRoot(environment({}), () => String.raw`C:\Users\pat\OneDrive`),
    /SYNCED_STORAGE_ROOT/,
  );
});

test("the formatter root is refused on the same terms", () => {
  assert.throws(
    () => assertStorageRootIsLocal(String.raw`C:\Users\pat\OneDrive\transcript_formatter`, "The transcript formatter root", environment()),
    error => {
      assert.match(error.message, /transcript formatter root/);
      assert.match(error.message, /SYNCED_STORAGE_ROOT/);
      return true;
    },
  );
});

test("a local formatter root is accepted", () => {
  const root = String.raw`C:\Users\pat\transcript_formatter`;
  assert.equal(assertStorageRootIsLocal(root, "The transcript formatter root", environment()), root);
});

test("the override downgrades the refusal to a warning rather than silencing it", () => {
  const root = String.raw`C:\Users\pat\OneDrive\depos-acknowledged`;
  const warnings = [], original = console.warn;
  console.warn = message => warnings.push(String(message));
  try {
    assert.equal(
      depositionStorageRoot(environment({ DEPO_PRO_DEPOSITIONS_ROOT:root, [ALLOW_SYNCED_ROOT]:"1" })),
      path.resolve(root),
    );
  } finally { console.warn = original; }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /SYNCED_STORAGE_ROOT/);
  assert.match(warnings[0], /OneDrive/);
  assert.match(warnings[0], new RegExp(ALLOW_SYNCED_ROOT));
});

test("the override is scoped to the root it was set for, not to every root afterwards", () => {
  // The verdict is memoised. If the cache key ignored the environment, acknowledging one root
  // would silently acknowledge the next one.
  const acknowledged = String.raw`C:\Users\pat\OneDrive\depos-scoped`;
  const original = console.warn;
  console.warn = () => {};
  try { depositionStorageRoot(environment({ DEPO_PRO_DEPOSITIONS_ROOT:acknowledged, [ALLOW_SYNCED_ROOT]:"1" })); }
  finally { console.warn = original; }
  assert.throws(
    () => depositionStorageRoot(environment({ DEPO_PRO_DEPOSITIONS_ROOT:acknowledged })),
    /SYNCED_STORAGE_ROOT/,
  );
});

test("the formatter root the renderer is actually handed is the checked one", () => {
  // Asserted through word-service's own resolver rather than the helper, so removing the check
  // from the path that reaches the Python renderer fails here.
  assert.throws(
    () => formatterRoot(environment({ DEPO_PRO_FORMATTER_ROOT:String.raw`C:\Users\pat\OneDrive\transcript_formatter` })),
    /SYNCED_STORAGE_ROOT/,
  );
  assert.equal(
    formatterRoot(environment({ DEPO_PRO_FORMATTER_ROOT:String.raw`C:\Users\pat\formatter` })),
    path.resolve(String.raw`C:\Users\pat\formatter`),
  );
});

test("the status script reports on an unsafe root instead of dying on it", () => {
  // The first version of this change routed local-status.mjs through the enforcing resolver, so
  // `npm run status` exited with an unhandled exception in exactly the case it exists to explain.
  // The reporter got a stack trace where the diagnostic belonged.
  const result = spawnSync(process.execPath, ["scripts/local-status.mjs"], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, DEPO_PRO_DEPOSITIONS_ROOT: String.raw`C:\Users\pat\OneDrive\depos`, OneDrive: SYNCED_HOME },
  });
  assert.doesNotMatch(result.stderr, /throw new Error|at assertStorageRootIsLocal/, "status must not crash on an unsafe root");
  assert.match(result.stderr, /SYNCED_STORAGE_ROOT/);
  const report = JSON.parse(result.stdout);
  assert.equal(report.depositionsStorage.synced, true);
  assert.equal(report.depositionsStorage.syncClient, "OneDrive");
});

test("resolving for classification does not enforce", () => {
  const synced = String.raw`C:\Users\pat\OneDrive\depos`;
  assert.equal(resolveDepositionStorageRoot(environment({ DEPO_PRO_DEPOSITIONS_ROOT:synced })), path.resolve(synced));
  assert.throws(() => depositionStorageRoot(environment({ DEPO_PRO_DEPOSITIONS_ROOT:synced })), /SYNCED_STORAGE_ROOT/);
});

test("a verdict is not cached, so a root that becomes unsafe is caught", () => {
  // classifyStorageRoot reads Dropbox's info.json and lstats every ancestor, so the verdict
  // depends on filesystem state that can change while the process is alive. An earlier version
  // memoised it and would have held a stale "safe" answer.
  const root = String.raw`C:\Users\pat\depos`;
  assert.equal(depositionStorageRoot({ DEPO_PRO_DEPOSITIONS_ROOT:root }), path.resolve(root));
  assert.throws(
    () => depositionStorageRoot({ DEPO_PRO_DEPOSITIONS_ROOT:root, OneDrive:String.raw`C:\Users\pat` }),
    /SYNCED_STORAGE_ROOT/,
    "the same path must be re-judged when the environment says it is now inside a sync root",
  );
});
