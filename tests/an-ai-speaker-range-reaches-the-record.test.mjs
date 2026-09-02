// The whole path, from what the machine heard to what the transcript says.
//
// Phase A proved that an ACCEPTED range becomes the right overlay operations. This proves the rest
// of it: a pass emits a range proposal, the validator holds it to its authority, the reporter
// accepts one, the server plans it against the projection it was analyzed against, applies it as a
// single transaction, and the existing untouched label model derives Q. and A. from the result.
//
// The fixture is Production Trial #1's shape, reduced. Deepgram cluster 3 there held the witness
// answering the oath AND defending counsel reserving questions AND an utterance nobody could
// identify -- so no whole-cluster statement about it can be true. That is the case this exists for,
// and the tests below insist the remainder STAYS unresolved: a pass that tidies away the part it
// could not identify has manufactured an attribution.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { RANGE_ACCEPTANCE_REFUSED, acceptRangeProposal } from "../server/range-proposal-acceptance.mjs";
import { SPEAKER_RANGE_CORRECTION_TYPES, buildSpeakerRangePrompt, speakerRangeTool } from "../server/speaker-range-prompt.mjs";
import { clustersBySegment, runSpeakerRangePass } from "../server/speaker-range-pass.mjs";
import { speakerEvidenceBuckets, validateSpeakerSuggestions } from "../server/speaker-attribution-pass.mjs";
import { STALE_CORRECTION_PROPOSAL, computeReviewStateHash } from "../server/review-state-hash.mjs";
import { applyOverlay } from "../server/reporter-overlay.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";
import * as jobs from "../server/transcription-jobs.mjs";

const DEPOSITION = "DEP-20260902-RANGE";
const JOB = "job";
const STARTED = "2026-09-02T09:00:00.000Z";
const field = value => ({ value, source: "NOD_EXTRACTED", state: "EXTRACTED", confidence: null, citations: [] });
const W = n => `${JOB}:word:${n}`;

// Six utterances. Cluster 3 is the mixed one: the witness, then counsel, then speech nobody can
// place. Cluster 7 holds one witness answer among strangers, which is the 78:52 shape.
const SEGMENTS = [
  { id: "s1", cluster: 0, identity: "attorney-1", role: "QUESTIONING_ATTORNEY", text: "Please state your name for the record" },
  { id: "s2", cluster: 3, identity: null, role: null, text: "Yes maam I do" },
  { id: "s3", cluster: 3, identity: null, role: null, text: "We will reserve our questions until the time of trial" },
  { id: "s4", cluster: 3, identity: null, role: null, text: "Uh huh" },
  { id: "s5", cluster: 0, identity: "attorney-1", role: "QUESTIONING_ATTORNEY", text: "Do you have the exhibit in front of you" },
  { id: "s6", cluster: 7, identity: null, role: null, text: "I have it" },
];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-range-"));
  const storageRoot = path.join(root, "depos");
  const directory = path.join(storageRoot, "reporter", "cause", "deposition");
  fs.mkdirSync(path.join(directory, "intake"), { recursive: true });
  fs.mkdirSync(path.join(directory, "transcript"), { recursive: true });
  fs.mkdirSync(path.join(directory, "deepgram", "jobs", JOB), { recursive: true });
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ id: DEPOSITION }));
  fs.writeFileSync(path.join(directory, "intake", "intake.json"), JSON.stringify({ keyterms: [] }));
  fs.writeFileSync(path.join(directory, "intake", "canonical-deposition-record.json"), JSON.stringify({
    deposition: { witness: field("Jennifer Baier") },
    reporter: { fullName: field("Miah Bardot") },
    counsel: [
      { id: "attorney-1", fullName: field("Steven A. Nunez"), actualAppearance: field(true), appearanceRole: field("QUESTIONING_ATTORNEY") },
      { id: "attorney-2", fullName: field("Karen Alvarado"), actualAppearance: field(true), appearanceRole: field("DEFENDING_ATTORNEY") },
    ],
    parties: [], participants: { interpreters: [], videographers: [] },
  }));

  const words = [];
  const segments = SEGMENTS.map(segment => {
    const ids = segment.text.split(" ").map(word => {
      const id = W(words.length + 1);
      words.push({ id, word, punctuatedWord: word, start: words.length * 0.5, end: words.length * 0.5 + 0.4, confidence: 0.9, deepgramSpeaker: segment.cluster, speakerConfidence: 0.88 });
      return id;
    });
    return { id: `${JOB}:segment:${segment.id}`, sourceJobIdentity: JOB, asrWordIds: ids, text: segment.text, deepgramSpeaker: segment.cluster, speakerIdentity: segment.identity, transcriptRole: segment.role, start: 0, end: 1 };
  });

  fs.writeFileSync(path.join(directory, "transcript", "working.json"), JSON.stringify({
    schemaVersion: "1.1.0", transcript_hash: "stored-hash", derivedFrom: [JOB], depositionId: DEPOSITION,
    speakerMap: { status: "partially_reconciled", assignments: [{ sourceJobIdentity: JOB, deepgramSpeaker: 0, speakerIdentity: "attorney-1", transcriptRole: "QUESTIONING_ATTORNEY" }] },
    segments,
  }));
  fs.writeFileSync(path.join(directory, "deepgram", "jobs", JOB, "asr-evidence.json"), JSON.stringify({ jobIdentity: JOB, words }));
  return { root, storageRoot, directory, words, segments };
}

const store = value => ({ depositionId: DEPOSITION, storageRoot: value.storageRoot });
const run = (value, submit, extra = {}) => runSpeakerRangePass(null, {
  depositionId: DEPOSITION, storageRoot: value.storageRoot, apiKey: "test-key", model: "claude-test", passStartedAt: STARTED, submit, ...extra,
});
const propose = (wordId, endWordId, speakerIdentity, overrides = {}) =>
  ({ wordId, endWordId, correctionType: "speaker_assignment", speakerIdentity, confidenceScore: 0.86, evidenceSource: "transcript", ...overrides });

/** The full acceptance path against the real store, exactly as the route calls it. */
const accept = (value, proposal, expectedReviewStateHash = null) => acceptRangeProposal(null, {
  ...store(value), proposal, expectedReviewStateHash,
  getWorkingTranscript: jobs.getWorkingTranscript, readReporterOverlay: jobs.readReporterOverlay,
  getSpeakerCandidates: jobs.getSpeakerCandidates, appendReporterOperations: jobs.appendReporterOperations,
});

/** Who owns each word after the overlay is applied, read back from disk every time. */
function attribution(value) {
  const transcript = jobs.getWorkingTranscript(null, store(value));
  const overlay = jobs.readReporterOverlay(null, store(value));
  const applied = applyOverlay(transcript.segments, overlay);
  const owner = new Map();
  for (const segment of applied.segments) for (const id of segment.asrWordIds ?? []) owner.set(id, segment.speakerIdentity ?? null);
  return owner;
}
const wordsOwnedBy = (value, identity) => [...attribution(value)].filter(([, owner]) => owner === identity).map(([id]) => id);
const currentHash = value => computeReviewStateHash({ transcript: jobs.getWorkingTranscript(null, store(value)), overlay: jobs.readReporterOverlay(null, store(value)) });
const ids = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => W(from + i));

/** Word ids by segment, so a test can name a range without counting. */
function segmentWords(value, segmentId) {
  return value.segments.find(segment => segment.id === `${JOB}:segment:${segmentId}`).asrWordIds;
}

/** The refusal itself, because assert.throws does not hand it back. */
function refusal(body) {
  try { body(); } catch (error) { return error; }
  return assert.fail("this was expected to be refused, and was not");
}

function withFixture(body) {
  const value = fixture();
  try { return body(value); } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
}
async function withFixtureAsync(body) {
  const value = fixture();
  try { return await body(value); } finally { fs.rmSync(value.root, { recursive: true, force: true }); }
}

// --- what the pass may say ------------------------------------------------------------------

test("the schema has no field for anything but who spoke", () => {
  // The authority boundary is the schema, not the instructions. An instruction can be misread; a
  // field that does not exist cannot be filled in.
  const properties = speakerRangeTool.input_schema.properties.proposals.items.properties;
  assert.deepEqual(Object.keys(properties).sort(),
    ["confidenceScore", "correctionType", "endWordId", "evidenceSource", "speakerIdentity", "wordId"]);
  assert.deepEqual(properties.correctionType.enum, ["speaker_assignment"], "one value, so the type cannot be chosen");
  assert.equal(speakerRangeTool.input_schema.properties.proposals.items.additionalProperties, false);
  assert.deepEqual(SPEAKER_RANGE_CORRECTION_TYPES, ["speaker_assignment"]);
  // The three things it must never be able to say.
  const serialized = JSON.stringify(speakerRangeTool);
  for (const forbidden of ["QUESTION", "ANSWER", "COLLOQUY", "elementType", "proposedValue", "\"label\"", "\"split\""]) {
    assert.equal(serialized.includes(forbidden), false, `the schema must not offer ${forbidden}`);
  }
});

test("the prompt shows the diarization cluster beside the recorded speaker", () => {
  // The question being asked is whether those two agree, so both have to be visible. A prompt that
  // showed only the cluster would be asking the model to confirm the machine.
  withFixture(value => {
    const transcript = jobs.getWorkingTranscript(null, store(value));
    const clusters = clustersBySegment({ transcript, overlay: jobs.readReporterOverlay(null, store(value)) });
    const chunk = { chunkId: "c1", utterances: [
      { id: `${JOB}:segment:s2`, editable: true, speakerIdentity: null, words: [{ id: W(7), text: "Yes", editable: true }] },
      { id: `${JOB}:segment:s1`, editable: false, speakerIdentity: "attorney-1", words: [{ id: W(1), text: "Please", editable: false }] },
    ] };
    const prompt = buildSpeakerRangePrompt(chunk, { roster: [{ id: "witness", label: "Jennifer Baier", defaultRole: "WITNESS" }], clusters });
    assert.match(prompt, /diarization cluster 3 \| no canonical speaker recorded/);
    assert.match(prompt, /diarization cluster 0 \| recorded as attorney-1/);
    assert.match(prompt, /Yes⟨job:word:7⟩/, "an editable word carries the id a range must anchor to");
    assert.equal(/Please⟨/.test(prompt), false, "a context word carries no id, so it cannot be anchored to by mistake");
  });
});

test("a well-formed range proposal is accepted by the validator and applied by nobody", async () => {
  await withFixtureAsync(async value => {
    const range = segmentWords(value, "s2");
    const record = await run(value, async ({ chunk }) => ({ chunkId: chunk.chunkId, proposals: [propose(range[0], range.at(-1), "witness")] }));
    assert.deepEqual(record.declined, []);
    assert.equal(record.accepted.length, 1);
    assert.equal(record.applied, false, "a pass proposes; it never applies");
    assert.deepEqual(record.appliedOperations, []);
    assert.equal(record.proposalLevel, "RANGE");
    assert.equal(record.passType, "speaker-range");

    const [proposal] = record.accepted;
    assert.equal(proposal.reviewStateHash, record.reviewStateHash, "the proposal carries the state it was made against");
    assert.equal(proposal.text, "Yes maam I do", "the reporter is shown the exact words");
    assert.equal(proposal.wordCount, 4);
    assert.deepEqual(proposal.deepgramSpeakers, [3], "and what the machine thought");
    assert.equal(proposal.currentSpeakerIdentity, null);
    assert.equal(Number.isFinite(proposal.startTime), true, "with a timestamp to find it by");
    assert.equal(proposal.confidenceScore, 0.86);
    assert.equal(proposal.evidenceSource, "transcript");

    // And nothing reached the transcript.
    assert.deepEqual(jobs.readReporterOverlay(null, store(value)).operations, []);
    assert.deepEqual(wordsOwnedBy(value, "witness"), []);
  });
});

test("the pass cannot do anything but assign a speaker, whatever it returns", async () => {
  // Enforced by the validator, not by the prompt. An instruction is a request; a gate is a rule.
  await withFixtureAsync(async value => {
    const range = segmentWords(value, "s2");
    const record = await run(value, async ({ chunk }) => ({ chunkId: chunk.chunkId, proposals: [
      { wordId: range[0], correctionType: "word_replacement", proposedValue: "No", confidenceScore: 0.9, evidenceSource: "transcript" },
      { wordId: range[1], correctionType: "structure", proposedValue: null, confidenceScore: 0.9, evidenceSource: "transcript" },
      { wordId: range[2], correctionType: "spelling", proposedValue: "Baier", confidenceScore: 0.9, evidenceSource: "keyterm" },
    ] }));
    assert.equal(record.accepted.length, 0);
    assert.deepEqual(record.declined.map(item => item.rule), ["R13", "R13", "R13"]);
  });
});

test("a speaker proposal carrying text is declined, and a range over a number is not", async () => {
  // Both halves of a defect this had before it was measured. R12 compared the digits of the spanned
  // testimony against the digits of the proposed value, so a speaker assignment over "I was 42
  // then" was refused as DIGITS_ALTERED -- a rule about rewriting testimony, firing on a proposal
  // that changes no text at all. R9 meanwhile made the pass emit a text value it has no authority
  // over. A speaker assignment proposes an identity, so it may carry no text and the text rules do
  // not apply to it.
  await withFixtureAsync(async value => {
    const range = segmentWords(value, "s2");
    const record = await run(value, async ({ chunk }) => ({ chunkId: chunk.chunkId, proposals: [
      propose(range[0], range.at(-1), "witness", { proposedValue: "Jennifer Baier" }),
    ] }));
    assert.equal(record.accepted.length, 0);
    assert.equal(record.declined[0].code, "SPEAKER_ASSIGNMENT_CARRIES_TEXT");
  });
  // The digit case, exercised directly against the validator because the fixture's testimony has
  // no numbers in it and inventing some would hide what is being tested.
  const { validateProposals } = await import("../server/correction-validator.mjs");
  const words = ["I", "was", "42", "then"].map((text, index) => ({ id: `j:word:${index + 1}`, text, editable: true }));
  const chunk = { chunkId: "c1", passId: "p1", reviewStateHash: "h1", utterances: [{ id: "u1", editable: true, words }] };
  const verdict = validateProposals({ chunkId: "c1", passId: "p1", reviewStateHash: "h1", proposals: [
    { wordId: "j:word:1", endWordId: "j:word:4", correctionType: "speaker_assignment", speakerIdentity: "witness", confidenceScore: 0.9, evidenceSource: "transcript" },
  ] }, { chunk, roster: new Set(["witness"]), allowedCorrectionTypes: ["speaker_assignment"] });
  assert.equal(verdict.accepted.length, 1, "a range spanning a number is a range like any other");
  assert.deepEqual(verdict.declined, []);
});

test("an identity outside this deposition's roster is declined by the pass", async () => {
  await withFixtureAsync(async value => {
    const range = segmentWords(value, "s3");
    const record = await run(value, async ({ chunk }) => ({ chunkId: chunk.chunkId, proposals: [propose(range[0], range.at(-1), "attorney-karen-alvarado")] }));
    assert.equal(record.accepted.length, 0);
    assert.equal(record.declined[0].rule, "R11");
    assert.equal(record.declined[0].attemptedIdentity, "attorney-karen-alvarado", "reported verbatim: the finding is that a person absent from the record was proposed");
  });
});

test("two proposals claiming the same word are both declined", async () => {
  // R5, and both go rather than the later one: there is no ground for preferring whichever
  // happened to be serialized first, and a speaker is exactly the thing they disagree about.
  await withFixtureAsync(async value => {
    const range = segmentWords(value, "s2");
    const record = await run(value, async ({ chunk }) => ({ chunkId: chunk.chunkId, proposals: [
      propose(range[0], range[2], "witness"),
      propose(range[2], range[3], "attorney-2"),
    ] }));
    assert.equal(record.accepted.length, 0);
    assert.deepEqual(record.declined.map(item => item.rule), ["R5", "R5"]);
  });
});

// --- the mixed cluster, which is why this exists ------------------------------------------------

test("one diarization cluster can name two people and still leave a remainder unresolved", async () => {
  // Trial #1's DG 3: the witness answering the oath, counsel reserving questions, and speech
  // nobody could place. No statement about the cluster is true, so none is made about it.
  await withFixtureAsync(async value => {
    const oath = segmentWords(value, "s2"), reserve = segmentWords(value, "s3"), unplaced = segmentWords(value, "s4");
    const record = await run(value, async ({ chunk }) => ({ chunkId: chunk.chunkId, proposals: [
      propose(oath[0], oath.at(-1), "witness"),
      propose(reserve[0], reserve.at(-1), "attorney-2"),
    ] }));
    assert.equal(record.accepted.length, 2);
    assert.deepEqual(record.accepted.map(item => item.speakerIdentity), ["witness", "attorney-2"]);
    for (const proposal of record.accepted) assert.deepEqual(proposal.deepgramSpeakers, [3], "both ranges come from the same cluster");

    for (const proposal of record.accepted) accept(value, { ...proposal, reviewStateHash: currentHash(value) });

    const owner = attribution(value);
    assert.deepEqual(oath.map(id => owner.get(id)), oath.map(() => "witness"));
    assert.deepEqual(reserve.map(id => owner.get(id)), reserve.map(() => "attorney-2"));
    // The part that matters. A pass that tidied this away would have manufactured an attribution.
    assert.deepEqual(unplaced.map(id => owner.get(id)), unplaced.map(() => null), "the remainder stays unresolved");

    // And the speaker map still says nothing about cluster 3.
    const transcript = jobs.getWorkingTranscript(null, store(value));
    assert.equal(transcript.speakerMap.assignments.some(item => item.deepgramSpeaker === 3), false,
      "a range assignment never becomes a global one");
  });
});

test("the whole-cluster pass is unchanged and still answers a different question", () => {
  // GLOBAL is not retired by RANGE. Five of Trial #1's eight clusters were one person throughout,
  // and for those a single bucket proposal says in one line what dozens of ranges would.
  withFixture(value => {
    const transcript = jobs.getWorkingTranscript(null, store(value));
    const buckets = speakerEvidenceBuckets(transcript.segments);
    assert.deepEqual(buckets.map(item => item.deepgramSpeaker).sort(), [0, 3, 7]);
    for (const bucket of buckets) assert.equal(bucket.key, `${JOB}:${bucket.deepgramSpeaker}`, "addressed by bucket, as before");

    const verdict = validateSpeakerSuggestions({ proposals: [
      { sourceJobIdentity: JOB, deepgramSpeaker: 0, speakerIdentity: "attorney-1", missingParticipantName: null, transcriptRole: "QUESTIONING_ATTORNEY", confidence: 0.95, evidence: "states his appearance" },
    ] }, { buckets, candidates: jobs.getSpeakerCandidates(null, store(value)).candidates, roles: jobs.getSpeakerCandidates(null, store(value)).roles });
    assert.equal(verdict.length, 1);
    assert.equal("wordId" in verdict[0], false, "a GLOBAL proposal has no range and must never look like one");
    assert.equal("endWordId" in verdict[0], false);
  });
});

test("a range proposal is labelled as one, so it cannot be mistaken for a whole-cluster proposal", async () => {
  // The reporter is being asked to believe different things: a whole cluster, or a stretch of words
  // they can read. A review surface that cannot tell them apart is asking the wrong question.
  await withFixtureAsync(async value => {
    const range = segmentWords(value, "s6");
    const record = await run(value, async ({ chunk }) => ({ chunkId: chunk.chunkId, proposals: [propose(range[0], range.at(-1), "witness")] }));
    assert.equal(record.proposalLevel, "RANGE");
    assert.equal(record.accepted[0].proposalLevel, "RANGE");
    assert.equal(typeof record.accepted[0].text, "string", "and it carries the words, which a bucket proposal cannot");
  });
});

// --- acceptance, one shape at a time -------------------------------------------------------------

test("a range that is exactly one utterance", () => {
  withFixture(value => {
    const range = segmentWords(value, "s2");
    accept(value, { ...propose(range[0], range.at(-1), "witness"), reviewStateHash: currentHash(value) });
    assert.deepEqual(wordsOwnedBy(value, "witness"), range);
  });
});

test("a range starting at an utterance's first word", () => {
  withFixture(value => {
    const range = segmentWords(value, "s3");
    accept(value, { ...propose(range[0], range[3], "attorney-2"), reviewStateHash: currentHash(value) });
    assert.deepEqual(wordsOwnedBy(value, "attorney-2"), range.slice(0, 4));
  });
});

test("a range ending at an utterance's last word", () => {
  withFixture(value => {
    const range = segmentWords(value, "s3");
    accept(value, { ...propose(range[4], range.at(-1), "attorney-2"), reviewStateHash: currentHash(value) });
    assert.deepEqual(wordsOwnedBy(value, "attorney-2"), range.slice(4));
  });
});

test("a range wholly inside an utterance, touching neither edge", () => {
  withFixture(value => {
    const range = segmentWords(value, "s3");
    accept(value, { ...propose(range[2], range[5], "attorney-2"), reviewStateHash: currentHash(value) });
    assert.deepEqual(wordsOwnedBy(value, "attorney-2"), range.slice(2, 6), "and the words either side keep what they had");
  });
});

test("a range crossing utterances, covering a whole one in the middle", () => {
  // The shape that hid a planner defect in Phase A, so it is asserted here against the real store
  // rather than against a fixture built to suit it.
  withFixture(value => {
    const first = segmentWords(value, "s2"), middle = segmentWords(value, "s3"), last = segmentWords(value, "s4");
    accept(value, { ...propose(first[2], last[0], "attorney-2"), reviewStateHash: currentHash(value) });
    assert.deepEqual(wordsOwnedBy(value, "attorney-2"), [...first.slice(2), ...middle, last[0]]);
  });
});

test("nothing outside the accepted range changes hands", () => {
  // The failure this whole layer exists to prevent, checked against every word in the transcript
  // rather than against the ones nearby.
  withFixture(value => {
    const before = attribution(value);
    const range = segmentWords(value, "s3");
    const accepted = new Set(range.slice(1, 5));
    accept(value, { ...propose(range[1], range[4], "attorney-2"), reviewStateHash: currentHash(value) });
    const after = attribution(value);
    for (const [id, owner] of before) {
      if (accepted.has(id)) assert.equal(after.get(id), "attorney-2", `${id} was accepted`);
      else assert.equal(after.get(id), owner, `${id} was not accepted and must be untouched`);
    }
  });
});

test("one acceptance is one transaction, however many operations it needs", () => {
  withFixture(value => {
    const range = segmentWords(value, "s3");
    const result = accept(value, { ...propose(range[2], range[5], "attorney-2"), reviewStateHash: currentHash(value) });
    assert.equal(result.operations.length, 2, "this shape needs two cuts");
    const overlay = jobs.readReporterOverlay(null, store(value));
    assert.deepEqual(overlay.transactionSizes, [2], "recorded as one reporter action, not two");
    assert.deepEqual(overlay.operations.map(item => item.op), ["split", "split"]);
  });
});

test("one undo restores the whole accepted range, and one redo restores it again", () => {
  withFixture(value => {
    const range = segmentWords(value, "s3");
    const before = attribution(value);
    accept(value, { ...propose(range[2], range[5], "attorney-2"), reviewStateHash: currentHash(value) });
    assert.equal(wordsOwnedBy(value, "attorney-2").length, 4);

    const { removed } = jobs.undoReporterOperation(null, { ...store(value), expectedReviewStateHash: currentHash(value) });
    assert.equal(removed.length, 2, "the whole plan came back, not its last operation");
    assert.deepEqual([...attribution(value)], [...before], "and the transcript is exactly as it was");

    const { restored } = jobs.redoReporterOperation(null, { ...store(value), expectedReviewStateHash: currentHash(value) });
    assert.equal(restored.length, 2);
    assert.deepEqual(wordsOwnedBy(value, "attorney-2"), range.slice(2, 6), "redo restores the complete accepted range");
  });
});

test("a rejected proposal changes nothing, because rejection is not an act", () => {
  // There is no reject path and there must not be one. A proposal that is not accepted is a record
  // on disk that was never applied, and the transcript never knew about it.
  withFixture(value => {
    const before = attribution(value);
    assert.deepEqual(jobs.readReporterOverlay(null, store(value)).operations, []);
    assert.deepEqual([...attribution(value)], [...before]);
  });
});

// --- what acceptance refuses ---------------------------------------------------------------------

test("a proposal generated against a transcript that has since moved is refused, never rebased", () => {
  // And this is the projection question Phase A left open. The hash covers the stored transcript,
  // the speaker map and every overlay operation in order -- the exact inputs a segment projection
  // is reduced from. So hash agreement PROVES the current projection is the analyzed one, and a
  // difference means the segments have moved under the range.
  withFixture(value => {
    const range = segmentWords(value, "s3");
    const proposal = { ...propose(range[2], range[5], "attorney-2"), reviewStateHash: currentHash(value) };

    // The reporter splits that very utterance by hand first, which is what moves the segments.
    jobs.appendReporterOperations(null, { ...store(value), operations: [{ op: "split", beforeWordId: range[4] }], expectedReviewStateHash: currentHash(value) });

    const error = refusal(() => accept(value, proposal));
    assert.equal(error.code, STALE_CORRECTION_PROPOSAL);
    assert.equal(error.carried, proposal.reviewStateHash);
    assert.notEqual(error.expected, proposal.reviewStateHash);

    // One operation on disk: the reporter's own split. Nothing was applied against the new shape.
    assert.equal(jobs.readReporterOverlay(null, store(value)).operations.length, 1);
    assert.deepEqual(wordsOwnedBy(value, "attorney-2"), []);
  });
});

test("a reporter acting on a screen that has moved is refused even when the proposal is current", () => {
  // Two different questions, and both are asked. The proposal carries the state it was ANALYZED
  // against; the client carries the state the reporter was LOOKING AT when they pressed Accept.
  withFixture(value => {
    const range = segmentWords(value, "s3");
    const proposal = { ...propose(range[2], range[5], "attorney-2"), reviewStateHash: currentHash(value) };
    const error = refusal(() => accept(value, proposal, "a-hash-from-a-stale-screen"));
    assert.equal(error.code, STALE_CORRECTION_PROPOSAL);
    assert.deepEqual(jobs.readReporterOverlay(null, store(value)).operations, []);
  });
});

test("a proposal with no review-state hash cannot establish what it was made against, so it is refused", () => {
  withFixture(value => {
    const range = segmentWords(value, "s2");
    const error = refusal(() => accept(value, propose(range[0], range.at(-1), "witness")));
    assert.equal(error.code, STALE_CORRECTION_PROPOSAL);
  });
});

test("an identity outside the roster is refused at acceptance too, not only when proposed", () => {
  // The validator's verdict was about the roster as it stood then. A participant can leave the
  // record between a proposal and its acceptance.
  withFixture(value => {
    const range = segmentWords(value, "s2");
    const error = refusal(() => accept(value, { ...propose(range[0], range.at(-1), "attorney-nobody"), reviewStateHash: currentHash(value) }));
    assert.equal(error.code, RANGE_ACCEPTANCE_REFUSED);
    assert.equal(error.reason, "IDENTITY_NOT_IN_ROSTER");
    assert.deepEqual(jobs.readReporterOverlay(null, store(value)).operations, []);
  });
});

test("a proposal that is not a speaker range cannot be applied by this path", () => {
  withFixture(value => {
    const range = segmentWords(value, "s2");
    const error = refusal(() => accept(value, { ...propose(range[0], range.at(-1), "witness"), correctionType: "word_replacement", reviewStateHash: currentHash(value) }));
    assert.equal(error.reason, "NOT_A_SPEAKER_RANGE");
  });
});

test("a range whose words are gone is refused, and writes nothing", () => {
  withFixture(value => {
    const error = refusal(() => accept(value, { ...propose(W(999), W(1000), "witness"), reviewStateHash: currentHash(value) }));
    assert.equal(error.reason, "START_WORD_NOT_FOUND");
    assert.deepEqual(jobs.readReporterOverlay(null, store(value)).operations, []);
  });
});

// --- what must survive ----------------------------------------------------------------------------

test("the evidence underneath is untouched by an accepted correction", () => {
  // Raw diarization, word ids, timestamps and confidence are the record of what the machine
  // actually produced. A correction sits above them; it does not rewrite them.
  withFixture(value => {
    const evidenceFile = path.join(value.directory, "deepgram", "jobs", JOB, "asr-evidence.json");
    const before = fs.readFileSync(evidenceFile, "utf8");
    const workingBefore = fs.readFileSync(path.join(value.directory, "transcript", "working.json"), "utf8");

    const range = segmentWords(value, "s3");
    accept(value, { ...propose(range[2], range[5], "attorney-2"), reviewStateHash: currentHash(value) });

    assert.equal(fs.readFileSync(evidenceFile, "utf8"), before, "the ASR evidence is byte-identical");
    assert.equal(fs.readFileSync(path.join(value.directory, "transcript", "working.json"), "utf8"), workingBefore,
      "and so is the stored projection -- a reporter correction lives in the overlay");

    const evidence = JSON.parse(before);
    for (const word of evidence.words) {
      assert.equal(Number.isInteger(word.deepgramSpeaker), true);
      assert.equal(Number.isFinite(word.start) && Number.isFinite(word.end), true);
      assert.equal(Number.isFinite(word.confidence), true);
    }

    // And the diarization cluster still shows on the corrected segments themselves.
    const applied = applyOverlay(jobs.getWorkingTranscript(null, store(value)).segments, jobs.readReporterOverlay(null, store(value)));
    for (const segment of applied.segments) assert.equal(Number.isInteger(segment.deepgramSpeaker), true, "what the machine thought survives under the correction");
    assert.deepEqual(applied.segments.flatMap(segment => segment.asrWordIds), ids(1, value.words.length), "every word id, in order, exactly once");
  });
});

test("an accepted range survives a reload, because it was reconstructed from what is on disk", () => {
  // Every read in this suite goes back to the store, so this asserts what the others assume: the
  // attribution is not held in memory anywhere.
  withFixture(value => {
    const range = segmentWords(value, "s3");
    accept(value, { ...propose(range[2], range[5], "attorney-2"), reviewStateHash: currentHash(value) });
    const overlay = JSON.parse(fs.readFileSync(path.join(value.directory, "transcript", "reporter-overlay.json"), "utf8"));
    assert.deepEqual(overlay.transactionSizes, [2]);
    assert.deepEqual(wordsOwnedBy(value, "attorney-2"), range.slice(2, 6), "read back from the file, not from a cache");
  });
});

// --- the point of the whole architecture ------------------------------------------------------------

test("a corrected speaker derives its own Q. and A., with no proposal asserting either", async () => {
  // What Trial #1 proved by hand at 78:52 and what this checkpoint exists to prove end to end:
  // correct WHO spoke, and the existing untouched label model produces the designation itself.
  //
  // The witness answer in cluster 7 sits between two of counsel's questions, attributed to nobody.
  // Accepting the range gives it an identity, and A. follows without being asked for.
  await withFixtureAsync(async value => {
    const range = segmentWords(value, "s6");
    const record = await run(value, async ({ chunk }) => ({ chunkId: chunk.chunkId, proposals: [propose(range[0], range.at(-1), "witness")] }));
    const [proposal] = record.accepted;

    // Nothing in the proposal says what kind of utterance this is.
    assert.equal("elementType" in proposal, false);
    for (const forbidden of ["QUESTION", "ANSWER", "COLLOQUY"]) {
      assert.equal(JSON.stringify(proposal).includes(forbidden), false, `no proposal may carry ${forbidden}`);
    }

    const render = () => renderTranscript({
      working: jobs.getWorkingTranscript(null, store(value)),
      evidence: [JSON.parse(fs.readFileSync(path.join(value.directory, "deepgram", "jobs", JOB, "asr-evidence.json"), "utf8"))],
      speakerCandidates: jobs.getSpeakerCandidates(null, store(value)).candidates,
      examinerIdentity: "attorney-1",
      overlay: jobs.readReporterOverlay(null, store(value)),
    });
    const answerParagraph = result => result.paragraphs.find(item => (item.asrWordIds ?? []).includes(range[0]));

    const before = answerParagraph(render());
    assert.notEqual(before.label, "A.", "the fixture must start unattributed for this to prove anything");

    const result = accept(value, { ...proposal, reviewStateHash: currentHash(value) });
    for (const operation of result.operations) {
      assert.equal("elementType" in operation, false, "and no operation asserts it either");
      assert.ok(["label", "split"].includes(operation.op), "only operations that already existed");
    }

    const after = answerParagraph(render());
    assert.equal(after.label, "A.", "the existing label model derived the designation from the accepted speaker");
    assert.equal(after.speakerIdentity, "witness");
    assert.equal(after.deepgramSpeaker, 7, "and the diarization cluster still shows what the machine thought");

    // The examiner's own question is still a question, derived the same way and unaffected.
    const question = render().paragraphs.find(item => (item.asrWordIds ?? []).includes(segmentWords(value, "s5")[0]));
    assert.equal(question.label, "Q.");
  });
});

test("counsel who is not examining produces colloquy, not a question", () => {
  // The third fact, still separate. Accepting a speaker says who spoke and nothing else; whether
  // that speech is Q., A. or colloquy follows from the examination state, which this pass cannot
  // touch and did not.
  withFixture(value => {
    const range = segmentWords(value, "s3");
    accept(value, { ...propose(range[0], range.at(-1), "attorney-2"), reviewStateHash: currentHash(value) });
    const result = renderTranscript({
      working: jobs.getWorkingTranscript(null, store(value)),
      evidence: [JSON.parse(fs.readFileSync(path.join(value.directory, "deepgram", "jobs", JOB, "asr-evidence.json"), "utf8"))],
      speakerCandidates: jobs.getSpeakerCandidates(null, store(value)).candidates,
      examinerIdentity: "attorney-1",
      overlay: jobs.readReporterOverlay(null, store(value)),
    });
    const paragraph = result.paragraphs.find(item => (item.asrWordIds ?? []).includes(range[0]));
    assert.equal(paragraph.speakerIdentity, "attorney-2");
    assert.notEqual(paragraph.label, "Q.", "the defending attorney is not the examiner, so this is not a question");
  });
});
