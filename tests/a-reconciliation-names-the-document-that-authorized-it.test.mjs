// A speaker changed because a human-corrected transcript said so, and the record says which one.
//
// THE GAP THIS CLOSES. An overlay operation carries no provenance, and a transaction carries only
// its size. Applying a reconciliation through the ordinary path therefore lands as an unattributed
// transaction -- and an unattributed transaction is read as the reporter's own keystroke. On Heath
// Thomas that would have recorded the reporter as personally attributing twenty-three passages they
// had never looked at, in a record a court may be asked to rely on.
//
// What is defended here:
//
//   no document, no pass -- a reconciliation that cannot name its source is refused outright
//   the record binds the deposition, the document, its SHA-256, and the state analysed
//   speaker identity only: `label` is the whole vocabulary, so no word can move
//   the role is derived from the canonical record, never accepted from the caller
//   every refusal is recorded with its reason rather than dropped
//   one transaction, so undo takes the reconciliation back as a unit
//   a transcript that moved is refused, not rebased
import assert from "node:assert/strict";
import test from "node:test";
import {
  RECONCILIATION_REFUSALS, RECONCILIATION_STATUS,
  applyReconciliationPass, planReconciliation, reconciliationPassRecord, validateSource,
} from "../server/reconciliation-pass.mjs";
import { appendTransaction, emptyOverlay, undoLastTransaction } from "../server/reporter-overlay.mjs";

const SHA = "a".repeat(64);
const SOURCE = { name: "Thomas Corrected.docx", sha256: SHA };
const WORDS = ["Objection.", "Vague", "and", "ambiguous."];
const EVIDENCE = [{ words: WORDS.map((text, i) => ({ id: `job:word:${i + 1}`, punctuatedWord: text })) }];
const SEGMENTS = () => [
  { id: "seg-1", speakerIdentity: "attorney-4", transcriptRole: "DEFENDING_ATTORNEY",
    text: WORDS.join(" "), asrWordIds: ["job:word:1", "job:word:2"] },
  { id: "seg-2", speakerIdentity: "attorney-4", transcriptRole: "DEFENDING_ATTORNEY",
    text: "and ambiguous.", asrWordIds: ["job:word:3", "job:word:4"] },
];
const PARTICIPANTS = [
  { id: "attorney-1", label: "Steven A. Nunez", defaultRole: "QUESTIONING_ATTORNEY" },
  { id: "attorney-4", label: "Karen M. Alvarado", defaultRole: "DEFENDING_ATTORNEY" },
  { id: "attorney-5", label: "Lucia D. Zhan", defaultRole: "DEFENDING_ATTORNEY" },
  { id: "attorney-2", label: "Jacob D. Cukjati", defaultRole: "" },
  { id: "witness", label: "Heath Thomas", defaultRole: "WITNESS" },
];
const toZhan = (segmentId = "seg-1") => ({ segmentId, speakerIdentity: "attorney-5",
  sourceDesignation: "MS. ZHAN: Objection. Vague and ambiguous." });

function harness({ passes = [], appendThrows = false } = {}) {
  const calls = { appended: [], written: [] };
  let current = emptyOverlay("DEP-1");
  return {
    calls,
    get overlay() { return current; },
    deps: {
      depositionId: "DEP-1", storageRoot: null, source: SOURCE,
      passStartedAt: "2026-09-06T00:00:00.000Z",
      getWorkingTranscript: () => ({ segments: SEGMENTS() }),
      readReporterOverlay: () => current,
      readAsrEvidence: () => EVIDENCE,
      getSpeakerCandidates: () => ({ candidates: PARTICIPANTS }),
      appendReporterOperations: (_root, input) => {
        if (appendThrows) throw new Error("the overlay refused");
        calls.appended.push(input);
        current = appendTransaction(current, input.operations);
        return current;
      },
      listPasses: () => [...passes, ...calls.written],
      writePassRecord: (_root, input) => { calls.written.push(input.record); return input.record; },
    },
  };
}

// --- no document, no pass -------------------------------------------------------------------------

test("a reconciliation that cannot name its source is refused outright", async () => {
  const store = harness();
  for (const source of [null, {}, { name: "Thomas Corrected.docx" }, { sha256: SHA }, { name: "x", sha256: "not-a-hash" }]) {
    const result = await applyReconciliationPass(null, { ...store.deps, source, reconciliations: [toZhan()] });
    assert.equal(result.status, RECONCILIATION_STATUS.NO_SOURCE, JSON.stringify(source));
  }
  assert.equal(store.calls.appended.length, 0, "and nothing was applied on the way to refusing");
});

test("the source is a name and a hash, and both must be real", () => {
  assert.deepEqual(validateSource(SOURCE), { name: "Thomas Corrected.docx", sha256: SHA });
  assert.equal(validateSource({ name: "x", sha256: SHA.toUpperCase() }).sha256, SHA, "case is not what makes a hash");
  assert.equal(validateSource({ name: "  ", sha256: SHA }), null);
});

// --- what the record has to say -------------------------------------------------------------------

test("the record binds the document, its hash, and the state that was analysed", async () => {
  const store = harness();
  const result = await applyReconciliationPass(null, { ...store.deps, reconciliations: [toZhan()] });
  assert.equal(result.status, RECONCILIATION_STATUS.APPLIED);
  const [record] = store.calls.written;
  assert.equal(record.recordType, "HUMAN_TRANSCRIPT_RECONCILIATION_PASS");
  assert.equal(record.appliedBy, "HUMAN_TRANSCRIPT_RECONCILIATION_PASS");
  assert.equal(record.model, null, "no model was consulted, and the record must not imply one");
  assert.deepEqual(record.source, { name: "Thomas Corrected.docx", sha256: SHA });
  assert.ok(record.reviewStateHash, "the state it analysed");
  assert.ok(record.resultingReviewStateHash, "and the state it produced");
  assert.notEqual(record.reviewStateHash, record.resultingReviewStateHash);
  // What LANDED, not what was planned: the overlay normalises an operation on the way in, so a
  // record of the plan would not match the overlay's tail -- which is how any undo control proves
  // the pass is still the last transaction.
  const tail = store.overlay.operations.slice(-record.operations.length);
  assert.deepEqual(record.operations, tail, "the record is the overlay's tail, not the plan");
  assert.notDeepEqual(record.operations, store.calls.appended[0].operations,
    "and the two genuinely differ, so this is not a tautology");
});

test("each applied item carries the passage the human transcript printed", async () => {
  const store = harness();
  const result = await applyReconciliationPass(null, { ...store.deps, reconciliations: [toZhan()] });
  const [item] = result.applied;
  assert.equal(item.before, "attorney-4");
  assert.equal(item.after, "attorney-5");
  assert.equal(item.evidenceSource, "HUMAN_CORRECTED_TRANSCRIPT");
  assert.match(item.sourceDesignation, /MS\. ZHAN/, "the evidence, not merely the conclusion");
});

test("a record is a record even before it is written", () => {
  const record = reconciliationPassRecord({ passId: "p", startedAt: "t", source: { name: "d", sha256: SHA },
    reviewStateHash: "a", resultingReviewStateHash: "b", applied: [], omitted: [], operations: [{ op: "label" }] });
  assert.equal(record.operationCount, 1);
  assert.equal(record.recordType, "HUMAN_TRANSCRIPT_RECONCILIATION_PASS");
});

// --- speaker identity only ------------------------------------------------------------------------

test("label is the whole vocabulary, so no word can move", async () => {
  const store = harness();
  await applyReconciliationPass(null, { ...store.deps, reconciliations: [toZhan("seg-1"), toZhan("seg-2")] });
  const ops = store.calls.appended[0].operations;
  assert.deepEqual([...new Set(ops.map(op => op.op))], ["label"],
    "a reconciliation cannot replace, delete, insert, split, join or bound an examination");
  assert.deepEqual(ops, [
    { op: "label", segmentId: "seg-1", speakerIdentity: "attorney-5", transcriptRole: "DEFENDING_ATTORNEY" },
    { op: "label", segmentId: "seg-2", speakerIdentity: "attorney-5", transcriptRole: "DEFENDING_ATTORNEY" },
  ]);
});

test("the role is derived from the canonical record, never accepted from the caller", () => {
  // A caller pairing a real person with a role the record does not give them would be inventing a
  // fact about the proceeding, so the role is looked up rather than read.
  const plan = planReconciliation({ segments: SEGMENTS(), participants: PARTICIPANTS,
    reconciliations: [{ ...toZhan(), transcriptRole: "COURT_REPORTER" }] });
  assert.equal(plan.operations[0].transcriptRole, "DEFENDING_ATTORNEY");
});

// --- what it refuses ------------------------------------------------------------------------------

test("every refusal is recorded with its reason rather than dropped", () => {
  const plan = planReconciliation({ segments: SEGMENTS(), participants: PARTICIPANTS, reconciliations: [
    { ...toZhan(), segmentId: "" },
    { ...toZhan(), segmentId: "seg-invented" },
    { ...toZhan(), sourceDesignation: "" },
    { ...toZhan(), speakerIdentity: "counsel-nobody" },
    { ...toZhan(), speakerIdentity: "attorney-2" },
    { ...toZhan(), speakerIdentity: "attorney-4" },
  ] });
  assert.equal(plan.operations.length, 0);
  assert.deepEqual(plan.omitted.map(item => item.reason), [
    RECONCILIATION_REFUSALS.NO_ANCHOR,
    RECONCILIATION_REFUSALS.ANCHOR_NOT_IN_TRANSCRIPT,
    RECONCILIATION_REFUSALS.NO_SOURCE_DESIGNATION,
    RECONCILIATION_REFUSALS.SPEAKER_NOT_A_PARTICIPANT,
    RECONCILIATION_REFUSALS.SPEAKER_HAS_NO_ROLE,
    RECONCILIATION_REFUSALS.ALREADY_THAT_SPEAKER,
  ]);
});

test("a passage with no designation from the source cannot be reconciled", () => {
  // The whole point of the record is that a document said so. An item that cannot quote the
  // document has no evidence of its own, whatever else about it is well formed.
  const plan = planReconciliation({ segments: SEGMENTS(), participants: PARTICIPANTS,
    reconciliations: [{ segmentId: "seg-1", speakerIdentity: "attorney-5" }] });
  assert.equal(plan.omitted[0].reason, RECONCILIATION_REFUSALS.NO_SOURCE_DESIGNATION);
});

test("nothing to apply writes no record", async () => {
  const store = harness();
  const result = await applyReconciliationPass(null, { ...store.deps,
    reconciliations: [{ ...toZhan(), speakerIdentity: "attorney-4" }] });
  assert.equal(result.status, RECONCILIATION_STATUS.NOTHING_TO_APPLY);
  assert.equal(store.calls.written.length, 0);
  assert.equal(store.calls.appended.length, 0);
});

// --- undo, staleness, idempotence -----------------------------------------------------------------

test("one transaction, and one undo takes the reconciliation back", async () => {
  const store = harness();
  await applyReconciliationPass(null, { ...store.deps, reconciliations: [toZhan("seg-1"), toZhan("seg-2")] });
  assert.equal(store.overlay.transactionSizes.length, 1, "two attributions, one act");
  assert.deepEqual(undoLastTransaction(store.overlay).overlay.operations, []);
});

test("it is guarded by the state it planned against", async () => {
  const store = harness();
  await applyReconciliationPass(null, { ...store.deps, reconciliations: [toZhan()] });
  assert.ok(store.calls.appended[0].expectedReviewStateHash,
    "a bare append could rebase onto passages nobody aligned");
});

test("re-running over a transcript it already reconciled adds nothing", async () => {
  const store = harness();
  const first = await applyReconciliationPass(null, { ...store.deps, reconciliations: [toZhan()] });
  assert.equal(first.status, RECONCILIATION_STATUS.APPLIED);
  const again = await applyReconciliationPass(null, { ...store.deps, reconciliations: [toZhan()] });
  assert.equal(again.status, RECONCILIATION_STATUS.ALREADY_RECONCILED);
  assert.equal(store.calls.appended.length, 1);
});

test("it fails closed rather than half-applying", async () => {
  const store = harness({ appendThrows: true });
  const result = await applyReconciliationPass(null, { ...store.deps, reconciliations: [toZhan()] });
  assert.equal(result.status, RECONCILIATION_STATUS.FAILED);
  assert.equal(store.calls.written.length, 0, "and writes no record for a pass that did not happen");
});

test("its record is not mistaken for an AI pass", async () => {
  // The undo control is labelled "Undo AI Correction Pass" and reads AI records only. A
  // reconciliation standing at the head of the list must not make it offer to undo something it
  // does not name.
  const { aiPassUndoState } = await import("../server/ai-correction.mjs");
  const store = harness();
  await applyReconciliationPass(null, { ...store.deps, reconciliations: [toZhan()] });
  const undo = aiPassUndoState(null, { depositionId: "DEP-1", storageRoot: null,
    listPasses: () => store.calls.written, readOverlay: () => store.overlay });
  assert.equal(undo.pass, null);
  assert.equal(undo.reason, "NO_AI_PASS");
});
