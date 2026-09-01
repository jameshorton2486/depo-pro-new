// One reporter determination, one operation.
//
// Deepgram's diarization ran two speaker turns together across most of the Etminan deposition:
// 306 paragraphs where the certified transcript has 530 turns, so roughly 224 boundaries are missing
// and 156 answers have no A. designation. Recovering one boundary took TWO operations -- a split,
// then a label -- because the tail half inherits the head's speaker. At two operations a boundary
// that is roughly 450 structural corrections for one deposition.
//
// The second operation was also the dangerous one. A split names its tail `${segment.id}#${wordId}`,
// so a caller labelling the tail has to reconstruct that id; get it wrong and the label lands on the
// head instead, moving a speaker attribution to the wrong half of a certified page while the save
// reports success. splitSegments carries a comment about precisely that class of bug.
//
// So: split takes the speaker. Not a button that fires two operations -- one operation, which makes
// it one undo, one audit entry, and one thing the reporter decided.
//
// WHAT IT STILL DOES NOT DO. It infers nothing. The reporter says where the boundary is and who
// speaks after it; Q. and A. are derived downstream from the speaker and the examination structure,
// never from punctuation. Omit the speaker and the operation behaves exactly as it always did.
import assert from "node:assert/strict";
import test from "node:test";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/etminan-evidence.mjs";
import {
  appendTransaction, applyOverlay, emptyOverlay, redoLastTransaction, undoLastTransaction, validateOperation,
} from "../server/reporter-overlay.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";

const overlayOf = (...operations) => ({ ...emptyOverlay("DEP-TEST"), operations });
const render = overlay => renderTranscript({ working:WORKING, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley", overlay });
const segments = () => WORKING.segments.map(segment => ({ ...segment, asrWordIds:[...segment.asrWordIds] }));

// The witness's answer, long enough to split inside. In the real deposition this is the shape that
// matters: an examiner paragraph that ran on into the answer.
const ANSWER = WORKING.segments[3];
const MIDWORD = ANSWER.asrWordIds[3];
const tailId = `${ANSWER.id}#${MIDWORD}`;
const find = (result, id) => result.segments.find(segment => segment.id === id);

// --- the operation ------------------------------------------------------------------------------

test("split accepts a speaker, and still accepts none", () => {
  const withSpeaker = validateOperation({ op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD, speakerIdentity:"counsel-bentley", transcriptRole:"QUESTIONING_ATTORNEY" });
  assert.equal(withSpeaker.ok, true, withSpeaker.message);
  assert.deepEqual(withSpeaker.operation, {
    op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD,
    speakerIdentity:"counsel-bentley", transcriptRole:"QUESTIONING_ATTORNEY",
  });

  const without = validateOperation({ op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD });
  assert.equal(without.ok, true);
  assert.equal(without.operation.speakerIdentity, null, "an unstated speaker is unstated, not empty");
  assert.equal(without.operation.transcriptRole, null);
});

test("a split with no speaker behaves exactly as it always did", () => {
  const before = applyOverlay(segments(), overlayOf({ op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD }));
  const tail = find(before, tailId);
  assert.equal(tail.speakerIdentity, ANSWER.speakerIdentity, "the tail inherits");
  assert.equal(tail.transcriptRole, ANSWER.transcriptRole);
});

// --- the transitions ------------------------------------------------------------------------------

// Every direction a real deposition turns. The point of enumerating them is that the operation
// carries whatever the reporter chose and asserts nothing of its own about who may follow whom.
const TRANSITIONS = [
  ["examiner to witness",    "witness",          "WITNESS"],
  ["witness to examiner",    "counsel-bentley",  "QUESTIONING_ATTORNEY"],
  ["attorney to attorney",   "counsel-ramon",    "DEFENDING_ATTORNEY"],
  ["reporter to attorney",   "counsel-bentley",  "QUESTIONING_ATTORNEY"],
  ["videographer to reporter", "reporter",       "COURT_REPORTER"],
];

for (const [name, speakerIdentity, transcriptRole] of TRANSITIONS) {
  test(`the reporter can say the next paragraph is the ${name.split(" to ")[1]} (${name})`, () => {
    const result = applyOverlay(segments(), overlayOf({ op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD, speakerIdentity, transcriptRole }));
    const head = find(result, ANSWER.id), tail = find(result, tailId);
    assert.equal(tail.speakerIdentity, speakerIdentity, "the tail is who the reporter said");
    assert.equal(tail.transcriptRole, transcriptRole);
    assert.equal(head.speakerIdentity, ANSWER.speakerIdentity, "and the head is untouched");
    assert.equal(head.transcriptRole, ANSWER.transcriptRole);
    assert.deepEqual(result.orphaned, []);
  });
}

// --- what must survive ------------------------------------------------------------------------------

test("the evidence is not rewritten -- words, ids, and the original diarization all survive", () => {
  const workingBefore = JSON.stringify(WORKING), evidenceBefore = JSON.stringify(EVIDENCE);
  const result = applyOverlay(segments(), overlayOf({ op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD, speakerIdentity:"counsel-bentley", transcriptRole:"QUESTIONING_ATTORNEY" }));
  assert.equal(JSON.stringify(WORKING), workingBefore, "working.json must be untouched");
  assert.equal(JSON.stringify(EVIDENCE), evidenceBefore, "asr-evidence.json must be untouched");

  const head = find(result, ANSWER.id), tail = find(result, tailId);
  assert.deepEqual([...head.asrWordIds, ...tail.asrWordIds], ANSWER.asrWordIds, "every word id, in order, once");
  // The evidence's own account of who spoke stays on both halves. The reporter's determination is an
  // overlay fact beside it, never a replacement for it -- otherwise the record loses the ability to
  // show that a human disagreed with the machine.
  assert.equal(tail.deepgramSpeaker, ANSWER.deepgramSpeaker, "the tail keeps the diarization speaker it came from");
  assert.equal(head.deepgramSpeaker, ANSWER.deepgramSpeaker);
  assert.equal(tail.sourceJobIdentity, ANSWER.sourceJobIdentity, "provenance survives");
  assert.equal(tail.sourceUploadId, ANSWER.sourceUploadId);
  assert.equal(head.start, ANSWER.start, "the head keeps its timing");
  assert.equal(tail.start, null, "and the tail's timing is unstated rather than invented");
  assert.equal(tail.end, null);
});

test("no word is added, lost or duplicated", () => {
  const ids = EVIDENCE.words.map(word => word.id).sort();
  const rendered = render(overlayOf({ op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD, speakerIdentity:"counsel-bentley", transcriptRole:"QUESTIONING_ATTORNEY" }))
    .paragraphs.flatMap(paragraph => paragraph.words.filter(word => !word.authored).map(word => word.id)).sort();
  assert.deepEqual(rendered, ids);
});

// --- refusals ------------------------------------------------------------------------------

test("splitting at the start of a paragraph is still refused, speaker or no speaker", () => {
  const result = applyOverlay(segments(), overlayOf({ op:"split", segmentId:ANSWER.id, beforeWordId:ANSWER.asrWordIds[0], speakerIdentity:"witness", transcriptRole:"WITNESS" }));
  assert.equal(result.orphaned.length, 1);
  assert.equal(result.orphaned[0].reason, "SPLIT_AT_SEGMENT_START");
  // And the speaker does not leak onto the unsplit paragraph. A refused split must change nothing;
  // an operation that half-applied would put a reporter's determination on a boundary that does not
  // exist.
  assert.equal(find(result, ANSWER.id).speakerIdentity, ANSWER.speakerIdentity);
});

test("a word that is not there orphans, and says which word", () => {
  const result = applyOverlay(segments(), overlayOf({ op:"split", segmentId:ANSWER.id, beforeWordId:"job:word:999999", speakerIdentity:"witness", transcriptRole:"WITNESS" }));
  assert.equal(result.orphaned.length, 1);
  assert.equal(result.orphaned[0].reason, "WORD_NOT_IN_SEGMENT");
});

test("splitting the same paragraph twice gives two distinct tails, each with its own speaker", () => {
  // The repeated-split case the derived id exists to make safe. Two boundaries inside one merged
  // paragraph is the common shape: examiner, witness, examiner again.
  const second = ANSWER.asrWordIds[5];
  const result = applyOverlay(segments(), overlayOf(
    { op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD, speakerIdentity:"witness", transcriptRole:"WITNESS" },
    { op:"split", beforeWordId:second, speakerIdentity:"counsel-bentley", transcriptRole:"QUESTIONING_ATTORNEY" },
  ));
  assert.deepEqual(result.orphaned, []);
  const ids = result.segments.map(segment => segment.id);
  assert.equal(new Set(ids).size, ids.length, "no two segments may share an id");
  assert.equal(find(result, tailId).speakerIdentity, "witness");
  assert.equal(find(result, `${tailId}#${second}`).speakerIdentity, "counsel-bentley");
});

// --- one transaction, one undo ------------------------------------------------------------------------------

test("one undo restores the paragraph completely -- boundary and speaker together", () => {
  const before = applyOverlay(segments(), emptyOverlay("DEP-TEST"));
  const overlay = appendTransaction(emptyOverlay("DEP-TEST"),
    { op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD, speakerIdentity:"counsel-bentley", transcriptRole:"QUESTIONING_ATTORNEY" });
  assert.deepEqual(overlay.transactionSizes, [1], "one reporter determination is one operation, not two");

  const split = applyOverlay(segments(), overlay);
  assert.equal(find(split, tailId).speakerIdentity, "counsel-bentley");

  const { overlay:undone } = undoLastTransaction(overlay);
  const after = applyOverlay(segments(), undone);
  assert.deepEqual(after.segments.map(s => s.id), before.segments.map(s => s.id), "the paragraph is whole again");
  assert.equal(find(after, ANSWER.id).speakerIdentity, ANSWER.speakerIdentity, "and the speaker is back to what it was");

  const { overlay:redone } = redoLastTransaction(undone);
  const again = applyOverlay(segments(), redone);
  assert.equal(find(again, tailId).speakerIdentity, "counsel-bentley", "redo restores both halves of the determination");
});

test("replaying the overlay rebuilds the same record", () => {
  // Reconstruction. The tail's id is derived from the word it begins at, so a reload produces the
  // same segments, and the speaker travels with the operation rather than with a positional guess.
  const overlay = overlayOf({ op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD, speakerIdentity:"witness", transcriptRole:"WITNESS" });
  const first = applyOverlay(segments(), overlay), second = applyOverlay(segments(), overlay);
  assert.deepEqual(JSON.stringify(first.segments), JSON.stringify(second.segments));
});

// --- what the page reads ------------------------------------------------------------------------------

test("Q. and A. follow from the speaker the reporter named, not from punctuation", () => {
  // The examiner is counsel-bentley. Splitting the witness's answer and handing the tail to the
  // examiner must make the tail read Q. -- derived from who is examining, exactly as it would had
  // the reporter used a separate label. Nothing here reads the text.
  const result = render(overlayOf({ op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD, speakerIdentity:"counsel-bentley", transcriptRole:"QUESTIONING_ATTORNEY" }));
  const paragraphs = result.paragraphs.filter(paragraph => paragraph.words.some(word => ANSWER.asrWordIds.includes(word.id)));
  assert.equal(paragraphs.length, 2, "the answer became two paragraphs");
  assert.equal(paragraphs[0].label, "A.", "the head is still the witness answering");
  assert.equal(paragraphs[1].label, "Q.", "and the tail reads as the examiner's question");
});
