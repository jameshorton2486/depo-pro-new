// The reporter's own punctuation: a dash and an ellipsis, placed where they are pointing.
//
// WHY BOTH, AND WHY THESE FORMS. Measured against the certified Heath Thomas transcript: 327 em
// dashes, and an ellipsis of any form zero times. The dash is what that record uses for a
// self-correction or a speaker trailing off, and the application had no control for it at all --
// its one punctuation button inserted the mark the transcript never contains.
//
// WHAT WAS WRONG WITH THE OLD CONTROL. It required an open paragraph editor and a text caret, while
// sitting in a panel that asks the reporter to select a word. Selecting a word -- which is what the
// panel says, and what leaves a hand free for the pedal -- left it grey. And when it did fire, a
// caret resting inside a word wrote the characters INTO that word: "know" became "kn...ow",
// punctuation written into text the microphone produced.
//
// What is defended here:
//
//   a mark is an authored token placed BESIDE a word, never text written into one
//   the ASR word, its id and its timestamps are untouched
//   a word selection is enough -- no paragraph editor, no caret, no dialog
//   an impossible placement refuses in a sentence the reporter can act on
//   undo and redo take the whole mark back
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { insertAtCaret } from "../app/caret-insertion.mjs";
import { TRANSCRIPT_MARKS, markInsertion } from "../app/transcript-marks.mjs";
import { appendTransaction, applyOverlay, emptyOverlay, redoLastTransaction, undoLastTransaction } from "../server/reporter-overlay.mjs";

const PARAGRAPH = { id: "p1", text: "we were before the break",
  words: [ { id: "w1", text: "we", start: 1.0, end: 1.1 }, { id: "w2", text: "were", start: 1.1, end: 1.4 },
           { id: "w3", text: "before", start: 1.4, end: 1.7 }, { id: "w4", text: "the", start: 1.7, end: 1.8 },
           { id: "w5", text: "break", start: 1.8, end: 2.1 } ] };
const SEGMENTS = () => [{ id: "seg-1", asrWordIds: PARAGRAPH.words.map(word => word.id) }];

// --- the marks themselves --------------------------------------------------------------------------

test("the dash is the character the certified transcript actually contains", () => {
  // U+2014, not two hyphens. The certified Heath Thomas transcript holds 327 of the first and none
  // of the second, so a control inserting "--" would be introducing a form that record never uses.
  assert.equal(TRANSCRIPT_MARKS.dash.text, "—");
  assert.equal(TRANSCRIPT_MARKS.dash.text.length, 1);
  assert.equal(TRANSCRIPT_MARKS.ellipsis.text, "...");
});

// --- a valid manual mark ---------------------------------------------------------------------------

test("a selected word is enough: the mark is placed after it", () => {
  const verdict = markInsertion({ paragraph: PARAGRAPH, selectedWordId: "w2", markId: "dash" });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.operations, [{ op: "insert", afterWordId: "w2", text: "—" }]);
});

test("the ellipsis uses the same placement, and only the character differs", () => {
  const verdict = markInsertion({ paragraph: PARAGRAPH, selectedWordId: "w2", markId: "ellipsis" });
  assert.deepEqual(verdict.operations, [{ op: "insert", afterWordId: "w2", text: "..." }]);
});

test("the mark is an authored token beside the word, and writes nothing into it", () => {
  // THE DEFECT THIS REPLACES. The old control inserted into the paragraph draft, so a caret inside
  // a word produced "kn...ow" -- punctuation written into text the microphone produced.
  const { operations } = markInsertion({ paragraph: PARAGRAPH, selectedWordId: "w2", markId: "dash" });
  const projection = applyOverlay(SEGMENTS(), appendTransaction(emptyOverlay("D"), operations));
  assert.equal(projection.replaced.size, 0, "no evidentiary word's text was rewritten");
  assert.equal(projection.deleted.size, 0, "and none was struck");
  assert.deepEqual([...projection.inserted.keys()], ["w2"], "the mark hangs off w2 as authored text");
  assert.deepEqual(projection.segments[0].asrWordIds, ["w1", "w2", "w3", "w4", "w5"],
    "every ASR word id survives, in order");
});

test("ASR words and their timestamps are preserved exactly", () => {
  const { operations } = markInsertion({ paragraph: PARAGRAPH, selectedWordId: "w2", markId: "dash" });
  const projection = applyOverlay(SEGMENTS(), appendTransaction(emptyOverlay("D"), operations));
  for (const word of PARAGRAPH.words) {
    assert.equal(projection.replaced.has(word.id), false, `${word.id} text untouched`);
    assert.equal(projection.deleted.has(word.id), false, `${word.id} still prints`);
  }
  // The inserted token carries no ASR anchor of its own, which is what makes it distinguishable
  // from something the recording produced.
  const [authored] = projection.inserted.get("w2");
  assert.equal(authored.text, "—");
  assert.equal(authored.start ?? null, null);
});

// --- undo and redo ---------------------------------------------------------------------------------

test("undo takes the whole mark back, and redo puts it again", () => {
  const { operations } = markInsertion({ paragraph: PARAGRAPH, selectedWordId: "w2", markId: "dash" });
  const applied = appendTransaction(emptyOverlay("D"), operations);
  assert.equal(applied.transactionSizes.length, 1, "one mark, one transaction");

  const undone = undoLastTransaction(applied);
  assert.deepEqual(undone.overlay.operations, []);
  assert.equal(applyOverlay(SEGMENTS(), undone.overlay).inserted.size, 0, "the mark is gone from the reading");

  const redone = redoLastTransaction(undone.overlay);
  // Against the applied overlay, not against the plan: the overlay normalises an operation on the
  // way in, so redo restores what was stored rather than what was proposed.
  assert.deepEqual(redone.overlay.operations, applied.operations);
  assert.deepEqual([...applyOverlay(SEGMENTS(), redone.overlay).inserted.keys()], ["w2"]);
});

// --- refusing safely -------------------------------------------------------------------------------

test("an impossible placement refuses in a sentence, not an operation code", () => {
  const cases = [
    markInsertion({ paragraph: PARAGRAPH, selectedWordId: null, markId: "dash" }),
    markInsertion({ paragraph: PARAGRAPH, selectedWordId: "w-nowhere", markId: "dash" }),
    markInsertion({ paragraph: null, selectedWordId: "w2", markId: "dash" }),
    markInsertion({ paragraph: PARAGRAPH, selectedWordId: "w2", markId: "asterisk" }),
  ];
  for (const verdict of cases) {
    assert.equal(verdict.ok, false);
    assert.match(verdict.message, /^[A-Z].*\.$/, "a sentence");
    assert.equal(/[A-Z_]{6,}|op:|wordId/.test(verdict.message), false,
      `reporter-facing language, not internals: ${verdict.message}`);
  }
});

test("a struck word cannot carry a mark, because nothing follows a word that does not print", () => {
  const struck = { ...PARAGRAPH, words: PARAGRAPH.words.map(word => word.id === "w2" ? { ...word, deleted: true } : word) };
  const verdict = markInsertion({ paragraph: struck, selectedWordId: "w2", markId: "dash" });
  assert.equal(verdict.ok, false);
  assert.match(verdict.message, /struck/);
  // Deliberately not anchored to the next surviving word: that would put the mark somewhere the
  // reporter did not point at.
  assert.equal(verdict.operations, undefined);
});

// --- the caret path, which still exists while a paragraph is open ------------------------------------

test("with a paragraph open the caret is still the position the reporter means", () => {
  assert.deepEqual(insertAtCaret("Are you do you", 8, "..."), { draft: "Are you ...do you", caret: 11 });
  assert.deepEqual(insertAtCaret("Answer", 0, "—"), { draft: "—Answer", caret: 1 });
});

// --- what the screen offers ---------------------------------------------------------------------------

test("both marks are offered, and neither needs a paragraph editor open", () => {
  const screen = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  const pages = fs.readFileSync(new URL("../app/WorkspaceDocumentPages.tsx", import.meta.url), "utf8");
  assert.match(screen, /TRANSCRIPT_MARKS\.dash,TRANSCRIPT_MARKS\.ellipsis/, "two controls, not one");
  // The gate the reporter hit: the old control required a caret and went grey on a word selection.
  assert.match(screen, /disabled=\{\(!canInsertAtCaret&&!selected\)/,
    "a word selection alone must enable the control");
  assert.match(screen, /onMouseDown=\{event=>event\.preventDefault\(\)\}/, "and it must not steal editor focus");
  assert.match(pages, /insertTextAtCaret\(current\.draft,current\.caret,text\)/);
});

test("no confirmation stands between the reporter and a punctuation mark", () => {
  const screen = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  const handler = screen.slice(screen.indexOf("const insertMark="), screen.indexOf("const joinParagraph="));
  assert.equal(/confirm\(|window\.confirm|setPendingConfirm/.test(handler), false,
    "undo is the safety mechanism, not a dialog");
});
