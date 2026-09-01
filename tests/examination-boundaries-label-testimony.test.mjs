// Phase C of the Examination Model. See §246 in the audit ledger.
//
// Phase B gave the transcript a persistent notion of where examination authority changes hands.
// This phase is the first that uses it, and it changes what the reporter sees as testimony, which
// is why the scope is deliberately narrow: Q./A. labelling only. Headings, BY-lines, the
// examination index and the Workspace control are Phase D and E and are not touched here.
//
// The invariant under test:
//
//   active examiner speech  -> Q.
//   witness response        -> A.
//   non-examining attorney  -> colloquy
//
// The thing most likely to go wrong is not the cross-examination case, which is obvious when it
// fails. It is an implementation that tracks the active examiner but clears the pending question
// on colloquy, turning every answer after an objection into THE WITNESS:. Several tests below
// exist only to catch that.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING as ETMINAN } from "./fixtures/etminan-evidence.mjs";
import { WORKING as LONG } from "./fixtures/long-deposition.mjs";
import { labelParagraphs } from "../server/transcript-labels.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";
import { appendTransaction, emptyOverlay, redoLastTransaction, undoLastTransaction } from "../server/reporter-overlay.mjs";
import { STALE_REPORTER_TRANSACTION, appendReporterOperations, getWorkingTranscript, readReporterOverlay } from "../server/transcription-jobs.mjs";
import { computeReviewStateHash } from "../server/review-state-hash.mjs";

const LABELS = { alvarez:"MR. ALVAREZ", whitfield:"MS. WHITFIELD", ramirez:"MS. RAMIREZ", witness:"THE WITNESS" };
// Each utterance is one word id, so a boundary can be anchored at any of them.
let counter = 0;
const say = (id, role, text) => {
  const wordId = `job1:word:${++counter}`;
  return { id:`seg-${counter}`, speakerIdentity:id, transcriptRole:role, text, asrWordIds:[wordId], wordId };
};
const at = (paragraph, examinerPersonId, type) => ({ atWordId:paragraph.wordId, examinerPersonId, type });
const shape = (paragraphs, examinations = []) =>
  labelParagraphs(paragraphs, { labels:LABELS, examinerIdentity:"alvarez", examinations })
    .map(item => `${item.elementType}:${item.label ?? "-"}`);

// --- the sequence a deposition actually runs ---------------------------------------------------

test("direct, cross, redirect and recross each render as testimony", () => {
  // The whole arc, in one pass, because the failure mode that matters is a boundary that does not
  // terminate the previous examination -- and that only shows up on the third transition.
  const q1 = say("alvarez", "QUESTIONING_ATTORNEY", "Where were you going?");
  const a1 = say("witness", "WITNESS", "Home.");
  const q2 = say("whitfield", "QUESTIONING_ATTORNEY", "Did you see the vehicle?");
  const a2 = say("witness", "WITNESS", "I did.");
  const q3 = say("alvarez", "QUESTIONING_ATTORNEY", "Briefly, on redirect.");
  const a3 = say("witness", "WITNESS", "Understood.");
  const q4 = say("whitfield", "QUESTIONING_ATTORNEY", "One more thing.");
  const a4 = say("witness", "WITNESS", "All right.");

  assert.deepEqual(shape([q1, a1, q2, a2, q3, a3, q4, a4], [
    at(q1, "alvarez", "DIRECT"), at(q2, "whitfield", "CROSS"),
    at(q3, "alvarez", "REDIRECT"), at(q4, "whitfield", "RECROSS"),
  ]), ["QUESTION:Q.", "ANSWER:A.", "QUESTION:Q.", "ANSWER:A.", "QUESTION:Q.", "ANSWER:A.", "QUESTION:Q.", "ANSWER:A."]);
});

test("cross by defending counsel becomes testimony, which is the defect this phase fixes", () => {
  // Phase A pinned this same sequence rendering as COLLOQUY / COLLOQUY. The only difference here
  // is one boundary.
  const pass = say("alvarez", "QUESTIONING_ATTORNEY", "Pass the witness.");
  const ack = say("witness", "WITNESS", "All right.");
  const cross = say("ramirez", "DEFENDING_ATTORNEY", "Did you see the vehicle?");
  const answer = say("witness", "WITNESS", "I did.");
  const paragraphs = [pass, ack, cross, answer];

  assert.deepEqual(shape(paragraphs), ["QUESTION:Q.", "ANSWER:A.", "COLLOQUY:MS. RAMIREZ:", "COLLOQUY:THE WITNESS:"],
    "without a boundary the old behaviour stands, unchanged");
  assert.deepEqual(shape(paragraphs, [at(cross, "ramirez", "CROSS")]),
    ["QUESTION:Q.", "ANSWER:A.", "QUESTION:Q.", "ANSWER:A."],
    "with one boundary her examination is testimony");
});

test("a participant's transcriptRole is never what decides this", () => {
  // Ms. Ramirez stays DEFENDING_ATTORNEY throughout. Examination authority is interval-scoped and
  // layered over the participant role; it does not relabel the participant. Five consumers depend
  // on transcriptRole keeping its meaning.
  const cross = say("ramirez", "DEFENDING_ATTORNEY", "Did you see the vehicle?");
  const laterObjection = say("ramirez", "DEFENDING_ATTORNEY", "Objection, form.");
  const back = say("alvarez", "QUESTIONING_ATTORNEY", "Redirect.");
  const labelled = labelParagraphs([cross, back, laterObjection], {
    labels:LABELS, examinerIdentity:"alvarez",
    examinations:[at(cross, "ramirez", "CROSS"), at(back, "alvarez", "REDIRECT")],
  });
  assert.deepEqual(labelled.map(item => item.transcriptRole), ["DEFENDING_ATTORNEY", "QUESTIONING_ATTORNEY", "DEFENDING_ATTORNEY"]);
  assert.deepEqual(labelled.map(item => item.elementType), ["QUESTION", "QUESTION", "COLLOQUY"],
    "the same person is the examiner in one interval and colloquy in another");
});

// --- objections, which is where this most easily breaks ----------------------------------------

test("an objection during cross keeps the question open and the answer is still A.", () => {
  const cross = say("whitfield", "QUESTIONING_ATTORNEY", "Did you see the vehicle?");
  const objection = say("ramirez", "DEFENDING_ATTORNEY", "Objection, form.");
  const answer = say("witness", "WITNESS", "Yes.");
  assert.deepEqual(shape([cross, objection, answer], [at(cross, "whitfield", "CROSS")]),
    ["QUESTION:Q.", "COLLOQUY:MS. RAMIREZ:", "ANSWER:A."],
    "the non-examining attorney is colloquy and does not close the question");
});

test("B asks, A objects, B rephrases, the witness answers", () => {
  const q = say("whitfield", "QUESTIONING_ATTORNEY", "Did you see the vehicle?");
  const objection = say("ramirez", "DEFENDING_ATTORNEY", "Objection, form.");
  const rephrased = say("whitfield", "QUESTIONING_ATTORNEY", "What did you see?");
  const answer = say("witness", "WITNESS", "A blue sedan.");
  assert.deepEqual(shape([q, objection, rephrased, answer], [at(q, "whitfield", "CROSS")]),
    ["QUESTION:Q.", "COLLOQUY:MS. RAMIREZ:", "QUESTION:Q.", "ANSWER:A."]);
});

test("B asks, A objects, B says she will rephrase, then asks a new question", () => {
  // Both of the examiner's utterances render as Q., including the one that is not a question.
  // That is existing single-examiner behaviour reaching a second examiner unchanged -- the rule
  // has always been that the active examiner's speech is Q. -- and it is stated here rather than
  // left to be discovered, because it is the kind of thing a reader of the output will notice.
  const q = say("whitfield", "QUESTIONING_ATTORNEY", "Did you see the vehicle?");
  const objection = say("ramirez", "DEFENDING_ATTORNEY", "Objection, form.");
  const rephrase = say("whitfield", "QUESTIONING_ATTORNEY", "I will rephrase.");
  const newQuestion = say("whitfield", "QUESTIONING_ATTORNEY", "What did you see?");
  const answer = say("witness", "WITNESS", "A blue sedan.");
  assert.deepEqual(shape([q, objection, rephrase, newQuestion, answer], [at(q, "whitfield", "CROSS")]),
    ["QUESTION:Q.", "COLLOQUY:MS. RAMIREZ:", "QUESTION:Q.", "QUESTION:Q.", "ANSWER:A."]);
});

test("the reporter and the videographer close the question, during cross as during direct", () => {
  const cross = say("whitfield", "QUESTIONING_ATTORNEY", "Did you see the vehicle?");
  const reporter = say("reporter", "COURT_REPORTER", "I am sorry, could you repeat that?");
  const witness = say("witness", "WITNESS", "I said yes.");
  const video = say("videographer", "VIDEOGRAPHER", "We are going off the record at 11:42 a.m.");
  assert.deepEqual(shape([cross, reporter, witness, video], [at(cross, "whitfield", "CROSS")]),
    ["QUESTION:Q.", "COLLOQUY:-", "COLLOQUY:THE WITNESS:", "COLLOQUY:-"],
    "a reporter interjection is not an objection: the witness is no longer answering");
});

// --- the boundary itself -----------------------------------------------------------------------

test("a boundary naming whoever is already examining changes nothing", () => {
  // It says nothing new about the proceeding. Treating it as a change would clear the resumption
  // state a single-examiner transcript depends on.
  const q = say("alvarez", "QUESTIONING_ATTORNEY", "Where were you going?");
  const objection = say("ramirez", "DEFENDING_ATTORNEY", "Objection.");
  const answer = say("witness", "WITNESS", "Home.");
  const resumed = say("alvarez", "QUESTIONING_ATTORNEY", "Where exactly?");
  const paragraphs = [q, objection, answer, resumed];
  // Anchored at the RESUMING paragraph, not the opening one. Anywhere else the reset is invisible
  // because there is no resumption state to lose, and the test would pass while proving nothing --
  // it did, until a mutation that deleted the guard survived it.
  const withRedundant = labelParagraphs(paragraphs, { labels:LABELS, examinerIdentity:"alvarez", examinations:[at(resumed, "alvarez", "DIRECT")] });
  const without = labelParagraphs(paragraphs, { labels:LABELS, examinerIdentity:"alvarez" });
  assert.deepEqual(withRedundant.map(item => item.byLine), without.map(item => item.byLine),
    "including the resumption by-line, which a spurious reset would have swallowed");
  assert.deepEqual(withRedundant.map(item => item.elementType), without.map(item => item.elementType));
});

test("a handover does not emit a resumption by-line", () => {
  // An inline "(BY MS. WHITFIELD)" is the mark for an examiner returning after colloquy, not for
  // a new examiner beginning. The standalone heading and by-line that belong at a handover are
  // Phase D; what matters here is that this phase does not invent the wrong one.
  const q = say("alvarez", "QUESTIONING_ATTORNEY", "Anything else?");
  const objection = say("ramirez", "DEFENDING_ATTORNEY", "Objection.");
  const answer = say("witness", "WITNESS", "No.");
  const cross = say("whitfield", "QUESTIONING_ATTORNEY", "Doctor, my name is Grace Whitfield.");
  const labelled = labelParagraphs([q, objection, answer, cross], {
    labels:LABELS, examinerIdentity:"alvarez", examinations:[at(cross, "whitfield", "CROSS")],
  });
  assert.equal(labelled.at(-1).elementType, "QUESTION");
  assert.equal(labelled.at(-1).byLine, null, "a new examiner begins; she does not resume");
});

test("a boundary anchored inside an answer does not cost that answer its A.", () => {
  // The reporter is meant to mark the word the new examination begins at. If they mark one word
  // late -- inside the answer that is still responding to the previous examiner's question -- the
  // answer must still read as testimony. An implementation that cleared the pending question when
  // authority moved would render it THE WITNESS:, which is the same silent corruption an
  // objection-clears-the-examiner bug produces, arriving by a different route.
  const question = say("alvarez", "QUESTIONING_ATTORNEY", "Did you see the vehicle?");
  const answer = say("witness", "WITNESS", "I did.");
  const cross = say("whitfield", "QUESTIONING_ATTORNEY", "Let me ask about that.");
  assert.deepEqual(shape([question, answer, cross], [at(answer, "whitfield", "CROSS")]),
    ["QUESTION:Q.", "ANSWER:A.", "QUESTION:Q."],
    "the answer keeps its A. and the new examiner still takes over");
});

// --- nothing changes without boundaries --------------------------------------------------------

test("an existing single-examiner deposition renders exactly as it did", () => {
  // The contract Phase C rests on. Every branch of labelParagraphs is exercised here, and the
  // comparison is against the function called with no examinations at all -- the shape Phase A
  // pinned and every existing caller still uses.
  const paragraphs = [
    say("videographer", "VIDEOGRAPHER", "We are on the record."),
    say("reporter", "COURT_REPORTER", "Would counsel state appearances?"),
    say("alvarez", "QUESTIONING_ATTORNEY", "Please state your name."),
    say("witness", "WITNESS", "Mohammad Etminan."),
    say("ramirez", "DEFENDING_ATTORNEY", "Objection, form."),
    say("witness", "WITNESS", "I will answer."),
    say("alvarez", "QUESTIONING_ATTORNEY", "Thank you."),
  ];
  const untouched = labelParagraphs(paragraphs, { labels:LABELS, examinerIdentity:"alvarez" });
  for (const examinations of [[], undefined, null]) {
    const supplied = labelParagraphs(paragraphs, { labels:LABELS, examinerIdentity:"alvarez", examinations });
    assert.deepEqual(supplied.map(item => ({ elementType:item.elementType, label:item.label, byLine:item.byLine })),
      untouched.map(item => ({ elementType:item.elementType, label:item.label, byLine:item.byLine })),
      `an empty boundary list (${JSON.stringify(examinations)}) must reproduce today's output exactly`);
  }
});

// --- through the render, the overlay and the store ---------------------------------------------

const CROSS_WORD = ETMINAN.segments[7].asrWordIds[0];
const renderWith = overlay => renderTranscript({ working:ETMINAN, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley", overlay });
const boundaryOp = { op:"examination", atWordId:CROSS_WORD, examinerPersonId:"counsel-ramon", type:"CROSS" };

test("a persisted boundary reaches the rendered transcript", () => {
  const before = renderWith(null).paragraphs;
  const after = renderWith(appendTransaction(emptyOverlay("DEP-TEST"), [boundaryOp])).paragraphs;
  const crossIndex = before.findIndex(item => item.speakerIdentity === "counsel-ramon");
  assert.ok(crossIndex >= 0, "the fixture must contain a second attorney");
  assert.equal(before[crossIndex].elementType, "COLLOQUY", "her paragraph was conversation");
  assert.equal(after[crossIndex].elementType, "QUESTION", "and one boundary makes it a question");

  // The answer after her is ANSWER in both renderings, and that is not the boundary's doing: in
  // this fixture she speaks while Mr. Bentley's question is still open, so the existing rule that
  // attorney colloquy does not close a question already produced A. The point worth asserting is
  // that the boundary did not disturb it -- an implementation that reset the pending question on
  // an examiner change would turn this into THE WITNESS:.
  assert.equal(before[crossIndex + 1].elementType, "ANSWER");
  assert.equal(after[crossIndex + 1].elementType, "ANSWER");
});

test("a boundary survives a reload and reconstruction", () => {
  // The overlay is written to disk as JSON and revalidated on the way back in. Rendering from the
  // round-tripped record must produce the same transcript, or a reporter sees one thing before a
  // reload and another after it.
  const overlay = appendTransaction(emptyOverlay("DEP-TEST"), [boundaryOp]);
  const reloaded = JSON.parse(JSON.stringify(overlay));
  assert.deepEqual(renderWith(reloaded).paragraphs.map(item => item.elementType),
    renderWith(overlay).paragraphs.map(item => item.elementType));
});

test("undoing a boundary restores the previous labelling, and redo returns it", () => {
  const overlay = appendTransaction(emptyOverlay("DEP-TEST"), [boundaryOp]);
  const plain = renderWith(null).paragraphs.map(item => item.elementType);
  const marked = renderWith(overlay).paragraphs.map(item => item.elementType);
  assert.notDeepEqual(marked, plain, "the boundary must actually change something, or undo proves nothing");

  const undone = undoLastTransaction(overlay);
  assert.deepEqual(renderWith(undone.overlay).paragraphs.map(item => item.elementType), plain);
  const redone = redoLastTransaction(undone.overlay);
  assert.deepEqual(renderWith(redone.overlay).paragraphs.map(item => item.elementType), marked);
});

test("a boundary written against a stale transcript is refused like any other edit", (t) => {
  // The currency guard lives in the mutation boundary rather than in a route, so a new operation
  // inherits it. Asserted rather than assumed: an operation that could be written without proving
  // what it was made against would let a second tab move examination authority under the first.
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-exam-"));
  t.after(() => fs.rmSync(storageRoot, { recursive:true, force:true }));
  const depositionId = "DEP-20260901-EXAM1";
  const directory = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(path.join(directory, "transcript"), { recursive:true });
  fs.mkdirSync(path.join(directory, "deepgram", "jobs", "job1"), { recursive:true });
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ id:depositionId, storagePath:"reporter/cause/witness", audio:[] }));
  fs.writeFileSync(path.join(directory, "transcript", "working.json"), JSON.stringify({
    schemaVersion:"1.1.0", recordType:"WORKING_TRANSCRIPT", derivedFrom:["job1"],
    speakerMap:{ status:"unreconciled", assignments:[] },
    segments:[{ id:"job1:segment:1", asrWordIds:["job1:word:1", "job1:word:2"], text:"one two" }],
  }));
  fs.writeFileSync(path.join(directory, "deepgram", "jobs", "job1", "asr-evidence.json"), JSON.stringify({
    schemaVersion:"1.1.0", recordType:"CANONICAL_ASR_EVIDENCE", jobIdentity:"job1",
    words:[{ id:"job1:word:1", word:"one", punctuatedWord:"One" }, { id:"job1:word:2", word:"two", punctuatedWord:"two." }],
  }));
  const store = { depositionId, storageRoot };
  const operations = [{ op:"examination", atWordId:"job1:word:1", examinerPersonId:"counsel-ramon", type:"CROSS" }];

  const carriedNothing = () => appendReporterOperations(process.cwd(), { ...store, operations });
  assert.throws(carriedNothing, error => error.code === STALE_REPORTER_TRANSACTION,
    "an edit that does not say what it was made against is refused");
  const carriedStale = () => appendReporterOperations(process.cwd(), { ...store, operations, expectedReviewStateHash:"not-the-current-hash" });
  assert.throws(carriedStale, error => error.code === STALE_REPORTER_TRANSACTION);
  assert.equal(readReporterOverlay(process.cwd(), store).operations.length, 0, "and nothing reached the overlay");

  const current = computeReviewStateHash({ transcript:getWorkingTranscript(process.cwd(), store), overlay:readReporterOverlay(process.cwd(), store) });
  appendReporterOperations(process.cwd(), { ...store, operations, expectedReviewStateHash:current });
  assert.equal(readReporterOverlay(process.cwd(), store).operations.length, 1,
    "and the same write succeeds once it proves currency, so the refusal is the guard and not a bug");
});

// --- scale ---------------------------------------------------------------------------------------

test("on the realistic deposition one boundary replaces 450 label operations", () => {
  // Phase A measured the cost of the missing model at 450 of 1,602 paragraphs. This is the same
  // deposition, and the claim is not that the number improves -- it is that it goes to zero for
  // one operation rather than 450.
  const crossAt = LONG.segments.find(segment => segment.speakerIdentity === "counsel-whitfield").asrWordIds[0];
  const options = { labels:{ "counsel-alvarez":"MR. ALVAREZ", "counsel-whitfield":"MS. WHITFIELD", "counsel-ramirez":"MS. RAMIREZ" }, examinerIdentity:"counsel-alvarez" };
  const before = labelParagraphs(LONG.segments, options);
  const after = labelParagraphs(LONG.segments, { ...options, examinations:[{ atWordId:crossAt, examinerPersonId:"counsel-whitfield", type:"CROSS" }] });

  // What was wrong: Ms. Whitfield's questions, and the witness's answers to them.
  const misrendered = index => {
    const segment = LONG.segments[index];
    if (segment.speakerIdentity === "counsel-whitfield") return before[index].elementType !== "QUESTION";
    if (segment.transcriptRole === "WITNESS" && LONG.segments[index - 1]?.speakerIdentity === "counsel-whitfield") return before[index].elementType !== "ANSWER";
    return false;
  };
  const wrongBefore = LONG.segments.map((_, index) => index).filter(misrendered);
  assert.equal(wrongBefore.length, 450, "the measured defect Phase A pinned");

  const stillWrong = wrongBefore.filter(index => {
    const segment = LONG.segments[index];
    const expected = segment.speakerIdentity === "counsel-whitfield" ? "QUESTION" : "ANSWER";
    return after[index].elementType !== expected;
  });
  assert.equal(stillWrong.length, 0, "one examination boundary corrects all 450");

  // And it corrected them by moving authority, not by relabelling everyone: the direct is
  // untouched and Ms. Ramirez's objections during cross are still colloquy.
  const crossIndex = LONG.segments.findIndex(segment => segment.speakerIdentity === "counsel-whitfield");
  const directUnchanged = LONG.segments.slice(0, crossIndex).every((_, index) => before[index].elementType === after[index].elementType);
  assert.ok(directUnchanged, "nothing before the handover moved");
  const objectionsDuringCross = LONG.segments.map((_, index) => index)
    .filter(index => index > crossIndex && LONG.segments[index].speakerIdentity === "counsel-ramirez");
  assert.ok(objectionsDuringCross.length > 0, "the fixture must contain objections during cross");
  assert.ok(objectionsDuringCross.every(index => after[index].elementType === "COLLOQUY"),
    "an over-eager boundary would turn every objection into a question, which is the failure least likely to be noticed");
});
