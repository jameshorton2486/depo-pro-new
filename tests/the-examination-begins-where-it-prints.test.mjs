// EXAMINATION announces itself where the examination actually begins.
//
// FOUND ON HEATH THOMAS, PAGE 1. The implicit heading goes to the examiner's first question, and
// "first" meant first in the list rather than first that prints. The reporter struck every word of
// two early paragraphs the AI had labelled Q. -- pre-record crosstalk, correctly deleted -- and
// EXAMINATION / BY NUNEZ: then anchored to a paragraph that renders as nothing, standing at the top
// of page 1 above the oath. The transcript said the examination began before the witness was sworn.
//
// The second half is worse and was invisible until the first was fixed. A reporter who marks the
// paragraph where the examination really begins writes an explicit boundary -- and if it named the
// examiner already questioning, openExamination discarded it as a duplicate, keeping the implicit
// entry that carries no anchor. The one control that exists to correct a wrong placement could not
// correct this one.
//
// Synthetic throughout. No Heath Thomas text appears here: a fixture built to make one deposition
// render correctly proves nothing about the rule.
import assert from "node:assert/strict";
import test from "node:test";
import { appendTransaction, emptyOverlay, redoLastTransaction, undoLastTransaction } from "../server/reporter-overlay.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";

const JOB = "job";
const w = n => `${JOB}:word:${n}`;
let counter = 0, clock = 0;
const say = (identity, role, text) => {
  const words = text.split(" ").map(token => {
    clock += 0.4;
    return { id: w(++counter), word: token.toLowerCase(), punctuatedWord: token, start: Number(clock.toFixed(2)), end: Number((clock + 0.3).toFixed(2)), confidence: 0.95, deepgramSpeaker: 0, speakerConfidence: 0.9 };
  });
  return { words, segment: { id: `s${counter}`, sourceJobIdentity: JOB, sourceUploadId: "u", sourceOrdinal: 0, asrWordIds: words.map(word => word.id), text, deepgramSpeaker: 0, speakerIdentity: identity, transcriptRole: role, start: words[0].start, end: words.at(-1).end } };
};

// Chatter, then the reporter's opening, the oath, the hand-over, and only then the examination.
const CHATTER = say("attorney-1", "QUESTIONING_ATTORNEY", "Are we recording yet?");
const OPENING = say("reporter", "COURT_REPORTER", "We are on the record.");
const OATH = say("reporter", "COURT_REPORTER", "Do you solemnly swear to tell the truth?");
const SWORN = say("witness", "WITNESS", "I do.");
const HANDOVER = say("reporter", "COURT_REPORTER", "You may proceed with the examination.");
const FIRST_Q = say("attorney-1", "QUESTIONING_ATTORNEY", "Please state your name.");
const ANSWER = say("witness", "WITNESS", "Pat Deponent.");
const CROSS_Q = say("attorney-2", "QUESTIONING_ATTORNEY", "Just a few questions.");
const TURNS = [CHATTER, OPENING, OATH, SWORN, HANDOVER, FIRST_Q, ANSWER, CROSS_Q];

const EVIDENCE = [{ jobIdentity: JOB, words: TURNS.flatMap(turn => turn.words) }];
const WORKING = { schemaVersion: "1.1.0", depositionId: "DEP-T", derivedFrom: [JOB], speakerMap: { status: "reconciled", assignments: [] }, segments: TURNS.map(turn => turn.segment) };
const CANDIDATES = [
  { id: "witness", label: "THE WITNESS", defaultRole: "WITNESS" },
  { id: "reporter", label: "THE REPORTER", defaultRole: "COURT_REPORTER" },
  { id: "attorney-1", label: "NUNEZ", defaultRole: "QUESTIONING_ATTORNEY" },
  { id: "attorney-2", label: "ALVARADO", defaultRole: "DEFENDING_ATTORNEY" },
];

const render = overlay => renderTranscript({ working: WORKING, evidence: EVIDENCE, overlay, speakerCandidates: CANDIDATES });
const headings = rendered => rendered.paragraphs
  .map((paragraph, index) => ({ index, type: paragraph.elementType, text: paragraph.text }))
  .filter(item => item.type === "HEADING" || item.type === "BY_LINE");
const strikeChatter = () => appendTransaction(emptyOverlay("DEP-T"), CHATTER.words.map(word => ({ op: "delete", wordId: word.id })));
const textAt = (rendered, index) => (rendered.paragraphs[index]?.text ?? "").replace(/\s+/g, " ");

test("before the repair's condition exists, the first question anchors it", () => {
  // The unstruck baseline, so the repair is shown to change only the case it is about. With every
  // paragraph printing, the examiner's first question IS the chatter, and the heading belongs there.
  const rendered = render(emptyOverlay("DEP-T"));
  const [heading] = headings(rendered);
  assert.equal(heading.text, "EXAMINATION");
  assert.equal(textAt(rendered, heading.index + 2), "Are we recording yet?", "anchored at the first question");
});

test("a struck paragraph cannot anchor the examination", () => {
  const rendered = render(strikeChatter());
  const marks = headings(rendered);
  assert.equal(marks.length, 2, "one heading and one by-line");
  assert.equal(marks[0].text, "EXAMINATION");
  assert.equal(marks[1].text, "BY NUNEZ:");
  assert.equal(textAt(rendered, marks[1].index + 1), "Please state your name.",
    "the heading moves to the first question that prints");
});

test("the opening and the oath stay above the heading", () => {
  // The reason this matters on a certified page: a heading placed above the oath says the
  // examination began before the witness was sworn.
  const rendered = render(strikeChatter());
  const heading = headings(rendered)[0].index;
  const before = rendered.paragraphs.slice(0, heading).map(paragraph => paragraph.text).join(" ");
  assert.match(before, /We are on the record\./);
  assert.match(before, /Do you solemnly swear/);
  assert.match(before, /I do\./);
  assert.match(before, /You may proceed with the examination\./);
});

test("the reporter can say where the examination begins, and is obeyed", () => {
  // THE MANUAL OVERRIDE. Automatic placement cannot know which question opens the examination --
  // here it would choose the answer-side chatter's successor. The reporter marks the paragraph and
  // that is where it goes.
  const overlay = appendTransaction(strikeChatter(),
    [{ op: "examination", atWordId: FIRST_Q.words[0].id, examinerPersonId: "attorney-1", type: "DIRECT" }]);
  const rendered = render(overlay);
  const marks = headings(rendered);
  assert.equal(marks.filter(mark => mark.type === "HEADING").length, 1, "one heading, not two");
  assert.equal(textAt(rendered, marks[1].index + 1), "Please state your name.");
  const examinations = rendered.examinations ?? [];
  assert.equal(examinations.length, 1);
  assert.equal(examinations[0].atWordId, FIRST_Q.words[0].id, "the reporter's anchor is the one kept");
  assert.equal(examinations[0].implicit, false, "and it is no longer a derived placement");
});

test("an explicit boundary at a different paragraph moves the heading there", () => {
  // The case the repair exists for: the reporter disagrees with the derived placement. Marking the
  // hand-over paragraph puts the heading there instead, and still produces exactly one.
  const overlay = appendTransaction(strikeChatter(),
    [{ op: "examination", atWordId: HANDOVER.words[0].id, examinerPersonId: "attorney-1", type: "DIRECT" }]);
  const rendered = render(overlay);
  const marks = headings(rendered);
  assert.equal(marks.filter(mark => mark.type === "HEADING").length, 1, "still one heading");
  assert.equal(textAt(rendered, marks[1].index + 1), "You may proceed with the examination.");
});

test("a later examiner opens a second examination of its own", () => {
  const overlay = appendTransaction(strikeChatter(),
    [{ op: "examination", atWordId: CROSS_Q.words[0].id, examinerPersonId: "attorney-2", type: "CROSS" }]);
  const rendered = render(overlay);
  const marks = headings(rendered).filter(mark => mark.type === "HEADING");
  assert.deepEqual(marks.map(mark => mark.text), ["EXAMINATION", "CROSS-EXAMINATION"],
    "the direct still announces itself, and the cross gets its own heading");
});

test("Undo and Redo recompute the placement, because nothing about it is stored", () => {
  const struck = strikeChatter();
  const withHeadingMoved = render(struck);
  assert.equal(textAt(withHeadingMoved, headings(withHeadingMoved)[1].index + 1), "Please state your name.");

  const { overlay: undone } = undoLastTransaction(struck);
  const restored = render(undone);
  assert.equal(textAt(restored, headings(restored)[0].index + 2), "Are we recording yet?",
    "undoing the strike puts the anchor back");

  const { overlay: redone } = redoLastTransaction(undone);
  const again = render(redone);
  assert.equal(textAt(again, headings(again)[1].index + 1), "Please state your name.",
    "and redoing moves it forward again");
});

test("none of this touches the evidence", () => {
  const snapshot = JSON.stringify({ EVIDENCE, WORKING });
  render(strikeChatter());
  render(appendTransaction(strikeChatter(),
    [{ op: "examination", atWordId: FIRST_Q.words[0].id, examinerPersonId: "attorney-1", type: "DIRECT" }]));
  assert.equal(JSON.stringify({ EVIDENCE, WORKING }), snapshot,
    "rendering is a projection; the ASR evidence and the stored transcript are read, never written");
});

test("the placement is deterministic", () => {
  // Pagination and the index are derived from this sequence, so two renders of one state must not
  // disagree about where the examination begins.
  const overlay = strikeChatter();
  assert.deepEqual(headings(render(overlay)), headings(render(overlay)));
  assert.deepEqual(render(overlay).examinations, render(overlay).examinations);
});
