// Phase B of the Examination Model. See §246 in the audit ledger.
//
// `labelParagraphs` holds one examiner for the whole transcript, so when defending counsel begins
// cross her questions render as colloquy and the witness's answers render as THE WITNESS: rather
// than A. -- 450 of 1,602 paragraphs on the qualification fixture. The cause is that the
// transcript has no notion of an examination having a beginning.
//
// This phase adds the boundary and nothing else. Nothing reads it yet: labelling is Phase C,
// headings and the index are Phase D, and the Workspace control is Phase E. What is under test
// here is that a boundary can be recorded, survives the overlay's existing machinery, and refuses
// the two shapes that would make it unreliable -- a second boundary on the same word, and a
// boundary that names nobody.
import assert from "node:assert/strict";
import test from "node:test";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/etminan-evidence.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";
import { appendTransaction, applyOverlay, emptyOverlay, EXAMINATION_TYPES, redoLastTransaction, undoLastTransaction, validateOperation } from "../server/reporter-overlay.mjs";

const overlayOf = (...operations) => ({ ...emptyOverlay("DEP-TEST"), operations });
const render = overlay => renderTranscript({ working:WORKING, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley", overlay });
const apply = overlay => applyOverlay(WORKING.segments, overlay);

const WORD = n => `${WORKING.segments[0].asrWordIds[0].split(":word:")[0]}:word:${n}`;
// Where Mr. Bentley's direct opens, where Ms. Ramon's paragraph begins, and where he resumes.
const DIRECT_AT = WORD(15), CROSS_AT = WORD(62), REDIRECT_AT = WORD(76);
const boundary = (atWordId, examinerPersonId, type) => ({ op:"examination", atWordId, examinerPersonId, type });

// --- validation ------------------------------------------------------------------------------

test("a boundary needs a word, a person and a type", () => {
  assert.equal(validateOperation(boundary("", "counsel-ramon", "CROSS")).ok, false);
  assert.match(validateOperation({ op:"examination", examinerPersonId:"counsel-ramon", type:"CROSS" }).message, /requires atWordId/);

  // The one that matters most. A boundary naming nobody would put a CROSS-EXAMINATION heading and
  // a BY-line over an examiner the record cannot name.
  const nobody = validateOperation(boundary(CROSS_AT, "   ", "CROSS"));
  assert.equal(nobody.ok, false);
  assert.match(nobody.message, /names nobody/);

  assert.equal(validateOperation(boundary(CROSS_AT, "counsel-ramon", "")).ok, false);
  assert.equal(validateOperation(boundary(CROSS_AT, "counsel-ramon", "SIDEBAR")).ok, false,
    "an unrecognised examination type is refused rather than printed as a heading");
});

test("every recognised examination type is accepted, and the type is normalised", () => {
  for (const type of EXAMINATION_TYPES) {
    const result = validateOperation(boundary(CROSS_AT, "counsel-ramon", type));
    assert.equal(result.ok, true, `${type} must be accepted`);
    assert.equal(result.operation.type, type);
  }
  assert.equal(validateOperation(boundary(CROSS_AT, "counsel-ramon", "cross")).operation.type, "CROSS",
    "case is normalised, so a caller cannot record two spellings of one examination");
});

test("a boundary carries no end", () => {
  // The next boundary terminates the previous one. An end anchor could contradict where the
  // following examination starts, and then two true-looking facts disagree about the same word.
  const { operation } = validateOperation({ ...boundary(CROSS_AT, "counsel-ramon", "CROSS"), endWordId:REDIRECT_AT });
  assert.deepEqual(Object.keys(operation).sort(), ["atWordId", "examinerPersonId", "op", "type"]);
});

// --- application -----------------------------------------------------------------------------

test("an overlay with no boundaries reports none", () => {
  assert.deepEqual(apply(overlayOf()).examinations, []);
});

test("a boundary is recorded against the word it begins at", () => {
  const applied = apply(overlayOf(boundary(CROSS_AT, "counsel-ramon", "CROSS")));
  assert.deepEqual(applied.examinations, [{ atWordId:CROSS_AT, examinerPersonId:"counsel-ramon", type:"CROSS" }]);
  assert.deepEqual(applied.orphaned, []);
});

test("boundaries come back in transcript order, not the order they were marked", () => {
  // A reporter who notices the redirect first and goes back for the cross has described the same
  // proceeding. Whatever walks paragraphs in order must meet the boundaries in order.
  const applied = apply(overlayOf(
    boundary(REDIRECT_AT, "counsel-bentley", "REDIRECT"),
    boundary(DIRECT_AT, "counsel-bentley", "DIRECT"),
    boundary(CROSS_AT, "counsel-ramon", "CROSS"),
  ));
  assert.deepEqual(applied.examinations.map(item => item.atWordId), [DIRECT_AT, CROSS_AT, REDIRECT_AT]);
  assert.deepEqual(applied.examinations.map(item => item.type), ["DIRECT", "CROSS", "REDIRECT"]);
});

test("a boundary whose anchor word is gone orphans rather than vanishing", () => {
  const applied = apply(overlayOf(boundary("job-that-does-not-exist:word:9999", "counsel-ramon", "CROSS")));
  assert.deepEqual(applied.examinations, []);
  assert.equal(applied.orphaned.length, 1);
  assert.equal(applied.orphaned[0].reason, "WORD_NOT_FOUND");
  assert.equal(applied.orphaned[0].operation.op, "examination");
});

test("a second boundary on the same word is refused, and the first survives", () => {
  // Refused rather than overwritten. `flag` moves a mark that means "listen again" and loses
  // nothing; a boundary is the reporter's statement that a named person began examining here, and
  // replacing one silently would discard a recorded fact about the proceeding.
  const applied = apply(overlayOf(
    boundary(CROSS_AT, "counsel-ramon", "CROSS"),
    boundary(CROSS_AT, "counsel-bentley", "REDIRECT"),
  ));
  assert.deepEqual(applied.examinations, [{ atWordId:CROSS_AT, examinerPersonId:"counsel-ramon", type:"CROSS" }],
    "the boundary the reporter recorded first is the one that stands");
  assert.equal(applied.orphaned.length, 1);
  assert.equal(applied.orphaned[0].reason, "EXAMINATION_ALREADY_BOUNDED");
});

test("two boundaries on different words both stand", () => {
  // The positive half of the refusal above. Without it, an apply that dropped every boundary but
  // the first would pass the duplicate test.
  const applied = apply(overlayOf(
    boundary(CROSS_AT, "counsel-ramon", "CROSS"),
    boundary(REDIRECT_AT, "counsel-bentley", "REDIRECT"),
  ));
  assert.equal(applied.examinations.length, 2);
  assert.deepEqual(applied.orphaned, []);
});

// --- it changes nothing yet ------------------------------------------------------------------

test("a boundary changes no word the reader reads", () => {
  // Phase B is inert by design. If this fails, labelling has been changed, and that is Phase C.
  const withBoundaries = render(overlayOf(
    boundary(DIRECT_AT, "counsel-bentley", "DIRECT"),
    boundary(CROSS_AT, "counsel-ramon", "CROSS"),
  ));
  const plain = render(overlayOf());
  assert.deepEqual(withBoundaries.paragraphs, plain.paragraphs,
    "recording an examination boundary must not yet move a single Q. or A.");
});

test("a boundary still resolves after a split reshapes the segment holding it", () => {
  // Splits never reorder words, so a boundary marked before one keeps its place. Asserted rather
  // than assumed, because this ordering is what Phase C will walk.
  const applied = apply(overlayOf(
    boundary(CROSS_AT, "counsel-ramon", "CROSS"),
    { op:"split", beforeWordId:WORD(66) },
    boundary(REDIRECT_AT, "counsel-bentley", "REDIRECT"),
  ));
  assert.deepEqual(applied.examinations.map(item => item.atWordId), [CROSS_AT, REDIRECT_AT]);
  assert.deepEqual(applied.orphaned, []);
});

// --- it inherits the overlay's machinery -----------------------------------------------------

test("a boundary undoes and redoes like any other reporter action", () => {
  // The correction path for a mis-marked boundary, and the reason refusing a duplicate is not a
  // dead end.
  const overlay = appendTransaction(emptyOverlay("DEP-TEST"), [boundary(CROSS_AT, "counsel-ramon", "CROSS")]);
  assert.equal(apply(overlay).examinations.length, 1);

  const undone = undoLastTransaction(overlay);
  assert.deepEqual(apply(undone.overlay).examinations, [], "undo removes the boundary");

  const redone = redoLastTransaction(undone.overlay);
  assert.deepEqual(apply(redone.overlay).examinations, [{ atWordId:CROSS_AT, examinerPersonId:"counsel-ramon", type:"CROSS" }],
    "and redo restores exactly what was recorded");
});

test("a boundary survives being written out and read back", () => {
  // Overlays are persisted as JSON and revalidated on load. A boundary that failed validateOverlay
  // would take the whole overlay -- every correction in it -- down with it.
  const overlay = appendTransaction(emptyOverlay("DEP-TEST"), [boundary(CROSS_AT, "counsel-ramon", "CROSS")]);
  const roundTripped = JSON.parse(JSON.stringify(overlay));
  assert.deepEqual(apply(roundTripped).examinations, apply(overlay).examinations);
});

// --- positive control --------------------------------------------------------------------------

test("the harness detects a difference when one exists", () => {
  // Without this, an applyOverlay that returned [] for every input would pass much of this file.
  const one = apply(overlayOf(boundary(CROSS_AT, "counsel-ramon", "CROSS")));
  const other = apply(overlayOf(boundary(CROSS_AT, "counsel-bentley", "CROSS")));
  assert.notDeepEqual(one.examinations, other.examinations, "changing the examiner must change the result");
});
