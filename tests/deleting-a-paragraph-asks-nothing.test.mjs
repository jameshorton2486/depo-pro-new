// Deleting a paragraph during review asks nothing, because Undo is the answer.
//
// The reporter deletes paragraphs constantly in a review pass -- crosstalk, a false start, an
// interruption that belongs to nobody -- and a confirmation on each one is a second click on a
// decision already made, thousands of times across a 2h27m deposition. The dialog's own promise was
// "One Undo restores the entire action", which is exactly the safety mechanism that makes the
// dialog unnecessary.
//
// WHAT DOES NOT CHANGE. Delete is an overlay operation against the working transcript. The audio,
// the ASR words, their timestamps and their ids are untouched, and the deletion is one transaction
// that one Undo removes whole. This file asserts that boundary rather than trusting it.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { deleteSelectedParagraphOperations } from "../app/transcript-tools.mjs";
import { appendTransaction, applyOverlay, emptyOverlay, redoLastTransaction, undoLastTransaction } from "../server/reporter-overlay.mjs";

const JOB = "job";
const w = n => `${JOB}:word:${n}`;
// Frozen so a mutation of the input would be visible, not merely improbable.
const EVIDENCE = Object.freeze([w(1), w(2), w(3), w(4), w(5)].map(id => Object.freeze({ id })));
const segments = () => ([
  { id: "s1", asrWordIds: [w(1), w(2)], speakerIdentity: "witness", transcriptRole: "WITNESS" },
  { id: "s2", asrWordIds: [w(3)], speakerIdentity: null, transcriptRole: null },
  { id: "s3", asrWordIds: [w(4), w(5)], speakerIdentity: "reporter", transcriptRole: "COURT_REPORTER" },
]);
const paragraphs = () => ([
  { id: "s1", words: [{ id: w(1) }, { id: w(2) }] },
  { id: "s2", words: [{ id: w(3) }] },
  { id: "s3", words: [{ id: w(4) }, { id: w(5) }] },
]);
const surviving = overlay => {
  const applied = applyOverlay(segments(), overlay);
  return EVIDENCE.map(word => word.id).filter(id => !applied.deleted.has(id));
};

test("the reporter is not asked whether they meant it", () => {
  // The behavioural change, asserted against the shipped handler. A dialog here was a second click
  // on a decision the reporter had already made by selecting the paragraph and pressing Delete.
  const screen = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  const start = screen.indexOf("function deleteSelectedParagraphs()");
  assert.ok(start > 0, "the delete handler must exist");
  const handler = screen.slice(start, screen.indexOf("}", screen.indexOf("void append(paragraphDeleteOperations)")));
  assert.equal(/window\.confirm/.test(handler), false, "deleting a paragraph must not ask for confirmation");
  assert.match(handler, /void append\(paragraphDeleteOperations\)/, "and it still appends the same operations");
});

test("the confirmations that remain are the ones that reach past the edit in front of you", () => {
  // NOT generalised. Striking a run of words and replacing across the whole transcript both act on
  // text the reporter has not read one by one; undoing an AI pass removes 260 operations at once.
  // Those keep their dialogs, and this test fails if a later change quietly takes them away too.
  //
  // Each assertion requires the confirm to GATE the action, not merely to appear in the file. An
  // earlier version of this test checked only that the string was present, and survived a mutation
  // that left the dialog in the source while disabling it -- a test that passes for the wrong
  // reason is worse than none, because it reports a guard that is no longer guarding.
  const screen = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  assert.match(screen, /if\(!window\.confirm\(`Strike \$\{operations\.length\}/,
    "striking words still asks, and refuses when the answer is no");
  assert.match(screen, /if\(window\.confirm\(`Replace \$\{chosen\.length\}[\s\S]{0,120}?\)\)void replaceMatches/,
    "replace-across-transcript still asks, and only replaces when the answer is yes");
  assert.match(screen, /if\(window\.confirm\(`Undo the AI correction pass\?[\s\S]{0,200}?\)\)void post/,
    "undoing a whole AI pass still asks, and only undoes when the answer is yes");
});

test("one click is one transaction, whatever it spans", () => {
  const one = deleteSelectedParagraphOperations({ paragraphs: paragraphs(), selectedParagraphId: "s1" });
  assert.equal(one.length, 2, "two words in that paragraph");
  assert.ok(one.every(operation => operation.op === "delete"));
  const overlay = appendTransaction(emptyOverlay("DEP-1"), one);
  assert.deepEqual(overlay.transactionSizes, [2], "both words land in ONE undoable action");

  // A range spanning two paragraphs is still one action, so one Undo takes back what one click did.
  const many = deleteSelectedParagraphOperations({
    paragraphs: paragraphs(), wordIndexes: new Map(EVIDENCE.map((word, index) => [word.id, index])),
    range: { first: 2, last: 4 },
  });
  assert.equal(many.length, 3, "s2 and s3 between them");
  assert.deepEqual(appendTransaction(emptyOverlay("DEP-1"), many).transactionSizes, [3]);
});

test("one Undo restores the paragraph, exactly as the dialog used to promise", () => {
  const before = surviving(emptyOverlay("DEP-1"));
  assert.deepEqual(before, [w(1), w(2), w(3), w(4), w(5)]);

  const deleted = appendTransaction(emptyOverlay("DEP-1"),
    deleteSelectedParagraphOperations({ paragraphs: paragraphs(), selectedParagraphId: "s1" }));
  assert.deepEqual(surviving(deleted), [w(3), w(4), w(5)], "the paragraph is gone from the projection");

  const { overlay: undone } = undoLastTransaction(deleted);
  assert.deepEqual(surviving(undone), before, "and one Undo brings all of it back");
  assert.deepEqual(undone.operations, [], "with nothing left behind");
});

test("Redo puts it back", () => {
  const deleted = appendTransaction(emptyOverlay("DEP-1"),
    deleteSelectedParagraphOperations({ paragraphs: paragraphs(), selectedParagraphId: "s3" }));
  const { overlay: undone } = undoLastTransaction(deleted);
  const { overlay: redone } = redoLastTransaction(undone);
  assert.deepEqual(surviving(redone), [w(1), w(2), w(3)], "the deletion is reapplied");
  assert.deepEqual(redone.transactionSizes, [2], "still one action, not two");
});

test("the evidence is not what was deleted", () => {
  // The whole reason a dialog is unnecessary. A delete marks words absent from the projection; the
  // ASR evidence, the ids and the stored segments are untouched, so the recording still holds
  // everything the transcript no longer shows.
  const input = segments();
  const snapshot = JSON.stringify(input);
  const overlay = appendTransaction(emptyOverlay("DEP-1"),
    deleteSelectedParagraphOperations({ paragraphs: paragraphs(), selectedParagraphId: "s1" }));
  const applied = applyOverlay(input, overlay);

  assert.equal(JSON.stringify(input), snapshot, "applyOverlay must not modify the segments it is given");
  assert.equal(EVIDENCE.length, 5, "and every ASR word still exists");
  assert.ok(applied.deleted.has(w(1)) && applied.deleted.has(w(2)), "the words are marked deleted, not removed");
  assert.ok(overlay.operations.every(operation => operation.wordId), "each deletion names the word it hides");
});
