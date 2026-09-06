// The AI correction pass applies its corrections, and remains fully accountable for them.
//
// The subsystem was built as a suggestion queue: AI proposes, the reporter accepts each one. That
// is right when the reporter would not otherwise read the transcript. Here they will -- the scopist
// and court reporter review the whole record against the audio afterwards regardless -- so
// approving several hundred suggestions first is the same reading done twice.
//
// So approval is replaced by an audit trail, not by trust. What the AI changed, from what, on what
// evidence, with what confidence, under which pass -- all recorded -- and the whole pass lands as a
// single overlay transaction so it can be undone as a unit.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { AI_CORRECTION_STATUS, aiPassUndoState, applyAiCorrectionPass, correctionPassRecord, planAiCorrectionBatch, preservePunctuation } from "../server/ai-correction.mjs";
import { appendTransaction, emptyOverlay } from "../server/reporter-overlay.mjs";
import { computeReviewStateHash, proposalWordIds } from "../server/review-state-hash.mjs";

const word = (n, text) => ({ id: `job:word:${n}`, text });
const segments = () => ([
  { id: "s1", speakerIdentity: null, transcriptRole: null, words: [word(1, "Mia"), word(2, "Bardado")] },
  { id: "s2", speakerIdentity: null, transcriptRole: null, words: [word(3, "Yes"), word(4, "ma'am")] },
  { id: "s3", speakerIdentity: null, transcriptRole: null, words: [word(5, "Lucia"), word(6, "Zahn")] },
]);
const roster = { "reporter-1": { id: "reporter-1", defaultRole: null }, "witness-1": { id: "witness-1", defaultRole: "A." } };
const speakerFor = id => roster[id] ?? null;

test("word corrections become replace operations, with before and after kept", () => {
  const batch = planAiCorrectionBatch({
    segments: segments(), speakerFor,
    names: [{ wordId: "job:word:2", originalValue: "Bardado", proposedValue: "Bardot", correctionType: "text", confidenceScore: 0.94, evidenceSource: "ROSTER" }],
  });
  assert.deepEqual(batch.operations, [{ op: "replace", wordId: "job:word:2", text: "Bardot" }]);
  assert.equal(batch.applied.length, 1);
  assert.deepEqual(batch.applied[0], {
    kind: "name", wordId: "job:word:2", before: "Bardado", after: "Bardot",
    correctionType: "text", confidence: 0.94, evidenceSource: "ROSTER",
  });
  assert.equal(batch.omitted.length, 0);
});

test("overlapping corrections fail closed instead of overwriting each other", () => {
  // Two proposals cannot both be right about the same word. The earlier claim wins; the later is
  // omitted WITH A REASON, because a correction that silently vanished is worse than one refused.
  const batch = planAiCorrectionBatch({
    segments: segments(), speakerFor,
    names: [
      { wordId: "job:word:2", proposedValue: "Bardot" },
      { wordId: "job:word:2", proposedValue: "Bardeau" },
    ],
  });
  assert.equal(batch.operations.length, 1, "only one correction reaches that word");
  assert.equal(batch.operations[0].text, "Bardot");
  assert.equal(batch.omitted.length, 1);
  assert.equal(batch.omitted[0].reason, "OVERLAPS_EARLIER_CORRECTION");
  assert.equal(batch.omitted[0].conflictingWordId, "job:word:2");
});

test("a speaker range does not swallow a word correction inside it", () => {
  // Word corrections claim first precisely so this cannot happen.
  const batch = planAiCorrectionBatch({
    segments: segments(), speakerFor,
    names: [{ wordId: "job:word:4", proposedValue: "sir" }],
    ranges: [{ wordId: "job:word:3", endWordId: "job:word:4", speakerIdentity: "witness-1" }],
  });
  assert.equal(batch.applied.filter(item => item.kind === "name").length, 1);
  assert.equal(batch.omitted.filter(item => item.kind === "speaker-range" && item.reason === "OVERLAPS_EARLIER_CORRECTION").length, 1);
});

test("a proposal naming somebody not on the roster is omitted, not invented", () => {
  const batch = planAiCorrectionBatch({
    segments: segments(), speakerFor,
    ranges: [{ wordId: "job:word:5", endWordId: "job:word:6", speakerIdentity: "someone-nobody-added" }],
  });
  assert.equal(batch.operations.length, 0);
  assert.equal(batch.omitted[0].reason, "IDENTITY_NOT_IN_ROSTER");
});

test("a proposal anchored to a word that is not there is omitted", () => {
  const batch = planAiCorrectionBatch({
    segments: segments(), speakerFor,
    ranges: [{ wordId: "job:word:999", speakerIdentity: "witness-1" }],
  });
  assert.equal(batch.operations.length, 0);
  assert.equal(batch.omitted[0].reason, "ANCHOR_NOT_IN_TRANSCRIPT");
});

test("insufficient evidence leaves the transcript alone", () => {
  const batch = planAiCorrectionBatch({ segments: segments(), speakerFor, names: [{ proposedValue: "Bardot" }] });
  assert.equal(batch.operations.length, 0, "a proposal with no anchor changes nothing");
  assert.equal(batch.omitted[0].reason, "NO_ANCHOR");
});

test("the whole pass is one transaction, so it can be undone as a unit", () => {
  // Inherited from the overlay, not invented here: transactionSizes groups operations, and undo
  // pops the last transaction. Applying a pass as one transaction is what makes "Undo AI Pass" a
  // single reversible act rather than N separate ones.
  const batch = planAiCorrectionBatch({
    segments: segments(), speakerFor,
    names: [{ wordId: "job:word:2", proposedValue: "Bardot" }, { wordId: "job:word:6", proposedValue: "Zhan" }],
  });
  const overlay = appendTransaction(emptyOverlay("DEP-1"), batch.operations);
  assert.equal(overlay.operations.length, 2);
  assert.deepEqual(overlay.transactionSizes, [2], "two corrections, one transaction");
});

test("a later human edit is its own transaction, so undoing the AI pass cannot erase it", () => {
  // THE SAFETY PROPERTY. Undo pops the LAST transaction. If a human corrects something after the
  // AI pass, their correction is the last transaction -- so an undo reaches their edit first and
  // can never silently discard it to get at the AI pass underneath.
  const batch = planAiCorrectionBatch({
    segments: segments(), speakerFor, names: [{ wordId: "job:word:2", proposedValue: "Bardot" }],
  });
  let overlay = appendTransaction(emptyOverlay("DEP-1"), batch.operations);
  overlay = appendTransaction(overlay, [{ op: "replace", wordId: "job:word:4", text: "sir" }]);
  assert.deepEqual(overlay.transactionSizes, [1, 1], "the human edit is a separate, later transaction");
  assert.equal(overlay.operations.at(-1).wordId, "job:word:4", "and it is the one undo would reach first");
});

test("the pass record can reconstruct what happened", () => {
  const batch = planAiCorrectionBatch({
    segments: segments(), speakerFor,
    names: [{ wordId: "job:word:2", originalValue: "Bardado", proposedValue: "Bardot", confidenceScore: 0.94, evidenceSource: "ROSTER" }],
  });
  const record = correctionPassRecord({
    passId: "pass-1", model: "claude-opus-5", promptVersion: "v2", startedAt: "2026-09-04T00:00:00.000Z",
    reviewStateHash: "state-A", applied: batch.applied, omitted: batch.omitted, operations: batch.operations,
  });
  assert.equal(record.recordType, "AI_CORRECTION_PASS");
  assert.equal(record.appliedBy, "AI_CORRECTION_PASS", "AI edits stay distinguishable from human ones");
  assert.equal(record.reviewStateHash, "state-A", "which transcript it transformed");
  assert.equal(record.model, "claude-opus-5");
  assert.equal(record.promptVersion, "v2");
  assert.equal(record.operationCount, 1);
  assert.equal(record.applied[0].before, "Bardado");
  assert.equal(record.applied[0].after, "Bardot");
  assert.equal(record.applied[0].confidence, 0.94);
  assert.equal(record.applied[0].evidenceSource, "ROSTER");
  assert.ok(record.appliedAt, "and when");
});

test("omitted corrections are recorded too, so nothing disappears unaccounted for", () => {
  const batch = planAiCorrectionBatch({
    segments: segments(), speakerFor,
    names: [{ wordId: "job:word:2", proposedValue: "Bardot" }, { wordId: "job:word:2", proposedValue: "Bardeau" }],
  });
  const record = correctionPassRecord({ passId: "p", applied: batch.applied, omitted: batch.omitted, operations: batch.operations });
  assert.equal(record.omitted.length, 1);
  assert.equal(record.omitted[0].reason, "OVERLAPS_EARLIER_CORRECTION");
});

test("the pass writes no text of its own invention", () => {
  // It plans the operations the reporter's own acceptance path would have planned. The checkable
  // property is narrower and stronger than a word search: the ONLY text this module ever puts into
  // an operation is a value that came from a proposal. If a literal ever appears as operation text,
  // the pass has started composing transcript rather than correcting it.
  //
  // An earlier version of this test searched the source for words like "parenthetical" and
  // "paraphrase" -- and failed, because the module's own documentation of what it must not do
  // contains them. A test that trips on a comment is not testing the code.
  const source = fs.readFileSync(new URL("../server/ai-correction.mjs", import.meta.url), "utf8");
  assert.match(source, /import \{ planRangeAcceptance \}/, "speaker ranges go through the existing planner");

  // Operation text has exactly two ingredients: the proposal's value, and punctuation copied off
  // the word being replaced. Nothing else may reach it, so the check names both and refuses a third.
  const assignments = [...source.matchAll(/\btext:\s*([^,}\n]+)/g)].map(match => match[1].trim());
  assert.ok(assignments.length > 0, "the check must actually find the assignments it grades");
  for (const value of assignments) {
    assert.match(value, /^(proposal\.|preservePunctuation\(was$)/,
      `operation text must come from a proposal, not from this module; found: ${value}`);
  }

  // And the behavioural half, because the grep above can only see how it is written. Whatever the
  // model returns, the ONLY characters that survive around it are the ones the ASR already had.
  const kept = preservePunctuation('"Oconco,"', "Okonkwo");
  assert.equal(kept, '"Okonkwo,"', "punctuation comes from the evidence, the name from the model");
  assert.equal(preservePunctuation("Oconco.", "Mr. Okonkwo"), "Mr. Okonkwo",
    "a proposal that carries its own punctuation is left exactly as proposed");
  assert.equal(preservePunctuation(null, "Okonkwo"), "Okonkwo", "and with no original, nothing is added");
});

test("correcting a name does not delete the sentence's punctuation", () => {
  // FOUND IN QUALIFICATION, and the most consequential of the four. The entity pass may only
  // propose values from the deposition's authoritative name list, and that list holds bare names.
  // So the real model answer "Okonkwo" replaced the token "Oconco." and the sentence lost its full
  // stop; "Kilbride" replaced "Kilbright," and the clause lost its comma. Every corrected name that
  // carried punctuation would have quietly dropped it into a certified record.
  const batch = planAiCorrectionBatch({
    segments: segments(), speakerFor,
    names: [{ wordId: "job:word:2", proposedValue: "Bardot" }],
    textFor: () => "Bardado.",
  });
  assert.deepEqual(batch.operations, [{ op: "replace", wordId: "job:word:2", text: "Bardot." }]);
  assert.equal(batch.applied[0].before, "Bardado.");
  assert.equal(batch.applied[0].after, "Bardot.", "and the audit trail records what actually landed");
});

test("every applied correction names its evidence and confidence", () => {
  const batch = planAiCorrectionBatch({
    segments: segments(), speakerFor,
    names: [{ wordId: "job:word:2", proposedValue: "Bardot", confidenceScore: 0.9, evidenceSource: "ROSTER" }],
    ranges: [{ wordId: "job:word:5", endWordId: "job:word:6", speakerIdentity: "witness-1", confidenceScore: 0.8, evidenceSource: "TRANSCRIPT" }],
  });
  for (const item of batch.applied) {
    assert.ok("confidence" in item, `${item.kind} records confidence`);
    assert.ok("evidenceSource" in item, `${item.kind} records its evidence basis`);
    assert.ok("before" in item && "after" in item, `${item.kind} records before and after`);
    assert.ok(item.correctionType, `${item.kind} records what class of correction it is`);
  }
});

// ---------------------------------------------------------------------------------------------
// The orchestrator. Planning a batch is not the same as applying one safely: what follows tests the
// act itself -- what it runs, what it refuses, what it writes, and in which order.
// ---------------------------------------------------------------------------------------------

// A harness that stands in for the store. It records every call, so a test can assert what the pass
// did NOT do -- which is most of what matters here.
function harness({ transcript = { segments: segments() }, overlay = emptyOverlay("DEP-1"), passes = [] } = {}) {
  const calls = { appended: [], written: [], entity: 0, ranges: 0, boundary: 0, order: [] };
  let current = overlay;
  return {
    calls,
    get overlay() { return current; },
    moveTranscriptTo(next) { current = next; },
    deps: {
      depositionId: "DEP-1", storageRoot: null,
      getWorkingTranscript: () => transcript,
      readReporterOverlay: () => current,
      getSpeakerCandidates: () => ({ candidates: [{ id: "witness-1", defaultRole: "A." }] }),
      appendReporterOperations: (_root, input) => {
        calls.order.push("append");
        calls.appended.push(input);
        current = appendTransaction(current, input.operations);
        return current;
      },
      listPasses: () => passes,
      writePassRecord: (_root, input) => { calls.order.push("write"); calls.written.push(input.record); return input.record; },
      entityPass: async () => { calls.entity++; return { accepted: [{ wordId: "job:word:2", originalValue: "Bardado", proposedValue: "Bardot", confidenceScore: 0.94, evidenceSource: "ROSTER" }] }; },
      speakerRangePass: async () => { calls.ranges++; return { accepted: [] }; },
      // The structural pass, answering that this opening establishes no boundary. Injected rather
      // than defaulted so these tests exercise the orchestration and never the network.
      boundaryPass: async () => { calls.boundary++; return { proposals: [], failures: [], chunksSubmitted: 1 }; },
    },
  };
}

test("the reporter asks once, and the corrections are applied", async () => {
  const store = harness();
  const result = await applyAiCorrectionPass(null, { ...store.deps, apiKey: "key", model: "claude-opus-5" });
  assert.equal(result.status, AI_CORRECTION_STATUS.APPLIED);
  assert.equal(result.operationCount, 1);
  assert.equal(store.calls.appended.length, 1, "one call, so one transaction");
  assert.deepEqual(store.calls.appended[0].operations, [{ op: "replace", wordId: "job:word:2", text: "Bardot" }]);
  assert.deepEqual(store.overlay.transactionSizes, [1], "the whole pass is one undoable unit");
  assert.match(result.message, /1 correction applied in one pass/);

  // FOUND IN QUALIFICATION. Not merely that the overlay holds one transaction, but that the undo
  // control can RECOGNISE it as the pass. The record used to keep the planned operations; the
  // overlay validates and normalises them on the way in, so the two never matched and "Undo AI
  // Correction Pass" was never offered after a pass that had just applied four corrections.
  const undo = aiPassUndoState(null, {
    depositionId: "DEP-1", listPasses: () => store.calls.written, readOverlay: () => store.overlay,
  });
  assert.equal(undo.undoable, true, "the pass it just applied is undoable straight away");
});

test("the batch is guarded by the state it was planned against, not by the state it lands on", async () => {
  // The decisive assertion for a BATCH rather than a queue. The hash carried into the write is the
  // one the AI analysed. If the pass ever passed the post-append state, or null, the guard would
  // pass trivially and corrections could land on a transcript nobody analysed.
  const store = harness();
  const expected = computeReviewStateHash({ transcript: { segments: segments() }, overlay: emptyOverlay("DEP-1") });
  await applyAiCorrectionPass(null, { ...store.deps, apiKey: "key" });
  assert.equal(store.calls.appended[0].expectedReviewStateHash, expected);
});

test("a transcript that moved while the AI was thinking is refused, not rebased", async () => {
  // THE SAFETY PROPERTY the batch shape requires. Analysis takes minutes; if the reporter edits
  // meanwhile, the plan describes text that is no longer there. Applying it anyway would put
  // corrections nobody analysed into an evidentiary record.
  const store = harness();
  const result = await applyAiCorrectionPass(null, {
    ...store.deps, apiKey: "key",
    entityPass: async () => {
      store.moveTranscriptTo(appendTransaction(store.overlay, [{ op: "replace", wordId: "job:word:4", text: "sir" }]));
      return { accepted: [{ wordId: "job:word:2", proposedValue: "Bardot" }] };
    },
  });
  assert.equal(result.status, AI_CORRECTION_STATUS.TRANSCRIPT_MOVED);
  assert.equal(store.calls.appended.length, 0, "nothing was applied");
  assert.equal(store.calls.written.length, 0, "and nothing was recorded as if it had been");
  assert.notEqual(result.expected, result.actual);
  assert.equal(result.retryable, true);
});

test("the record is written only after the corrections have landed", async () => {
  // A pass record written first would describe a change that might never happen -- an audit trail
  // asserting an edit the transcript does not contain.
  const store = harness();
  await applyAiCorrectionPass(null, { ...store.deps, apiKey: "key" });
  assert.deepEqual(store.calls.order, ["append", "write"]);
  assert.equal(store.calls.written[0].recordType, "AI_CORRECTION_PASS");
  assert.equal(store.calls.written[0].appliedBy, "AI_CORRECTION_PASS", "not attributed to the reporter");
});

test("running it twice on an unchanged transcript buys one pass", async () => {
  const before = computeReviewStateHash({ transcript: { segments: segments() }, overlay: emptyOverlay("DEP-1") });
  const store = harness({ passes: [{ passId: "p1", reviewStateHash: before, operations: [] }] });
  const result = await applyAiCorrectionPass(null, { ...store.deps, apiKey: "key" });
  assert.equal(result.status, AI_CORRECTION_STATUS.ALREADY_CORRECTED);
  assert.equal(store.calls.entity, 0, "no Claude call is spent");
  assert.equal(store.calls.appended.length, 0, "and the corrections are not applied a second time");
});

test("clicking again on the transcript the AI just corrected buys nothing", async () => {
  // The case that actually happens. After a pass applies, the transcript is in a state no pass ever
  // ANALYSED, so a guard that only remembered the analysed state would let the reporter pay again
  // for a look at the AI's own output. The pass records the state it produced as well.
  const store = harness();
  const first = await applyAiCorrectionPass(null, { ...store.deps, apiKey: "key" });
  assert.equal(first.status, AI_CORRECTION_STATUS.APPLIED);

  const applied = store.calls.written[0];
  assert.ok(applied.resultingReviewStateHash, "the pass records the state it left behind");
  assert.notEqual(applied.resultingReviewStateHash, applied.reviewStateHash);

  const again = harness({ overlay: store.overlay, passes: [applied] });
  const second = await applyAiCorrectionPass(null, { ...again.deps, apiKey: "key" });
  assert.equal(second.status, AI_CORRECTION_STATUS.ALREADY_CORRECTED);
  assert.equal(again.calls.entity, 0, "and no second Claude call is spent");
});

test("but a deliberate second pass is honoured", async () => {
  const before = computeReviewStateHash({ transcript: { segments: segments() }, overlay: emptyOverlay("DEP-1") });
  const store = harness({ passes: [{ passId: "p1", reviewStateHash: before, operations: [] }] });
  const result = await applyAiCorrectionPass(null, { ...store.deps, apiKey: "key", force: true });
  assert.equal(result.status, AI_CORRECTION_STATUS.APPLIED);
  assert.equal(store.calls.entity, 1);
});

test("no API key changes nothing and says so", async () => {
  const store = harness();
  const result = await applyAiCorrectionPass(null, { ...store.deps, apiKey: "" });
  assert.equal(result.status, AI_CORRECTION_STATUS.NO_CREDENTIAL);
  assert.equal(store.calls.entity, 0);
  assert.equal(store.calls.appended.length, 0);
  assert.match(result.message, /transcript is unchanged/);
});

test("both passes failing leaves the transcript exactly as it was", async () => {
  const store = harness();
  const result = await applyAiCorrectionPass(null, {
    ...store.deps, apiKey: "key",
    entityPass: async () => { throw new Error("Anthropic timed out"); },
    speakerRangePass: async () => { throw new Error("Anthropic timed out"); },
  });
  assert.equal(result.status, AI_CORRECTION_STATUS.FAILED);
  assert.equal(store.calls.appended.length, 0);
  assert.equal(result.failures.length, 2, "the reasons are reported rather than hidden");
  assert.equal(result.retryable, true);
});

test("one pass failing still applies the other's corrections", async () => {
  const store = harness();
  const result = await applyAiCorrectionPass(null, {
    ...store.deps, apiKey: "key",
    speakerRangePass: async () => { throw new Error("rate limited"); },
  });
  assert.equal(result.status, AI_CORRECTION_STATUS.APPLIED);
  assert.equal(result.operationCount, 1);
  assert.equal(result.failures.length, 1);
});

test("nothing worth applying writes nothing at all", async () => {
  const store = harness();
  const result = await applyAiCorrectionPass(null, {
    ...store.deps, apiKey: "key", entityPass: async () => ({ accepted: [] }),
  });
  assert.equal(result.status, AI_CORRECTION_STATUS.NOTHING_TO_APPLY);
  assert.equal(store.calls.appended.length, 0, "an empty transaction is not an edit");
  assert.equal(store.calls.written.length, 0, "and there is no pass to record");
});

test("the pass is undoable as a unit only while it is still the last transaction", () => {
  // Undo pops the LAST transaction. Offering "Undo AI Correction Pass" after the reporter has
  // edited would remove THEIR work, not the pass -- so the control must withdraw itself instead.
  const operations = [{ op: "replace", wordId: "job:word:2", text: "Bardot" }];
  const pass = { passId: "p1", operationCount: 1, operations };
  const applied = appendTransaction(emptyOverlay("DEP-1"), operations);

  const fresh = aiPassUndoState(null, { depositionId: "DEP-1", listPasses: () => [pass], readOverlay: () => applied });
  assert.equal(fresh.undoable, true);
  assert.equal(fresh.pass.passId, "p1");

  const edited = appendTransaction(applied, [{ op: "replace", wordId: "job:word:4", text: "sir" }]);
  const after = aiPassUndoState(null, { depositionId: "DEP-1", listPasses: () => [pass], readOverlay: () => edited });
  assert.equal(after.undoable, false, "a human edit is what undo would reach first");
  assert.equal(after.reason, "EDITED_SINCE");
});

test("a transaction that merely looks like the pass is not mistaken for it", () => {
  // Comparing counts would accept this: one operation, one transaction, same size. The operations
  // themselves are what identify the pass.
  const pass = { passId: "p1", operationCount: 1, operations: [{ op: "replace", wordId: "job:word:2", text: "Bardot" }] };
  const impostor = appendTransaction(emptyOverlay("DEP-1"), [{ op: "replace", wordId: "job:word:6", text: "Zhan" }]);
  const state = aiPassUndoState(null, { depositionId: "DEP-1", listPasses: () => [pass], readOverlay: () => impostor });
  assert.equal(state.undoable, false);
});

test("no AI pass means nothing to undo, not an error", () => {
  const state = aiPassUndoState(null, { depositionId: "DEP-1", listPasses: () => [], readOverlay: () => emptyOverlay("DEP-1") });
  assert.equal(state.undoable, false);
  assert.equal(state.reason, "NO_AI_PASS");
  assert.equal(state.pass, null);
});

test("the reporter's control applies, and nothing applies on its own", () => {
  // Two directions, both asserted against the shipped surfaces. Transcription must not start a
  // paid pass; the route must derive the transcript state rather than accept it.
  const api = fs.readFileSync(new URL("../server/local-api.mjs", import.meta.url), "utf8");
  const screen = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");

  const transcribe = api.slice(api.indexOf('req.url === "/api/audio/transcribe"'));
  const routeBody = transcribe.slice(0, transcribe.indexOf('if (\n      req.url?.startsWith("/api/transcription/jobs?")'));
  assert.equal(/applyAiCorrectionPass|correctTranscript|runAiReview/.test(routeBody), false,
    "finishing a transcription must not start a paid AI pass");

  assert.match(api, /req\.url === "\/api\/correction\/ai-apply" && req\.method === "POST"/);
  // The route delegates to the one-click orchestrator, which runs the deterministic format pass and
  // then the AI passes. The ordering lives in that one function and not in the route, so there is
  // one place where "what does Correct Transcript do" is answered.
  assert.match(api, /await correctTranscript\(root, \{/);
  const applyRoute = api.slice(api.indexOf('req.url === "/api/correction/ai-apply" && req.method === "POST"'));
  assert.equal(/input\.(reviewStateHash|expectedReviewStateHash)/.test(applyRoute.slice(0, 900)), false,
    "the transcript state is derived on the server, never accepted from the request");

  assert.match(screen, />Correct Transcript</, "the control names what it does");
  assert.match(screen, /Correcting Transcript…/, "and says so while it runs");
  assert.match(screen, /Corrections are applied directly, as one pass you can undo/,
    "and the reporter is told the model where they read it");
  assert.match(screen, /Undo AI Correction Pass/);
  assert.match(screen, /aiUndo\?\.undoable&&<button/, "offered only while the pass is still undoable");
});

// ---------------------------------------------------------------------------------------------
// Three defects the real-Claude synthetic qualification found. Each of these passed every test
// above and still failed against a real model response, which is the whole argument for the run.
// ---------------------------------------------------------------------------------------------

test("a range anchored in a projected transcript is found, not refused", () => {
  // FOUND IN QUALIFICATION. Segments come in two shapes: a rendered projection carries words[], and
  // the segments applyOverlay returns -- which is what the orchestrator and acceptRangeProposal
  // actually pass -- carry asrWordIds[] and no words array. Reading only the first shape refused
  // every real speaker range with ANCHOR_NOT_IN_TRANSCRIPT for anchors plainly in the transcript.
  //
  // The fixture above uses the shape the unit tests were written against. This one uses the shape
  // the caller really sends.
  const projected = [
    { id: "s1", speakerIdentity: null, transcriptRole: null, asrWordIds: ["job:word:1", "job:word:2"] },
    { id: "s2", speakerIdentity: null, transcriptRole: null, asrWordIds: ["job:word:3", "job:word:4"] },
  ];
  assert.deepEqual(
    proposalWordIds({ segments: projected, proposal: { wordId: "job:word:3", endWordId: "job:word:4" } }),
    ["job:word:3", "job:word:4"],
  );
  const batch = planAiCorrectionBatch({
    segments: projected, speakerFor,
    ranges: [{ wordId: "job:word:3", endWordId: "job:word:4", speakerIdentity: "witness-1" }],
  });
  assert.equal(batch.omitted.filter(item => item.reason === "ANCHOR_NOT_IN_TRANSCRIPT").length, 0,
    "the anchor is in the transcript and must not be reported as missing");
  assert.ok(batch.operations.length, "and the range is plannable");
});

test("a correction records what it replaced, not only what it became", () => {
  // FOUND IN QUALIFICATION. The entity pass's schema has no originalValue field, so every applied
  // correction recorded before:null -- an audit trail that cannot say what the transcript said.
  const batch = planAiCorrectionBatch({
    segments: segments(), speakerFor,
    names: [{ wordId: "job:word:2", proposedValue: "Bardot", confidenceScore: 0.9, evidenceSource: "ROSTER" }],
    textFor: id => (id === "job:word:2" ? "Bardado" : null),
  });
  assert.equal(batch.applied[0].before, "Bardado");
  assert.equal(batch.applied[0].after, "Bardot");
});

test("an analysis that wholly failed is a failure, not an empty result", async () => {
  // FOUND IN QUALIFICATION. Each pass catches its own chunk errors and still resolves, so a bad
  // model name produced two HTTP 404s and the reporter was told "The AI found nothing it could
  // correct" -- a false statement about their transcript, and one that invites them to stop
  // looking. Every chunk failing with nothing accepted is that pass failing.
  const store = harness();
  const dead = async () => ({ accepted: [], chunksSubmitted: 2, failures: [
    { chunkId: "c1", code: "CHUNK_FAILED", message: "Claude request failed." },
    { chunkId: "c2", code: "CHUNK_FAILED", message: "Claude request failed." },
  ] });
  const result = await applyAiCorrectionPass(null, { ...store.deps, apiKey: "key", entityPass: dead, speakerRangePass: dead });
  assert.equal(result.status, AI_CORRECTION_STATUS.FAILED);
  assert.equal(result.retryable, true);
  assert.equal(store.calls.appended.length, 0, "and the transcript is untouched");
  assert.ok(result.failures.length >= 2, "with the chunk failures reported rather than hidden");
});

test("one pass wholly failing still applies the other's corrections", async () => {
  const store = harness();
  const result = await applyAiCorrectionPass(null, {
    ...store.deps, apiKey: "key",
    speakerRangePass: async () => ({ accepted: [], chunksSubmitted: 1, failures: [{ code: "CHUNK_FAILED", message: "429" }] }),
  });
  assert.equal(result.status, AI_CORRECTION_STATUS.APPLIED);
  assert.equal(result.operationCount, 1);
});

test("a pass that genuinely found nothing is still nothing to apply", async () => {
  // The distinction the fix must not blur: no failures and no proposals is a real, common answer.
  const store = harness();
  const result = await applyAiCorrectionPass(null, {
    ...store.deps, apiKey: "key",
    entityPass: async () => ({ accepted: [], chunksSubmitted: 2, failures: [] }),
    speakerRangePass: async () => ({ accepted: [], chunksSubmitted: 2, failures: [] }),
  });
  assert.equal(result.status, AI_CORRECTION_STATUS.NOTHING_TO_APPLY);
});

test("the status vocabulary distinguishes the failure modes that matter", () => {
  assert.equal(AI_CORRECTION_STATUS.TRANSCRIPT_MOVED, "transcript-moved");
  assert.equal(AI_CORRECTION_STATUS.ALREADY_CORRECTED, "already-corrected");
  assert.equal(AI_CORRECTION_STATUS.NOTHING_TO_APPLY, "nothing-to-apply");
  assert.equal(AI_CORRECTION_STATUS.FAILED, "failed");
});
