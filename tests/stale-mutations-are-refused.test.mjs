// Currency is the mutation boundary's job, not the caller's.
//
// Three endpoints write to the authoritative overlay: append, undo and redo. Only append ever
// compared a review-state hash, and it did so only when the caller chose to send one --
// `expectedReviewStateHash=null` meant the check was skipped rather than the write refused. Undo
// and redo took no hash at all.
//
// So the invariant held because the Workspace cooperated. A second tab, a retry, a script, or the
// next screen someone writes would each have written to a transcript they had not read, and undo
// would pop a transaction another tab had just committed. That is not a guarantee; it is a habit.
//
// These tests are written against the behaviour that should exist. Run against the code before the
// fix they fail -- which is the point of writing them first: a guard nobody has watched fail is a
// guard nobody can describe.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  STALE_REPORTER_TRANSACTION,
  appendReporterOperations,
  getWorkingTranscript,
  readReporterOverlay,
  redoReporterOperation,
  undoReporterOperation,
} from "../server/transcription-jobs.mjs";
import { computeReviewStateHash } from "../server/review-state-hash.mjs";

const ROOT = process.cwd();

function workspace(t) {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-stale-"));
  t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  const depositionId = "DEP-20260831-STALE";
  const directory = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(path.join(directory, "transcript"), { recursive: true });
  fs.mkdirSync(path.join(directory, "deepgram", "jobs", "job1"), { recursive: true });
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ id: depositionId, storagePath: "reporter/cause/witness", audio: [] }));
  fs.writeFileSync(path.join(directory, "transcript", "working.json"), JSON.stringify({
    schemaVersion: "1.1.0", recordType: "WORKING_TRANSCRIPT", derivedFrom: ["job1"],
    speakerMap: { status: "unreconciled", assignments: [] },
    segments: [{ id: "job1:segment:1", asrWordIds: ["job1:word:1", "job1:word:2"], text: "one two" }],
  }));
  fs.writeFileSync(path.join(directory, "deepgram", "jobs", "job1", "asr-evidence.json"), JSON.stringify({
    schemaVersion: "1.1.0", recordType: "CANONICAL_ASR_EVIDENCE", jobIdentity: "job1",
    words: [{ id: "job1:word:1", word: "one", punctuatedWord: "One" }, { id: "job1:word:2", word: "two", punctuatedWord: "two." }],
  }));
  const store = { depositionId, storageRoot };
  return {
    ...store,
    overlayFile: path.join(directory, "transcript", "reporter-overlay.json"),
    // The hash the client would have carried away when it last read the transcript.
    current: () => computeReviewStateHash({
      transcript: getWorkingTranscript(ROOT, store),
      overlay: readReporterOverlay(ROOT, store),
    }),
    operations: () => readReporterOverlay(ROOT, store).operations,
  };
}

const replace = { op: "replace", wordId: "job1:word:1", text: "Won" };
const STALE = "0".repeat(64);

test("an append with no hash is refused rather than skipping the check", (t) => {
  const w = workspace(t);
  let caught;
  try { appendReporterOperations(ROOT, { depositionId: w.depositionId, storageRoot: w.storageRoot, operations: [replace] }) }
  catch (reason) { caught = reason }
  assert.equal(caught?.code, STALE_REPORTER_TRANSACTION, "a mutation with no currency proof was accepted");
  assert.match(caught.message, /reload/i, "the refusal must tell the reporter what to do");
  assert.equal(fs.existsSync(w.overlayFile), false, "a refused write must leave no overlay behind");
});

test("an append carrying the current hash still succeeds", (t) => {
  const w = workspace(t);
  appendReporterOperations(ROOT, { depositionId: w.depositionId, storageRoot: w.storageRoot, operations: [replace], expectedReviewStateHash: w.current() });
  assert.equal(w.operations().length, 1);
});

test("an append carrying a stale hash is refused", (t) => {
  const w = workspace(t);
  assert.throws(
    () => appendReporterOperations(ROOT, { depositionId: w.depositionId, storageRoot: w.storageRoot, operations: [replace], expectedReviewStateHash: STALE }),
    { code: STALE_REPORTER_TRANSACTION },
  );
  assert.equal(w.operations().length, 0);
});

test("undo is refused without a hash, and refused with a stale one", (t) => {
  const w = workspace(t);
  appendReporterOperations(ROOT, { depositionId: w.depositionId, storageRoot: w.storageRoot, operations: [replace], expectedReviewStateHash: w.current() });

  assert.throws(
    () => undoReporterOperation(ROOT, { depositionId: w.depositionId, storageRoot: w.storageRoot }),
    { code: STALE_REPORTER_TRANSACTION },
    "undo with no hash reverses an edit the caller never read",
  );
  assert.throws(
    () => undoReporterOperation(ROOT, { depositionId: w.depositionId, storageRoot: w.storageRoot, expectedReviewStateHash: STALE }),
    { code: STALE_REPORTER_TRANSACTION },
  );
  assert.equal(w.operations().length, 1, "a refused undo must not pop the transaction");
});

test("undo carrying the current hash succeeds", (t) => {
  const w = workspace(t);
  appendReporterOperations(ROOT, { depositionId: w.depositionId, storageRoot: w.storageRoot, operations: [replace], expectedReviewStateHash: w.current() });
  const { removed } = undoReporterOperation(ROOT, { depositionId: w.depositionId, storageRoot: w.storageRoot, expectedReviewStateHash: w.current() });
  assert.equal(removed.length, 1);
  assert.equal(w.operations().length, 0);
});

test("redo is refused without a hash, and succeeds with the current one", (t) => {
  const w = workspace(t);
  appendReporterOperations(ROOT, { depositionId: w.depositionId, storageRoot: w.storageRoot, operations: [replace], expectedReviewStateHash: w.current() });
  undoReporterOperation(ROOT, { depositionId: w.depositionId, storageRoot: w.storageRoot, expectedReviewStateHash: w.current() });

  assert.throws(
    () => redoReporterOperation(ROOT, { depositionId: w.depositionId, storageRoot: w.storageRoot }),
    { code: STALE_REPORTER_TRANSACTION },
  );
  assert.equal(w.operations().length, 0, "a refused redo must not restore the transaction");

  const { restored } = redoReporterOperation(ROOT, { depositionId: w.depositionId, storageRoot: w.storageRoot, expectedReviewStateHash: w.current() });
  assert.equal(restored.length, 1);
  assert.equal(w.operations().length, 1);
});

test("the second tab loses: an undo against the state before another tab's edit is refused", (t) => {
  // The §35 scenario, end to end. Tab B read the transcript, tab A edited it, and B's undo must
  // not reverse a transaction B never saw.
  const w = workspace(t);
  const tabB = w.current();
  appendReporterOperations(ROOT, { depositionId: w.depositionId, storageRoot: w.storageRoot, operations: [replace], expectedReviewStateHash: tabB });
  assert.notEqual(w.current(), tabB, "the fixture did not actually advance the review state");

  assert.throws(
    () => undoReporterOperation(ROOT, { depositionId: w.depositionId, storageRoot: w.storageRoot, expectedReviewStateHash: tabB }),
    { code: STALE_REPORTER_TRANSACTION },
  );
  assert.equal(w.operations().length, 1, "tab A's edit survived tab B's stale undo");
});
