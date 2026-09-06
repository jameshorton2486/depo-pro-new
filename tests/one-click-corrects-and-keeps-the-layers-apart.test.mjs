// The reporter presses one button. The record keeps two authorities apart.
//
// Correct Transcript runs the deterministic format pass and then the AI passes. What must survive
// that convenience:
//
//   the deterministic layer makes zero Anthropic calls
//   an AI failure leaves a successful deterministic pass standing
//   a deterministic failure fails the whole action closed
//   pressing the button again over an unchanged transcript applies nothing
//   neither layer widens the other's vocabulary
//
// The last is the one worth stating plainly. One button initiating both does not make them one
// correction, and the audit history has to keep answering "who changed this word" with immutable
// ASR, deterministic correction, AI correction, or the reporter -- never "the correction feature".
import assert from "node:assert/strict";
import test from "node:test";
import { AI_CORRECTION_STATUS } from "../server/ai-correction.mjs";
import { FORMAT_PASS_STATUS, applyFormatPass, canonicalIdentifiers, correctTranscript } from "../server/correct-transcript.mjs";
import { appendTransaction, emptyOverlay, undoLastTransaction } from "../server/reporter-overlay.mjs";

const CAUSE = "25-CV-00598-OLG";
// "mister Okonkwo" is deterministically correctable; "Bardado" is a name only the AI layer may touch.
const WORDS = ["Good", "afternoon,", "mister", "Okonkwo", "and", "Bardado"];
const EVIDENCE = [{ words: WORDS.map((text, i) => ({ id: `job:word:${i + 1}`, punctuatedWord: text })) }];
const SEGMENTS = () => [{ id: "seg-1", speakerIdentity: "counsel-1", transcriptRole: "QUESTIONING_ATTORNEY",
  text: WORDS.join(" "), asrWordIds: WORDS.map((_, i) => `job:word:${i + 1}`) }];

function harness({ passes = [], entity, ranges, appendThrows = false } = {}) {
  const calls = { appended: [], written: [], anthropic: 0 };
  let current = emptyOverlay("DEP-1");
  return {
    calls,
    get overlay() { return current; },
    get records() { return calls.written; },
    deps: {
      depositionId: "DEP-1", storageRoot: null, apiKey: "key", model: "claude-opus-5",
      passStartedAt: "2026-09-05T00:00:00.000Z",
      canonicalValues: [CAUSE],
      getWorkingTranscript: () => ({ segments: SEGMENTS() }),
      readReporterOverlay: () => current,
      readAsrEvidence: () => EVIDENCE,
      getSpeakerCandidates: () => ({ candidates: [{ id: "counsel-1", defaultRole: "QUESTIONING_ATTORNEY" }] }),
      appendReporterOperations: (_root, input) => {
        if (appendThrows) throw new Error("the overlay refused");
        calls.appended.push(input);
        current = appendTransaction(current, input.operations);
        return current;
      },
      listPasses: () => [...passes, ...calls.written],
      writePassRecord: (_root, input) => { calls.written.push(input.record); return input.record; },
      entityPass: entity ?? (async () => { calls.anthropic++; return { accepted: [{ wordId: "job:word:6", originalValue: "Bardado", proposedValue: "Bardot", confidenceScore: 0.94, evidenceSource: "ROSTER" }] }; }),
      speakerRangePass: ranges ?? (async () => { calls.anthropic++; return { accepted: [] }; }),
    },
  };
}

// --- the deterministic layer, alone --------------------------------------------------------------

test("the deterministic layer corrects what it can prove, and calls nobody", async () => {
  const store = harness();
  const result = await applyFormatPass(null, store.deps);
  assert.equal(result.status, FORMAT_PASS_STATUS.APPLIED);
  assert.deepEqual(result.applied.map(item => `${item.before} -> ${item.after}`), ["mister -> Mr."]);
  assert.equal(store.calls.anthropic, 0, "no model was consulted");
});

test("its record says it was not a model and not a reporter", async () => {
  const store = harness();
  await applyFormatPass(null, store.deps);
  const [record] = store.records;
  assert.equal(record.recordType, "DETERMINISTIC_FORMAT_PASS");
  assert.equal(record.appliedBy, "DETERMINISTIC_FORMAT_PASS");
  assert.equal(record.model, null);
  assert.deepEqual(record.operations, store.calls.appended[0].operations, "the record is what landed");
});

test("it applies as one transaction, and one undo takes it back", async () => {
  const store = harness();
  await applyFormatPass(null, store.deps);
  assert.equal(store.overlay.transactionSizes.length, 1);
  assert.deepEqual(undoLastTransaction(store.overlay).overlay.operations, []);
});

test("it is guarded by the state it planned against", async () => {
  const store = harness();
  await applyFormatPass(null, store.deps);
  assert.ok(store.calls.appended[0].expectedReviewStateHash, "a bare append could rebase onto an edit it never saw");
});

test("it fails closed rather than half-applying", async () => {
  const store = harness({ appendThrows: true });
  const result = await applyFormatPass(null, store.deps);
  assert.equal(result.status, FORMAT_PASS_STATUS.FAILED);
  assert.equal(result.operationCount, 0);
  assert.equal(store.records.length, 0, "and writes no record for a pass that did not happen");
});

test("with no canonical value on record it does not invent an identifier", () => {
  assert.deepEqual(canonicalIdentifiers({ case: { causeNumber: CAUSE } }), [CAUSE]);
  assert.deepEqual(canonicalIdentifiers({ case: { causeNumber: { value: CAUSE, state: "EXTRACTED" } } }), [CAUSE]);
  assert.deepEqual(canonicalIdentifiers({ case: { causeNumber: { value: null, state: "MISSING" } } }), [],
    "a missing cause number yields no authority, so the generator declines");
  assert.deepEqual(canonicalIdentifiers(null), []);
});

// --- one button, two layers ----------------------------------------------------------------------

test("one click runs both layers, and reports them separately", async () => {
  const store = harness();
  const result = await correctTranscript(null, store.deps);
  assert.equal(result.status, AI_CORRECTION_STATUS.APPLIED);
  assert.equal(result.format.operationCount, 1);
  assert.equal(result.ai.operationCount, 1);
  assert.equal(result.operationCount, 2);
  assert.equal(store.calls.appended.length, 2, "two transactions, because they are two acts");
  assert.deepEqual(store.records.map(item => item.recordType), ["DETERMINISTIC_FORMAT_PASS", "AI_CORRECTION_PASS"]);
});

test("the deterministic layer runs first, so the AI transaction stays last", async () => {
  // Not an aesthetic ordering. The Undo AI Correction Pass control proves it may still offer itself
  // by comparing the overlay's tail against the operations the AI pass recorded. Running the
  // deterministic layer afterwards would put its transaction at the tail and silently disable that
  // control on every single run.
  const store = harness();
  await correctTranscript(null, store.deps);
  const ai = store.records.find(item => item.recordType === "AI_CORRECTION_PASS");
  const tail = store.overlay.operations.slice(-ai.operations.length);
  assert.deepEqual(tail, ai.operations, "the AI pass is still the last transaction");
});

test("an AI failure does not roll back a successful deterministic pass", async () => {
  // THE PROPERTY THAT MAKES TWO TRANSACTIONS WORTH THE COMPLEXITY. The key is revoked, Anthropic is
  // down, the model name is wrong -- the corrections the application proved for itself still stand.
  const dead = async () => { throw new Error("Anthropic is unreachable"); };
  const store = harness({ entity: dead, ranges: dead });
  const result = await correctTranscript(null, store.deps);
  assert.equal(result.ai.status, AI_CORRECTION_STATUS.FAILED);
  assert.equal(result.format.status, FORMAT_PASS_STATUS.APPLIED);
  assert.equal(store.overlay.operations.length, 1, "the formatting correction is still applied");
  assert.equal(store.records.length, 1);
  assert.match(result.message, /Mr\.|formatting correction/, "and the reporter is told what did land");
  assert.match(result.message, /could not run/, "as well as what did not");
});

test("a missing key still applies the corrections that need no key", async () => {
  const store = harness();
  const result = await correctTranscript(null, { ...store.deps, apiKey: "" });
  assert.equal(result.ai.status, AI_CORRECTION_STATUS.NO_CREDENTIAL);
  assert.equal(result.format.status, FORMAT_PASS_STATUS.APPLIED);
  assert.equal(store.calls.anthropic, 0);
  assert.equal(store.overlay.operations.length, 1);
});

test("a deterministic failure fails the whole action closed", async () => {
  // The AI layer is not run over a transcript whose deterministic state is unknown. That would be
  // the second layer proceeding on an assumption the first one just refused to make.
  const store = harness({ appendThrows: true });
  const result = await correctTranscript(null, store.deps);
  assert.equal(result.status, AI_CORRECTION_STATUS.FAILED);
  assert.equal(result.ai, null, "the AI layer never ran");
  assert.equal(store.calls.anthropic, 0);
});

test("pressing the button again over an unchanged transcript applies nothing", async () => {
  // The property is that nothing is appended, and TWO independent things secure it. The AI layer
  // is stopped by its guard. The deterministic layer is stopped by its generators, which find
  // nothing to do because "Mr." is no longer "mister" -- its own guard does not fire here, because
  // the AI transaction moved the state hash after the format record was written.
  const store = harness();
  await correctTranscript(null, store.deps);
  const applied = store.overlay.operations.length;
  const again = await correctTranscript(null, store.deps);
  assert.equal(again.format.status, FORMAT_PASS_STATUS.NOTHING_TO_APPLY);
  assert.equal(again.ai.status, AI_CORRECTION_STATUS.ALREADY_CORRECTED);
  assert.equal(store.overlay.operations.length, applied, "nothing was appended a second time");
  assert.equal(store.calls.appended.length, 2, "and no third transaction was opened");
});

test("the deterministic guard refuses a state it has already corrected", async () => {
  // The guard on its own, with no AI transaction moving the hash underneath it. This is what stops
  // a re-run appending the same corrections when the generators are NOT self-limiting -- and it
  // must be checked against format records only, never against an AI pass touching the same state.
  const store = harness();
  const first = await applyFormatPass(null, store.deps);
  assert.equal(first.status, FORMAT_PASS_STATUS.APPLIED);
  const again = await applyFormatPass(null, store.deps);
  assert.equal(again.status, FORMAT_PASS_STATUS.ALREADY_CORRECTED);
  assert.equal(store.calls.appended.length, 1);
  // And the reporter can still ask for it deliberately.
  assert.notEqual((await applyFormatPass(null, { ...store.deps, force: true })).status, FORMAT_PASS_STATUS.ALREADY_CORRECTED);
});

test("a format pass record does not make the AI layer think it already ran", async () => {
  // FOUND BY INTEGRATION. Both passes write into one directory, and the deterministic pass runs
  // first -- so its resultingReviewStateHash is exactly the state the AI pass is about to analyse.
  // Counting it as an AI pass made one click run the formatting and then tell the reporter the
  // transcript was already corrected, with no AI pass having run at all.
  const store = harness();
  const result = await correctTranscript(null, store.deps);
  assert.equal(result.ai.status, AI_CORRECTION_STATUS.APPLIED, "the AI layer ran");
  assert.equal(store.calls.anthropic, 2);
});

test("neither layer may apply the other's kind of correction", async () => {
  // The deterministic layer touched "mister" and left "Bardado" alone -- it has no authority over a
  // name. The AI layer corrected the name and proposed nothing about the honorific. One button does
  // not widen either vocabulary.
  const store = harness();
  const result = await correctTranscript(null, store.deps);
  const format = result.format.applied.map(item => item.correctionType);
  assert.deepEqual(format, ["abbreviation"]);
  assert.equal(result.ai.applied.every(item => item.correctionType !== "abbreviation"), true);
  assert.equal(result.applied.length, 2, "and the reporter sees both, attributed separately");
});
