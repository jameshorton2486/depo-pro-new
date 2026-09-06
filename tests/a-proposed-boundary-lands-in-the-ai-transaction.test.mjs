// The model answers once, the validator decides, and the boundary lands where an undo can reach it.
//
// The validator itself is proved in an-ai-may-propose-where-examination-begins.test.mjs. What is
// proved here is the two ends of it: the pass that asks, and the orchestration that applies what
// survives.
//
//   the pass reads the transcript as it currently prints, and anchors to a word that prints
//   it stamps the state it analysed, so a transcript that moves invalidates its answer
//   "no boundary here" is an answer, not a failure
//   a failed structural analysis does not discard the name corrections found beside it
//   a question already answered costs nothing -- no call is made
//   what the validator accepts lands in the SAME transaction as the corrections, so one undo
//     takes back everything the pass did
//   what the validator refuses is recorded with its reason and changes nothing
import assert from "node:assert/strict";
import test from "node:test";
import { AI_CORRECTION_STATUS, applyAiCorrectionPass } from "../server/ai-correction.mjs";
import { BOUNDARY_REFUSALS } from "../server/examination-boundary-rules.mjs";
import { openingUtterances, runExaminationBoundaryPass } from "../server/examination-boundary-pass.mjs";
import { appendTransaction, emptyOverlay, undoLastTransaction } from "../server/reporter-overlay.mjs";
import { computeReviewStateHash } from "../server/review-state-hash.mjs";

// The opening of a deposition: the record, the appearances, the oath, the handoff, the first
// question. One word per paragraph is enough -- what is under test is which word is offered as an
// anchor, not how the sentence reads.
const SPOKEN = [
  { id: "seg-1", speakerIdentity: "reporter", transcriptRole: "COURT_REPORTER", words: ["record"] },
  { id: "seg-2", speakerIdentity: "nunez", transcriptRole: "QUESTIONING_ATTORNEY", words: ["Nunez", "for", "Plaintiff"] },
  { id: "seg-3", speakerIdentity: "reporter", transcriptRole: "COURT_REPORTER", words: ["proceed"] },
  { id: "seg-4", speakerIdentity: "nunez", transcriptRole: "QUESTIONING_ATTORNEY", words: ["State", "your", "name"] },
  { id: "seg-5", speakerIdentity: "witness", transcriptRole: "WITNESS", words: ["Thomas"] },
];
let ordinal = 0;
const SEGMENTS = SPOKEN.map(segment => ({
  id: segment.id, speakerIdentity: segment.speakerIdentity, transcriptRole: segment.transcriptRole,
  text: segment.words.join(" "), asrWordIds: segment.words.map(() => `job:word:${++ordinal}`),
}));
const EVIDENCE = [{ words: SEGMENTS.flatMap((segment, index) =>
  segment.asrWordIds.map((id, position) => ({ id, punctuatedWord: SPOKEN[index].words[position] }))) }];
const FIRST_QUESTION = SEGMENTS[3].asrWordIds[0];
const CANDIDATES = [
  { id: "nunez", label: "Steven Nunez", defaultRole: "QUESTIONING_ATTORNEY" },
  { id: "zhan", label: "Lucia Zhan", defaultRole: "DEFENDING_ATTORNEY" },
  { id: "witness", label: "Heath Thomas", defaultRole: "WITNESS" },
  { id: "reporter", label: "A Reporter", defaultRole: "COURT_REPORTER" },
];

const transcript = () => ({ segments: SEGMENTS.map(segment => ({ ...segment, asrWordIds: [...segment.asrWordIds] })) });
const readers = overlay => ({
  getWorkingTranscript: () => transcript(),
  readReporterOverlay: () => overlay,
  readAsrEvidence: () => EVIDENCE,
  getSpeakerCandidates: () => ({ candidates: CANDIDATES }),
});
const found = extra => async () => ({ found: true, examinerPersonId: "nunez", atWordId: FIRST_QUESTION, ...extra });

// --- what the model is shown ---------------------------------------------------------------------

test("it reads the transcript as it currently prints", () => {
  const utterances = openingUtterances({ transcript: transcript(), evidence: EVIDENCE, overlay: emptyOverlay("DEP-1"),
    labels: Object.fromEntries(CANDIDATES.map(person => [person.id, person.label])) });
  assert.equal(utterances.length, 5);
  assert.deepEqual(utterances[3], { wordId: FIRST_QUESTION, speaker: "Steven Nunez",
    role: "QUESTIONING_ATTORNEY", text: "State your name" });
});

test("the anchor it offers is a word that prints, never one the reporter struck", () => {
  // The first word of the question is gone. Offering its id would hand the model an anchor the
  // validator must refuse -- a proposal built to fail, and a paid call spent producing it.
  const overlay = appendTransaction(emptyOverlay("DEP-1"), [{ op: "delete", wordId: FIRST_QUESTION }]);
  const utterances = openingUtterances({ transcript: transcript(), evidence: EVIDENCE, overlay });
  assert.equal(utterances[3].wordId, SEGMENTS[3].asrWordIds[1]);
  assert.equal(utterances[3].text, "your name", "and the struck word is not read back either");
});

test("a correction the reporter already made is what the model reads", () => {
  const overlay = appendTransaction(emptyOverlay("DEP-1"), [{ op: "replace", wordId: FIRST_QUESTION, text: "Please" }]);
  assert.equal(openingUtterances({ transcript: transcript(), evidence: EVIDENCE, overlay })[3].text, "Please your name");
});

test("only the opening is sent", () => {
  assert.equal(openingUtterances({ transcript: transcript(), evidence: EVIDENCE, overlay: emptyOverlay("DEP-1"), limit: 2 }).length, 2);
});

// --- what the pass returns -----------------------------------------------------------------------

test("a proposal carries the transcript state it was made against", async () => {
  const overlay = emptyOverlay("DEP-1");
  const result = await runExaminationBoundaryPass(null, {
    depositionId: "DEP-1", apiKey: "key", model: "claude-opus-5", submit: found(), ...readers(overlay),
  });
  assert.deepEqual(result.proposals, [{ atWordId: FIRST_QUESTION, examinerPersonId: "nunez", type: "DIRECT",
    reviewStateHash: computeReviewStateHash({ transcript: transcript(), overlay }), reasoning: null }]);
  assert.deepEqual(result.failures, []);
});

test("it proposes DIRECT and nothing else, whatever it is told", async () => {
  // Cross, redirect and recross are handovers the reporter marks as they read. The pass is not
  // asked about them, and a model volunteering one cannot smuggle it through this return.
  const result = await runExaminationBoundaryPass(null, {
    depositionId: "DEP-1", apiKey: "key", model: "claude-opus-5",
    submit: found({ type: "CROSS" }), ...readers(emptyOverlay("DEP-1")),
  });
  assert.deepEqual(result.proposals.map(item => item.type), ["DIRECT"]);
});

test("no discernible transition is an answer, not a failure", async () => {
  const result = await runExaminationBoundaryPass(null, {
    depositionId: "DEP-1", apiKey: "key", model: "claude-opus-5",
    submit: async () => ({ found: false }), ...readers(emptyOverlay("DEP-1")),
  });
  assert.deepEqual(result.proposals, []);
  assert.deepEqual(result.failures, [], "the pass ran and the transcript did not support an answer");
});

test("an analysis that could not run reports itself rather than throwing", async () => {
  // It must not throw. A structural analysis that failed has to leave the name and speaker
  // corrections found beside it standing.
  const result = await runExaminationBoundaryPass(null, {
    depositionId: "DEP-1", apiKey: "key", model: "claude-opus-5",
    submit: async () => { throw new Error("Anthropic is unreachable"); }, ...readers(emptyOverlay("DEP-1")),
  });
  assert.deepEqual(result.proposals, []);
  assert.equal(result.failures[0].code, "BOUNDARY_ANALYSIS_FAILED");
  assert.match(result.failures[0].message, /unreachable/);
});

test("a question already answered costs nothing", async () => {
  // The transcript already says where the direct examination begins. The validator would refuse a
  // proposal about it, so buying one is a charge with nothing on the other side.
  let asked = 0;
  const overlay = appendTransaction(emptyOverlay("DEP-1"),
    [{ op: "examination", atWordId: FIRST_QUESTION, examinerPersonId: "nunez", type: "DIRECT" }]);
  const result = await runExaminationBoundaryPass(null, {
    depositionId: "DEP-1", apiKey: "key", model: "claude-opus-5",
    submit: async () => { asked += 1; return { found: true }; }, ...readers(overlay),
  });
  assert.equal(asked, 0, "no call was made");
  assert.equal(result.skipped, "BOUNDARY_ESTABLISHED");
  assert.deepEqual(result.proposals, []);
});

test("it refuses to run without a key or a model, rather than running differently", async () => {
  await assert.rejects(() => runExaminationBoundaryPass(null, { depositionId: "DEP-1", model: "claude-opus-5", ...readers(emptyOverlay("DEP-1")) }));
  await assert.rejects(() => runExaminationBoundaryPass(null, { depositionId: "DEP-1", apiKey: "key", ...readers(emptyOverlay("DEP-1")) }));
});

// --- and what the orchestration does with it -----------------------------------------------------

function harness({ proposals = [], names = [] } = {}) {
  const calls = { appended: [], written: [] };
  let current = emptyOverlay("DEP-1");
  return {
    calls,
    get overlay() { return current; },
    deps: {
      depositionId: "DEP-1", storageRoot: null, apiKey: "key", model: "claude-opus-5",
      passStartedAt: "2026-09-05T00:00:00.000Z",
      getWorkingTranscript: () => transcript(),
      readReporterOverlay: () => current,
      readAsrEvidence: () => EVIDENCE,
      getSpeakerCandidates: () => ({ candidates: CANDIDATES }),
      appendReporterOperations: (_root, input) => {
        calls.appended.push(input);
        current = appendTransaction(current, input.operations);
        return current;
      },
      listPasses: () => [],
      writePassRecord: (_root, input) => { calls.written.push(input.record); return input.record; },
      entityPass: async () => ({ accepted: names }),
      speakerRangePass: async () => ({ accepted: [] }),
      boundaryPass: async () => ({
        chunksSubmitted: 1, failures: [],
        proposals: proposals.map(proposal => ({ type: "DIRECT", reviewStateHash: computeReviewStateHash({
          transcript: transcript(), overlay: current }), ...proposal })),
      }),
    },
  };
}

test("a supported boundary is applied, attributed to the analysis", async () => {
  const store = harness({ proposals: [{ atWordId: FIRST_QUESTION, examinerPersonId: "nunez" }] });
  const result = await applyAiCorrectionPass(null, store.deps);
  assert.equal(result.status, AI_CORRECTION_STATUS.APPLIED);
  assert.deepEqual(store.calls.appended[0].operations,
    [{ op: "examination", atWordId: FIRST_QUESTION, examinerPersonId: "nunez", type: "DIRECT" }]);
  const boundary = result.applied.find(item => item.kind === "examination_boundary");
  assert.equal(boundary.evidenceSource, "AI_STRUCTURAL_ANALYSIS",
    "so the reporter can tell it from a boundary they set themselves");
});

test("it lands in the same transaction as the corrections, and one undo takes back both", async () => {
  // The property the whole pass rests on. A boundary applied as its own transaction would sit at
  // the tail, so "Undo AI Correction Pass" would take back the structure and leave the corrected
  // names behind -- half a pass undone, and the reporter told the whole one was.
  const store = harness({
    proposals: [{ atWordId: FIRST_QUESTION, examinerPersonId: "nunez" }],
    names: [{ wordId: SEGMENTS[4].asrWordIds[0], proposedValue: "Thomas", confidenceScore: 0.9, evidenceSource: "ROSTER" }],
  });
  await applyAiCorrectionPass(null, store.deps);
  assert.equal(store.calls.appended.length, 1, "one transaction");
  assert.equal(store.overlay.transactionSizes.length, 1);
  assert.deepEqual(store.calls.appended[0].operations.map(item => item.op), ["replace", "examination"]);
  assert.deepEqual(undoLastTransaction(store.overlay).overlay.operations, []);
});

test("the pass record holds the boundary, so the undo control can prove the pass is still last", async () => {
  const store = harness({ proposals: [{ atWordId: FIRST_QUESTION, examinerPersonId: "nunez" }] });
  await applyAiCorrectionPass(null, store.deps);
  const [record] = store.calls.written;
  const tail = store.overlay.operations.slice(-record.operations.length);
  assert.deepEqual(tail, record.operations);
});

test("a boundary naming somebody the record does not hold is refused, with its reason", async () => {
  const store = harness({ proposals: [{ atWordId: FIRST_QUESTION, examinerPersonId: "counsel-nobody" }] });
  const result = await applyAiCorrectionPass(null, store.deps);
  assert.equal(result.status, AI_CORRECTION_STATUS.NOTHING_TO_APPLY);
  assert.equal(store.calls.appended.length, 0, "and nothing was applied");
  assert.equal(result.omitted[0].reason, BOUNDARY_REFUSALS.EXAMINER_NOT_A_PARTICIPANT);
});

test("an anchor the transcript does not hold is refused as an invention", async () => {
  const store = harness({ proposals: [{ atWordId: "job:word:9999", examinerPersonId: "nunez" }] });
  const result = await applyAiCorrectionPass(null, store.deps);
  assert.equal(result.omitted[0].reason, BOUNDARY_REFUSALS.ANCHOR_NOT_IN_TRANSCRIPT);
});

test("an anchor the reporter struck is refused as an edit, not as an invention", async () => {
  // The two are different problems with different remedies, and the difference is only visible if
  // the orchestration derives BOTH sets: every word the transcript holds, and those that print.
  // Passing one set for both made a struck anchor look like a word that was simply there.
  const store = harness({ proposals: [{ atWordId: FIRST_QUESTION, examinerPersonId: "nunez" }] });
  store.deps.appendReporterOperations(null, { operations: [{ op: "delete", wordId: FIRST_QUESTION }] });
  const result = await applyAiCorrectionPass(null, store.deps);
  assert.equal(result.omitted[0].reason, BOUNDARY_REFUSALS.ANCHOR_NOT_PRINTED);
});

test("a boundary the reporter has already set is not overwritten", async () => {
  const store = harness({ proposals: [{ atWordId: SEGMENTS[1].asrWordIds[0], examinerPersonId: "nunez" }] });
  store.deps.appendReporterOperations(null, { operations: [
    { op: "examination", atWordId: FIRST_QUESTION, examinerPersonId: "nunez", type: "DIRECT" }] });
  const result = await applyAiCorrectionPass(null, store.deps);
  assert.equal(result.omitted[0].reason, BOUNDARY_REFUSALS.REPORTER_BOUNDARY_EXISTS);
  assert.equal(store.calls.appended.length, 1, "the reporter's boundary is the only one there");
});

test("a structural failure does not discard the corrections found beside it", async () => {
  const store = harness({ names: [{ wordId: SEGMENTS[4].asrWordIds[0], proposedValue: "Thomas", confidenceScore: 0.9, evidenceSource: "ROSTER" }] });
  store.deps.boundaryPass = async () => ({ proposals: [], chunksSubmitted: 1,
    failures: [{ code: "BOUNDARY_ANALYSIS_FAILED", message: "Anthropic is unreachable" }] });
  const result = await applyAiCorrectionPass(null, store.deps);
  assert.equal(result.status, AI_CORRECTION_STATUS.APPLIED);
  assert.equal(result.operationCount, 1, "the name correction still applied");
  assert.match(result.failures.join(" "), /examination-boundary: Anthropic is unreachable/,
    "and the reporter is told the structural analysis did not run");
});
