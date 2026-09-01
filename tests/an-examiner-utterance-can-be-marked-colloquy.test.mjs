// §247-A. The reporter can say that an utterance by the active examiner is not a question.
//
// `labelParagraphs` emits Q. for anything the active examiner says, so "I will rephrase." prints as
// testimony. Whether an utterance is a question is a third fact, separate from who spoke and from
// who is examining, and nothing recorded it.
//
// This checkpoint adds the operation and its clear, and nothing else. Nothing consumes them yet:
// labelling is §247-B and the Workspace control is §247-C. A test asserts that inertness, so a Q.
// that moves in this checkpoint fails rather than passing unnoticed -- the discipline Phase B used.
import assert from "node:assert/strict";
import test from "node:test";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/etminan-evidence.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";
import {
  appendTransaction, applyOverlay, emptyOverlay, redoLastTransaction, undoLastTransaction, validateOperation,
} from "../server/reporter-overlay.mjs";

const overlayOf = (...operations) => ({ ...emptyOverlay("DEP-TEST"), operations });
const apply = overlay => applyOverlay(WORKING.segments, overlay);
const render = overlay => renderTranscript({ working:WORKING, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley", overlay });
// A word inside the examiner's own paragraph.
const EXAMINER_WORD = WORKING.segments[2].asrWordIds[0];
const OTHER_WORD = WORKING.segments[6].asrWordIds[0];
const mark = wordId => ({ op:"colloquy", wordId });
const clear = wordId => ({ op:"uncolloquy", wordId });

// --- validation -----------------------------------------------------------------------------------

test("both operations need the word they are about", () => {
  assert.equal(validateOperation({ op:"colloquy" }).ok, false);
  assert.match(validateOperation({ op:"colloquy" }).message, /requires wordId/);
  assert.equal(validateOperation({ op:"uncolloquy" }).ok, false);
  assert.match(validateOperation({ op:"uncolloquy" }).message, /requires wordId/);
  assert.equal(validateOperation(mark("   ")).ok, false, "whitespace is not a word id");
});

test("neither carries anything but the anchor", () => {
  // No speaker, no role, no examiner, no element type. The operation says one thing about one
  // utterance; who spoke and who is examining are recorded elsewhere and must stay there.
  assert.deepEqual(Object.keys(validateOperation(mark("job1:word:9")).operation).sort(), ["op", "wordId"]);
  assert.deepEqual(Object.keys(validateOperation(clear("job1:word:9")).operation).sort(), ["op", "wordId"]);
  const noisy = validateOperation({ op:"colloquy", wordId:"job1:word:9", speakerIdentity:"counsel-ramon", elementType:"COLLOQUY" });
  assert.deepEqual(Object.keys(noisy.operation).sort(), ["op", "wordId"], "extra fields are dropped, not stored");
});

// --- application ----------------------------------------------------------------------------------

test("a mark records the utterance it was placed on", () => {
  const applied = apply(overlayOf(mark(EXAMINER_WORD)));
  assert.deepEqual([...applied.colloquy], [EXAMINER_WORD]);
  assert.deepEqual(applied.orphaned, []);
});

test("marking the same utterance twice says the same thing twice", () => {
  // Idempotent, where a second examination boundary on one word is refused. That one carries a
  // person and a type that could differ, so replacing it would discard a recorded fact; this one
  // carries nothing but the anchor, so a repeat discards nothing.
  const applied = apply(overlayOf(mark(EXAMINER_WORD), mark(EXAMINER_WORD)));
  assert.deepEqual([...applied.colloquy], [EXAMINER_WORD]);
  assert.deepEqual(applied.orphaned, [], "a repeat is not an error");
});

test("a mark whose word is gone orphans rather than vanishing", () => {
  const applied = apply(overlayOf(mark("job-that-does-not-exist:word:9999")));
  assert.equal(applied.colloquy.size, 0);
  assert.equal(applied.orphaned.length, 1);
  assert.equal(applied.orphaned[0].reason, "WORD_NOT_FOUND");
  assert.equal(applied.orphaned[0].operation.op, "colloquy");
});

// --- clearing -------------------------------------------------------------------------------------

test("clearing removes the mark", () => {
  const applied = apply(overlayOf(mark(EXAMINER_WORD), clear(EXAMINER_WORD)));
  assert.equal(applied.colloquy.size, 0);
  assert.deepEqual(applied.orphaned, []);
});

test("clearing asserts nothing about what the utterance is", () => {
  // The whole point of the pair. A clear removes the reporter's determination and lets the
  // examination model derive the paragraph again; it does not record "this is a question", which
  // would be a second determination wearing the clothes of an erasure.
  const cleared = validateOperation(clear(EXAMINER_WORD)).operation;
  assert.equal(cleared.op, "uncolloquy");
  assert.equal("elementType" in cleared, false);
  assert.deepEqual(apply(overlayOf(mark(EXAMINER_WORD), clear(EXAMINER_WORD))).colloquy, new Set(),
    "the transcript is left with no classification, not with the opposite one");
});

test("clearing a mark that was never there is reported", () => {
  // Reported rather than ignored, exactly as unflag is. A clear that silently did nothing leaves
  // the reporter believing a line reads as a question again when it still reads as colloquy.
  const applied = apply(overlayOf(clear(EXAMINER_WORD)));
  assert.equal(applied.orphaned.length, 1);
  assert.equal(applied.orphaned[0].reason, "COLLOQUY_NOT_FOUND");
});

test("clearing one mark leaves the others alone", () => {
  const applied = apply(overlayOf(mark(EXAMINER_WORD), mark(OTHER_WORD), clear(EXAMINER_WORD)));
  assert.deepEqual([...applied.colloquy], [OTHER_WORD]);
  assert.deepEqual(applied.orphaned, []);
});

// --- the machinery it inherits ---------------------------------------------------------------------

test("a mark undoes and redoes like any other reporter action", () => {
  const overlay = appendTransaction(emptyOverlay("DEP-TEST"), [mark(EXAMINER_WORD)]);
  assert.equal(apply(overlay).colloquy.size, 1);
  const undone = undoLastTransaction(overlay);
  assert.equal(apply(undone.overlay).colloquy.size, 0, "undo removes the mark");
  const redone = redoLastTransaction(undone.overlay);
  assert.deepEqual([...apply(redone.overlay).colloquy], [EXAMINER_WORD], "and redo restores it");
});

test("a mark survives being written out and read back", () => {
  const overlay = appendTransaction(emptyOverlay("DEP-TEST"), [mark(EXAMINER_WORD), mark(OTHER_WORD)]);
  const reloaded = JSON.parse(JSON.stringify(overlay));
  assert.deepEqual([...apply(reloaded).colloquy], [...apply(overlay).colloquy]);
});

// --- inert, by design -------------------------------------------------------------------------------

test("a mark changes nothing the reader reads yet", () => {
  // §247-A is the operation only. If this fails, the labeller has been changed and that is §247-B.
  const marked = render(overlayOf(mark(EXAMINER_WORD), mark(OTHER_WORD)));
  const plain = render(overlayOf());
  assert.deepEqual(marked.paragraphs, plain.paragraphs,
    "marking an utterance must not yet move a single Q. or A.");
});

test("a mark changes no word, no timing and no speaker", () => {
  const marked = render(overlayOf(mark(EXAMINER_WORD)));
  const plain = render(overlayOf());
  const words = result => result.paragraphs.flatMap(paragraph => paragraph.words)
    .map(word => ({ id:word.id, text:word.text, start:word.start, end:word.end }));
  assert.deepEqual(words(marked), words(plain));
  assert.deepEqual(marked.paragraphs.map(item => item.speakerIdentity), plain.paragraphs.map(item => item.speakerIdentity),
    "who spoke is recorded elsewhere and is not touched");
  assert.deepEqual(marked.paragraphs.map(item => item.transcriptRole), plain.paragraphs.map(item => item.transcriptRole));
});

test("a mark does not disturb the examination sequence", () => {
  // Three independent facts. Classifying an utterance says nothing about who is examining, and the
  // resolved sequence must be identical either way.
  const boundary = { op:"examination", atWordId:WORKING.segments[7].asrWordIds[0], examinerPersonId:"counsel-ramon", type:"CROSS" };
  const withMark = render(overlayOf(boundary, mark(EXAMINER_WORD)));
  const without = render(overlayOf(boundary));
  assert.deepEqual(withMark.examinations, without.examinations);
});

// --- positive control ---------------------------------------------------------------------------------

test("the harness detects a difference when one exists", () => {
  assert.notDeepEqual([...apply(overlayOf(mark(EXAMINER_WORD))).colloquy], [...apply(overlayOf(mark(OTHER_WORD))).colloquy]);
});
