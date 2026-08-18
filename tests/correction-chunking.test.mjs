import assert from "node:assert/strict";
import test from "node:test";
import { emptyOverlay } from "../server/reporter-overlay.mjs";
import { buildCorrectionChunks, CHUNK_BOUNDARY_CONFLICT, CHUNK_LIMITS, computePassId } from "../server/correction-chunker.mjs";
import { validateChunk, validateChunkSet, validateProposals } from "../server/correction-validator.mjs";

const JOB = "job";
const WORD = n => `${JOB}:word:${n}`;
const SEGMENT = n => `${JOB}:segment:${n}`;
const STARTED = "2026-08-18T14:00:00.000Z";
// Fixture words carry no digits, because R12 refuses any correction that alters one. Naming them
// w1..wN would have made every fixture word look like substantive testimony to that rule.
const alpha = n => String(n).split("").map(digit => "abcdefghij"[Number(digit)]).join("");

/** Alternating question and answer turns, which is what a deposition mostly is. */
function fixture({ utterances = 40, wordsPer = 10, sizes = null } = {}) {
  const counts = sizes ?? Array.from({ length: utterances }, () => wordsPer);
  const evidenceWords = [];
  const segments = [];
  let n = 0;
  counts.forEach((count, index) => {
    const ids = [];
    for (let w = 0; w < count; w += 1) {
      n += 1;
      ids.push(WORD(n));
      evidenceWords.push({ id: WORD(n), word: `w${alpha(n)}`, punctuatedWord: `w${alpha(n)}`, start: n * 0.5, end: n * 0.5 + 0.4, confidence: 0.99, deepgramSpeaker: index % 2, speakerConfidence: 0.9 });
    }
    segments.push({
      id: SEGMENT(index + 1), sourceJobIdentity: JOB, asrWordIds: ids, text: ids.join(" "),
      deepgramSpeaker: index % 2,
      speakerIdentity: index % 2 === 0 ? "attorney-1" : "witness",
      transcriptRole: index % 2 === 0 ? "QUESTIONING_ATTORNEY" : "WITNESS",
      start: ids.length ? Number(ids[0].split(":")[2]) * 0.5 : null, end: null,
    });
  });

  const transcript = {
    depositionId: "DEP-TEST", transcript_hash: "stored-hash", derivedFrom: [JOB],
    speakerMap: { status: "reconciled", reconciledAt: STARTED, assignments: [
      { sourceJobIdentity: JOB, deepgramSpeaker: 0, speakerIdentity: "attorney-1", transcriptRole: "QUESTIONING_ATTORNEY" },
      { sourceJobIdentity: JOB, deepgramSpeaker: 1, speakerIdentity: "witness", transcriptRole: "WITNESS" },
    ] },
    segments,
  };
  const canonical = {
    wordIds: new Set(evidenceWords.map(word => word.id)),
    utteranceIds: new Set(segments.map(segment => segment.id)),
    utteranceWordCounts: new Map(segments.map(segment => [segment.id, segment.asrWordIds.length])),
  };
  return { transcript, evidence: [{ jobIdentity: JOB, words: evidenceWords }], canonical };
}

const build = (parts, overlay, limits) => buildCorrectionChunks(
  { depositionId: "DEP-TEST", transcript: parts.transcript, evidence: parts.evidence, overlay: overlay ?? emptyOverlay("DEP-TEST"), passStartedAt: STARTED },
  limits,
);

const editableOf = chunk => chunk.utterances.filter(u => u.editable).flatMap(u => u.words.filter(w => w.editable));

// -------------------------------------------------------------------------------------------
// The chunker
// -------------------------------------------------------------------------------------------

test("an utterance is never split across chunks",()=>{
  // The rule the whole design turns on. Half a sentence has no speaker attached to its remainder,
  // and a proposal made against half a sentence cannot be judged.
  const parts = fixture({ utterances: 60 });
  const { chunks } = build(parts);
  assert.ok(chunks.length > 1, "the fixture must actually produce more than one chunk");
  for (const chunk of chunks) {
    for (const utterance of chunk.utterances) {
      assert.equal(utterance.words.length, parts.canonical.utteranceWordCounts.get(utterance.id), `${utterance.id} is held whole`);
    }
  }
});

test("every editable word has exactly one owner, and every word has one",()=>{
  // Two chunks each able to correct the same word can return two valid contradictory proposals,
  // and nothing downstream could decide between them.
  const parts = fixture({ utterances: 80 });
  const { chunks } = build(parts);
  const owners = new Map();
  for (const chunk of chunks) for (const word of editableOf(chunk)) owners.set(word.id, (owners.get(word.id) ?? 0) + 1);
  for (const id of parts.canonical.wordIds) assert.equal(owners.get(id), 1, `${id} has exactly one owner`);
  assert.equal(owners.size, parts.canonical.wordIds.size);
});

test("overlap is context and never an anchor site",()=>{
  const parts = fixture({ utterances: 80 });
  const { chunks } = build(parts);
  const middle = chunks[1];
  const context = middle.utterances.filter(u => !u.editable);
  assert.ok(context.length > 0, "a middle chunk carries context");
  for (const utterance of context) for (const word of utterance.words) assert.equal(word.editable, false);
  // And the context really is the neighbouring text, not a copy of the body.
  const bodyIds = new Set(editableOf(middle).map(word => word.id));
  for (const utterance of context) for (const word of utterance.words) assert.equal(bodyIds.has(word.id), false);
});

test("the word ceiling and the overlap allowance are both respected",()=>{
  const parts = fixture({ utterances: 120 });
  const { chunks } = build(parts);
  for (const chunk of chunks) {
    assert.ok(chunk.editableWordCount <= CHUNK_LIMITS.maxEditableWords, `${chunk.chunkId} is within the ceiling`);
    assert.ok(chunk.serializedBytes <= CHUNK_LIMITS.maxSerializedBytes);
    for (const side of [chunk.utterances.filter(u => !u.editable)]) {
      const words = side.reduce((total, u) => total + u.words.length, 0);
      assert.ok(words <= CHUNK_LIMITS.maxOverlapWords * 2, "leading and trailing overlap each stay within allowance");
    }
  }
});

test("a question and its answer are not separated when both roles are known",()=>{
  // And when a budget genuinely forces it, the split is recorded rather than passed over silently.
  const parts = fixture({ utterances: 120 });
  const { chunks, findings } = build(parts);
  const recorded = new Set(findings.map(finding => finding.questionUtteranceId));
  for (let index = 1; index < chunks.length; index += 1) {
    const last = chunks[index - 1].utterances.filter(u => u.editable).at(-1);
    const first = chunks[index].utterances.filter(u => u.editable)[0];
    if (last.transcriptRole === "QUESTIONING_ATTORNEY" && first.transcriptRole === "WITNESS") {
      assert.ok(recorded.has(last.id), `a forced Q/A split at ${last.id} must be reported`);
    }
  }
});

test("roles are used when known and never inferred when absent",()=>{
  // The failure this prevents: treating an unlabelled turn as a question because it looks like one.
  const parts = fixture({ utterances: 120 });
  for (const segment of parts.transcript.segments) { segment.transcriptRole = null; segment.speakerIdentity = null; }
  const { chunks, findings } = build(parts);
  assert.equal(findings.length, 0, "no pairing claims can be made about unlabelled turns");
  for (const chunk of chunks) for (const utterance of chunk.utterances) assert.equal(utterance.transcriptRole, null);
});

test("an utterance above the ceiling stops the pass rather than being split",()=>{
  const parts = fixture({ sizes: [10, 400, 10] });
  assert.throws(() => build(parts), error => {
    assert.equal(error.code, CHUNK_BOUNDARY_CONFLICT);
    assert.equal(error.utteranceId, SEGMENT(2));
    assert.equal(error.editableWords, 400);
    return true;
  });
});

test("the serialized ceiling is a boundary condition, not a violation found afterwards",()=>{
  const parts = fixture({ utterances: 60 });
  const { chunks } = build(parts, null, { maxSerializedBytes: 6_000 });
  assert.ok(chunks.length > 3, "a tight byte budget must produce more chunks");
  for (const chunk of chunks) assert.ok(chunk.serializedBytes <= 6_000, `${chunk.chunkId} measured ${chunk.serializedBytes}`);
});

test("under a budget too tight for both, context is surrendered before work is",()=>{
  // Overlap is discretionary and the editable body is the task, so a chunk gives up context first
  // and says so. The finding is the point: a reviewer who saw less of the surrounding transcript
  // than the design intends is a fact about the pass, not an implementation detail.
  const parts = fixture({ utterances: 20 });
  const { chunks, findings } = build(parts, null, { maxSerializedBytes: 2_000 });
  for (const chunk of chunks) assert.ok(chunk.serializedBytes <= 2_000, `${chunk.chunkId} measured ${chunk.serializedBytes}`);

  const reduced = findings.filter(finding => finding.code === "OVERLAP_REDUCED_BY_BUDGET");
  assert.ok(reduced.length > 0, "surrendering context must be reported, never silent");
  assert.ok(reduced.every(finding => finding.allowedOverlapWords < finding.configured));

  // And the work itself is still whole: every word is still owned exactly once.
  const owners = new Map();
  for (const chunk of chunks) for (const word of editableOf(chunk)) owners.set(word.id, (owners.get(word.id) ?? 0) + 1);
  for (const id of parts.canonical.wordIds) assert.equal(owners.get(id), 1);
});

test("identity is deterministic, and moves only when the transcript does",()=>{
  const parts = fixture({ utterances: 40 });
  const first = build(parts);
  const second = build(parts);
  assert.deepEqual(second.chunks.map(c => c.chunkId), first.chunks.map(c => c.chunkId));
  assert.equal(second.passId, computePassId("DEP-TEST", STARTED));
  assert.notEqual(
    buildCorrectionChunks({ depositionId: "DEP-TEST", transcript: parts.transcript, evidence: parts.evidence, overlay: emptyOverlay("DEP-TEST"), passStartedAt: "2026-08-18T15:00:00.000Z" }).passId,
    first.passId,
  );
  const edited = build(parts, { ...emptyOverlay("DEP-TEST"), operations: [{ op: "replace", wordId: WORD(3), text: "corrected" }] });
  assert.notEqual(edited.reviewStateHash, first.reviewStateHash, "an edit changes what the chunks were cut from");
  assert.notEqual(edited.chunks[0].chunkHash, first.chunks[0].chunkHash, "and changes the content hash of the chunk holding it");
});

test("a chunk shows the transcript as it currently reads",()=>{
  // Deleted words are gone, replacements carry the reporter's text under the evidence id, and
  // authored insertions are visible but never editable -- they have no evidence to anchor to.
  const parts = fixture({ utterances: 6 });
  const overlay = { ...emptyOverlay("DEP-TEST"), operations: [
    { op: "delete", wordId: WORD(2) },
    { op: "replace", wordId: WORD(3), text: "Elizondo" },
    { op: "insert", afterWordId: WORD(4), text: "Vargas" },
  ] };
  const [chunk] = build(parts, overlay).chunks;
  const words = chunk.utterances.flatMap(u => u.words);
  assert.equal(words.some(word => word.id === WORD(2)), false, "a deleted word is not in the transcript");
  assert.equal(words.find(word => word.id === WORD(3)).text, "Elizondo");
  const authored = words.find(word => word.authored);
  assert.equal(authored.text, "Vargas");
  assert.equal(authored.editable, false, "reporter-authored text carries no evidence id and is not correctable here");
  assert.equal(editableOf(chunk).some(word => word.authored), false);
});

// -------------------------------------------------------------------------------------------
// The outbound gate
// -------------------------------------------------------------------------------------------

test("a chunk set this codebase built passes its own gate",()=>{
  const parts = fixture({ utterances: 90 });
  const { chunks } = build(parts);
  const result = validateChunkSet(chunks, { canonical: parts.canonical, limits: CHUNK_LIMITS });
  assert.deepEqual(result.violations, []);
  assert.equal(result.ok, true);
});

test("the outbound gate catches what a bug here would produce",()=>{
  const parts = fixture({ utterances: 40 });
  const { chunks } = build(parts);
  const options = { canonical: parts.canonical, limits: CHUNK_LIMITS };
  const codesOf = chunk => validateChunk(chunk, options).violations.map(v => `${v.rule}:${v.code}`);
  const clone = () => JSON.parse(JSON.stringify(chunks[1]));

  const unknown = clone();
  unknown.utterances[0].words[0].id = `${JOB}:word:999999`;
  assert.ok(codesOf(unknown).includes("V1:UNKNOWN_WORD_ID"));

  const strange = clone();
  strange.utterances[0].id = `${JOB}:segment:999999`;
  assert.ok(codesOf(strange).includes("V2:UNKNOWN_UTTERANCE_ID"));

  const duplicated = clone();
  duplicated.utterances.push(JSON.parse(JSON.stringify(duplicated.utterances[0])));
  assert.ok(codesOf(duplicated).includes("V4:DUPLICATE_WORD_ID"));

  const leaked = clone();
  const context = leaked.utterances.find(u => !u.editable);
  context.words[0].editable = true;
  assert.ok(codesOf(leaked).includes("V6:EDITABLE_WORD_IN_OVERLAP"), "an anchor site inside the overlap is the failure this rule exists for");

  const truncated = clone();
  truncated.utterances.find(u => u.editable).words.pop();
  assert.ok(codesOf(truncated).includes("V10:UTTERANCE_SPLIT"));

  const overcount = clone();
  overcount.editableWordCount += 1;
  assert.ok(codesOf(overcount).includes("V8:EDITABLE_COUNT_MISSTATED"));

  const overCeiling = clone();
  assert.ok(validateChunk(overCeiling, { canonical: parts.canonical, limits: { maxEditableWords: 5, maxSerializedBytes: 200 } })
    .violations.map(v => v.code).includes("SERIALIZED_OVER_CEILING"));

  const unanchored = clone();
  delete unanchored.reviewStateHash;
  assert.ok(codesOf(unanchored).includes("V1:CHUNK_CARRIES_NO_REVIEW_STATE"));
});

test("a word editable in two chunks is caught, and only the set can catch it",()=>{
  const parts = fixture({ utterances: 40 });
  const { chunks } = build(parts);
  const options = { canonical: parts.canonical, limits: CHUNK_LIMITS };
  const doubled = JSON.parse(JSON.stringify(chunks));
  const context = doubled[1].utterances.find(u => !u.editable);
  context.editable = true;
  for (const word of context.words) word.editable = true;

  assert.equal(validateChunk(doubled[1], options).violations.some(v => v.code === "WORD_EDITABLE_IN_MORE_THAN_ONE_CHUNK"), false,
    "one chunk in isolation cannot see the conflict");
  const set = validateChunkSet(doubled, options);
  assert.equal(set.ok, false);
  assert.ok(set.violations.some(v => v.rule === "V7" && v.code === "WORD_EDITABLE_IN_MORE_THAN_ONE_CHUNK"));
});

test("a word left out of every chunk is caught",()=>{
  // Silent partial coverage: the pass reports success having never looked at part of the record.
  const parts = fixture({ utterances: 40 });
  const { chunks } = build(parts);
  const short = JSON.parse(JSON.stringify(chunks));
  short.pop();
  const set = validateChunkSet(short, { canonical: parts.canonical, limits: CHUNK_LIMITS });
  assert.equal(set.ok, false);
  assert.ok(set.violations.some(v => v.code === "WORD_HAS_NO_OWNER"));
});

// -------------------------------------------------------------------------------------------
// The inbound gate: hand-authored responses, deliberately good and deliberately bad
// -------------------------------------------------------------------------------------------

const ROSTER = new Set(["attorney-1", "witness", "reporter"]);

function chunkForResponses() {
  const parts = fixture({ utterances: 40 });
  const { chunks } = build(parts);
  const chunk = chunks[1];
  return { parts, chunk, editable: editableOf(chunk), context: chunk.utterances.filter(u => !u.editable).flatMap(u => u.words) };
}

const good = (wordId, overrides = {}) => ({
  wordId, correctionType: "spelling", proposedValue: "Elizondo", confidenceScore: 0.92, evidenceSource: "keyterm", ...overrides,
});

const respond = (chunk, proposals) => ({ chunkId: chunk.chunkId, passId: chunk.passId, reviewStateHash: chunk.reviewStateHash, proposals });

test("well-formed proposals against the right chunk are accepted",()=>{
  const { chunk, editable } = chunkForResponses();
  const response = respond(chunk, [
    good(editable[0].id),
    good(editable[5].id, { correctionType: "punctuation", proposedValue: "wg,", confidenceScore: 0.71, evidenceSource: "transcript" }),
    good(editable[9].id, { correctionType: "word_replacement", proposedValue: "cervical", endWordId: editable[10].id, confidenceScore: 0.55, evidenceSource: "case_material" }),
    good(editable[20].id, { correctionType: "speaker_assignment", proposedValue: "witness", speakerIdentity: "witness", confidenceScore: 0.8, evidenceSource: "case_context" }),
  ]);
  const result = validateProposals(response, { chunk, roster: ROSTER });
  assert.equal(result.rejected, null);
  assert.deepEqual(result.declined, []);
  assert.equal(result.accepted.length, 4);
});

test("a response about a different chunk is rejected whole",()=>{
  // Not partially applied. A response addressed elsewhere cannot be half-believed.
  const { chunk, editable } = chunkForResponses();
  const result = validateProposals({ ...respond(chunk, [good(editable[0].id)]), chunkId: "0000000000000000" }, { chunk, roster: ROSTER });
  assert.equal(result.ok, false);
  assert.equal(result.rejected.code, "CHUNK_ID_MISMATCH");
  assert.equal(result.rejected.expected, chunk.chunkId);
  assert.equal(result.accepted.length, 0, "nothing survives a whole-response rejection");
});

test("a response generated against a transcript that has since changed is refused, never rebased",()=>{
  const { chunk, editable } = chunkForResponses();
  const response = respond(chunk, [good(editable[0].id)]);
  const result = validateProposals(response, { chunk, reviewStateHash: "the-reporter-has-since-edited", roster: ROSTER });
  assert.equal(result.ok, false);
  assert.equal(result.rejected.code, "STALE_CORRECTION_PROPOSAL");
  assert.equal(result.accepted.length, 0);
});

test("an anchor in the read-only overlap is declined",()=>{
  // The reason overlap exists at all: it is context, and a correction to it belongs to the chunk
  // that owns the word.
  const { chunk, context } = chunkForResponses();
  const result = validateProposals(respond(chunk, [good(context[0].id)]), { chunk, roster: ROSTER });
  assert.equal(result.ok, true);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.declined[0].rule, "R3");
  assert.equal(result.declined[0].code, "ANCHOR_NOT_EDITABLE");
});

test("an anchor that is not a word id in this chunk is declined",()=>{
  const { chunk, editable } = chunkForResponses();
  const result = validateProposals(respond(chunk, [
    good(`${JOB}:word:999999`),
    good(undefined),
    { ...good(editable[0].id), segmentId: SEGMENT(3) },
  ]), { chunk, roster: ROSTER });
  assert.equal(result.accepted.length, 0);
  assert.deepEqual(result.declined.map(item => item.code), ["WORD_ID_NOT_IN_CHUNK", "WORD_ID_NOT_IN_CHUNK", "SEGMENT_ANCHOR_NOT_PERMITTED"]);
});

test("a segment id is declined as a segment anchor, not as a stray field",()=>{
  // A segment id addresses a boundary the reporter can move; a word id addresses evidence. The
  // unstructured-field rule would also refuse this, which is why the reason is asserted and not
  // just the refusal: declining it as a stray key would hide what was actually attempted.
  const { chunk } = chunkForResponses();
  const result = validateProposals(respond(chunk, [{ segmentId: SEGMENT(3), correctionType: "structure", proposedValue: "NEW_PARAGRAPH", confidenceScore: 0.9, evidenceSource: "transcript" }]), { chunk, roster: ROSTER });
  assert.equal(result.accepted.length, 0);
  assert.deepEqual(result.declined.map(item => `${item.rule}:${item.code}`), ["R2:SEGMENT_ANCHOR_NOT_PERMITTED"]);
  assert.equal(result.declined[0].segmentId, SEGMENT(3));
});

test("each structural rule declines its own malformation, and the good proposal survives",()=>{
  const { chunk, editable, context } = chunkForResponses();
  const response = respond(chunk, [
    good(editable[0].id),
    good(editable[1].id, { correctionType: "rewrite_sentence" }),
    good(editable[2].id, { confidenceScore: 1.4 }),
    good(editable[3].id, { confidenceScore: "high" }),
    good(editable[4].id, { evidenceSource: "general_knowledge" }),
    good(editable[6].id, { proposedValue: "   " }),
    good(editable[7].id, { reasoning: "this seems like a name" }),
    good(editable[8].id, { endWordId: `${JOB}:word:999999` }),
    good(editable[12].id, { endWordId: editable[11].id }),
    good(editable[13].id, { endWordId: context[0]?.id ?? `${JOB}:word:999998` }),
  ]);
  const result = validateProposals(response, { chunk, roster: ROSTER });
  assert.deepEqual(result.accepted, [good(editable[0].id)], "one good proposal is not discarded by its malformed neighbours");
  assert.deepEqual(result.declined.map(item => `${item.rule}:${item.code}`), [
    "R6:CORRECTION_TYPE_NOT_PERMITTED",
    "R7:CONFIDENCE_OUT_OF_RANGE",
    "R7:CONFIDENCE_OUT_OF_RANGE",
    "R8:EVIDENCE_SOURCE_NOT_PERMITTED",
    "R9:PROPOSED_VALUE_EMPTY",
    "R10:UNSTRUCTURED_FIELD",
    "R4:END_WORD_ID_NOT_IN_CHUNK",
    "R4:END_WORD_PRECEDES_ANCHOR",
    "R4:END_WORD_NOT_EDITABLE",
  ]);
});

test("two proposals claiming the same words are both declined",()=>{
  // Neither is preferred. There is no ground for trusting whichever happened to serialize first.
  const { chunk, editable } = chunkForResponses();
  const first = good(editable[2].id, { endWordId: editable[5].id, correctionType: "word_replacement" });
  const second = good(editable[4].id, { correctionType: "capitalization", proposedValue: "Doctor" });
  const untouched = good(editable[30].id);
  const result = validateProposals(respond(chunk, [first, second, untouched]), { chunk, roster: ROSTER });
  assert.deepEqual(result.accepted, [untouched]);
  assert.equal(result.declined.length, 2);
  assert.ok(result.declined.every(item => item.rule === "R5"));
});

test("a speaker named who is not in this case is declined, and reported verbatim",()=>{
  // The finding is that a person absent from the record was proposed. Paraphrasing it loses the
  // only detail worth having.
  const { chunk, editable } = chunkForResponses();
  const result = validateProposals(respond(chunk, [
    good(editable[0].id, { correctionType: "speaker_assignment", proposedValue: "Karen M. Alvarado", speakerIdentity: "attorney-karen-alvarado", confidenceScore: 0.88, evidenceSource: "case_context" }),
    good(editable[3].id, { correctionType: "speaker_assignment", proposedValue: "witness", confidenceScore: 0.9, evidenceSource: "transcript" }),
  ]), { chunk, roster: ROSTER });
  assert.equal(result.accepted.length, 0);
  assert.equal(result.declined[0].rule, "R11");
  assert.equal(result.declined[0].attemptedIdentity, "attorney-karen-alvarado");
  assert.equal(result.declined[1].code, "SPEAKER_ASSIGNMENT_WITHOUT_IDENTITY");
});

test("an empty response is valid and proposes nothing",()=>{
  // A pass that finds nothing must be able to say so without tripping a gate.
  const { chunk } = chunkForResponses();
  const result = validateProposals(respond(chunk, []), { chunk, roster: ROSTER });
  assert.deepEqual(result, { ok: true, rejected: null, accepted: [], declined: [] });
});

// -------------------------------------------------------------------------------------------
// Deliberately hostile responses: well-formed, plausible, and false
// -------------------------------------------------------------------------------------------
//
// Everything above this line tests whether a response is STRUCTURALLY sound -- right chunk, real
// anchor, permitted vocabulary. None of it can tell whether a proposal is TRUE. Measured against
// the structural gate alone, five of these seven passed: changing 1991 to 2001 is a valid
// word_replacement, inventing an objection is a valid structure change, and a fabricated name is a
// valid spelling correction. Being well-formed and being right are different properties.
//
// Two controls close the gap, and they are different in kind:
//
//   R12 is a rule about testimony and is always on. Digits are substance -- a year, an age, a
//   dosage, a dollar amount -- and no correction to a name or a mark of punctuation changes one.
//
//   R13 and R14 are rules about AUTHORISATION, not truth. They constrain what a given pass was
//   permitted to attempt and which values it could draw on. A pass configured without them gets
//   the structural gate and nothing more, which is exactly what these tests document.

const HOSTILE_ROSTER = new Set(["witness", "attorney-1"]);
const PASS_ONE = { allowedCorrectionTypes: ["spelling"], lexicon: ["Etminan", "Elizondo", "Vargas"] };

function hostileChunk() {
  const line = "In 1991 I began working at the clinic uh and I saw Doctor Atamanan there until 2001 when".split(" ");
  const parts = fixture({ sizes: [line.length, 12] });
  parts.transcript.segments[0].asrWordIds.forEach((id, index) => {
    const word = parts.evidence[0].words.find(item => item.id === id);
    word.word = line[index];
    word.punctuatedWord = line[index];
  });
  const { chunks } = build(parts, null, { targetEditableWords: line.length, maxEditableWords: line.length });
  return { chunk: chunks[0], at: n => WORD(n) };
}

const verdictOf = (chunk, proposal, options) => {
  const result = validateProposals(
    { chunkId: chunk.chunkId, passId: chunk.passId, reviewStateHash: chunk.reviewStateHash, proposals: [proposal] },
    { chunk, roster: HOSTILE_ROSTER, ...options },
  );
  if (result.rejected) return `REJECTED:${result.rejected.code}`;
  return result.accepted.length ? "ACCEPTED" : `${result.declined[0].rule}:${result.declined[0].code}`;
};

test("the structural gate alone cannot refuse a plausible lie",()=>{
  // Documented rather than lamented. This is what the addressing rules buy and what they do not,
  // and a reader who assumes the gate checks meaning would be wrong in a way that matters.
  const { chunk, at } = hostileChunk();
  assert.equal(verdictOf(chunk, { wordId: at(2), correctionType: "word_replacement", proposedValue: "2001", confidenceScore: 0.91, evidenceSource: "transcript" }, { allowedCorrectionTypes: null }), "R12:DIGITS_ALTERED");
  for (const [name, proposal] of [
    ["deleting a filler word the witness said", { wordId: at(9), correctionType: "structure", proposedValue: null, confidenceScore: 0.97, evidenceSource: "transcript" }],
    ["inventing a name absent from the record", { wordId: at(14), correctionType: "spelling", proposedValue: "Rodriguez", confidenceScore: 0.88, evidenceSource: "case_material" }],
    ["inventing an objection never made", { wordId: at(13), correctionType: "structure", proposedValue: "MR. NUNEZ: Objection, form.", confidenceScore: 0.65, evidenceSource: "transcript" }],
  ]) assert.equal(verdictOf(chunk, proposal), "ACCEPTED", `${name} is structurally valid and only an authorisation rule can refuse it`);
});

test("digits are not correctable, whatever the pass is permitted to do",()=>{
  // The one always-on semantic rule. 1991 to 2001 rewrites what a witness said while satisfying
  // every structural rule above it, so the guard cannot depend on how the pass was configured.
  const { chunk, at } = hostileChunk();
  const open = { allowedCorrectionTypes: ["spelling", "word_replacement", "structure", "punctuation"] };
  assert.equal(verdictOf(chunk, { wordId: at(2), correctionType: "word_replacement", proposedValue: "2001", confidenceScore: 0.91, evidenceSource: "transcript" }, open), "R12:DIGITS_ALTERED");
  assert.equal(verdictOf(chunk, { wordId: at(2), endWordId: at(17), correctionType: "word_replacement", proposedValue: "2001", confidenceScore: 0.7, evidenceSource: "case_context" }, open), "R12:DIGITS_ALTERED",
    "collapsing a span from 1991 to 2001 loses one of them, and that is the same failure");
  // A correction that leaves the digits alone is unaffected.
  assert.equal(verdictOf(chunk, { wordId: at(14), correctionType: "spelling", proposedValue: "Etminan", confidenceScore: 0.95, evidenceSource: "keyterm" }, open), "ACCEPTED");
});

test("a constrained entity pass refuses every hostile case and still does its job",()=>{
  // Pass 1 as it will actually be configured: spelling only, values drawn from an authority list.
  // The point is the last assertion -- a gate that refused everything would be no use.
  const { chunk, at } = hostileChunk();
  const refused = [
    [{ wordId: at(2), correctionType: "word_replacement", proposedValue: "2001", confidenceScore: 0.91, evidenceSource: "transcript" }, "R13:CORRECTION_TYPE_NOT_ENABLED_FOR_PASS"],
    [{ wordId: at(9), correctionType: "structure", proposedValue: null, confidenceScore: 0.97, evidenceSource: "transcript" }, "R13:CORRECTION_TYPE_NOT_ENABLED_FOR_PASS"],
    [{ wordId: at(13), correctionType: "structure", proposedValue: "MR. NUNEZ: Objection, form.", confidenceScore: 0.65, evidenceSource: "transcript" }, "R13:CORRECTION_TYPE_NOT_ENABLED_FOR_PASS"],
    [{ wordId: at(14), correctionType: "spelling", proposedValue: "Rodriguez", confidenceScore: 0.88, evidenceSource: "case_material" }, "R14:VALUE_NOT_IN_LEXICON"],
  ];
  for (const [proposal, expected] of refused) assert.equal(verdictOf(chunk, proposal, PASS_ONE), expected);

  assert.equal(verdictOf(chunk, { wordId: at(14), correctionType: "spelling", proposedValue: "Etminan", confidenceScore: 0.95, evidenceSource: "keyterm" }, PASS_ONE), "ACCEPTED",
    "and the correction the pass exists to make is still made");
});

test("an unauthorised name is reported as attempted, not swallowed",()=>{
  const { chunk, at } = hostileChunk();
  const result = validateProposals(
    { chunkId: chunk.chunkId, passId: chunk.passId, reviewStateHash: chunk.reviewStateHash,
      proposals: [{ wordId: at(14), correctionType: "spelling", proposedValue: "Rodriguez", confidenceScore: 0.88, evidenceSource: "case_material" }] },
    { chunk, roster: HOSTILE_ROSTER, ...PASS_ONE },
  );
  assert.equal(result.declined[0].proposedValue, "Rodriguez", "what was attempted is the finding");
});
