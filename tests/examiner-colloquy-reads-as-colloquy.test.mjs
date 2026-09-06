// §247-B. The labeller consumes the reporter's determination.
//
// Measured before the change, on the current build:
//
//     Q.   Did you see the vehicle?
//          MR. ALVAREZ:  Objection, form.
//     Q.   (BY MS. WHITFIELD)  I will rephrase.
//     Q.   What did you see?
//
// Two things wrong. The aside prints as testimony, and the resumption by-line -- which announces the
// examiner returning to questioning -- lands on the aside while her actual question carries nothing.
// Both are fixed here, because the second is a direct consequence of classifying the first.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/etminan-evidence.mjs";
import { labelParagraphs } from "../server/transcript-labels.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";
import { appendTransaction, emptyOverlay, redoLastTransaction, undoLastTransaction } from "../server/reporter-overlay.mjs";
import { STALE_REPORTER_TRANSACTION, appendReporterOperations, getWorkingTranscript, readReporterOverlay } from "../server/transcription-jobs.mjs";
import { computeReviewStateHash } from "../server/review-state-hash.mjs";

const LABELS = { whitfield:"MS. WHITFIELD", alvarez:"MR. ALVAREZ", witness:"THE WITNESS" };
let counter = 0;
const say = (speakerIdentity, transcriptRole, text) => {
  const wordId = `job1:word:${++counter}`;
  return { id:`s${counter}`, speakerIdentity, transcriptRole, text, asrWordIds:[wordId], wordId };
};
const shape = (paragraphs, colloquy = [], options = {}) =>
  labelParagraphs(paragraphs, { labels:LABELS, examinerIdentity:"whitfield", colloquy:new Set(colloquy), ...options })
    .paragraphs.map(item => `${item.elementType}:${item.label ?? "-"}${item.byLine ? ` ${item.byLine}` : ""}`);

// --- the sequence the owner specified ---------------------------------------------------------------

test("the aside becomes colloquy and the by-line moves to the real question", () => {
  const question = say("whitfield", "DEFENDING_ATTORNEY", "Did you see the vehicle?");
  const objection = say("alvarez", "QUESTIONING_ATTORNEY", "Objection, form.");
  const aside = say("whitfield", "DEFENDING_ATTORNEY", "I will rephrase.");
  const next = say("whitfield", "DEFENDING_ATTORNEY", "What did you see?");
  const answer = say("witness", "WITNESS", "A blue sedan.");

  assert.deepEqual(shape([question, objection, aside, next, answer], [aside.wordId]), [
    "QUESTION:Q.",
    "COLLOQUY:MR. ALVAREZ:",
    "COLLOQUY:MS. WHITFIELD:",
    "QUESTION:Q. (BY MS. WHITFIELD)",
    "ANSWER:A.",
  ]);
});

test("without the mark, the old behaviour stands -- including the by-line on the wrong line", () => {
  // The measurement this fixes, pinned. If someone later makes the labeller guess, this fails.
  const question = say("whitfield", "DEFENDING_ATTORNEY", "Did you see the vehicle?");
  const objection = say("alvarez", "QUESTIONING_ATTORNEY", "Objection, form.");
  const aside = say("whitfield", "DEFENDING_ATTORNEY", "I will rephrase.");
  const next = say("whitfield", "DEFENDING_ATTORNEY", "What did you see?");
  assert.deepEqual(shape([question, objection, aside, next]), [
    "QUESTION:Q.", "COLLOQUY:MR. ALVAREZ:", "QUESTION:Q. (BY MS. WHITFIELD)", "QUESTION:Q.",
  ]);
});

// --- the utterances a reporter actually marks ---------------------------------------------------------

test("let me back up, a request for a break, and speech to opposing counsel", () => {
  for (const text of ["Let me back up.", "Counsel, can we take a short break?", "Counsel, I will send you the exhibit."]) {
    const utterance = say("whitfield", "DEFENDING_ATTORNEY", text);
    assert.deepEqual(shape([utterance], [utterance.wordId]), ["COLLOQUY:MS. WHITFIELD:"], text);
    // The break request carries a genuine question mark and is still colloquy; nothing here reads it.
    assert.deepEqual(shape([utterance]), ["QUESTION:Q."], `${text} is only colloquy because the reporter said so`);
  }
});

test("consecutive asides all read as colloquy", () => {
  const first = say("whitfield", "DEFENDING_ATTORNEY", "Let me back up.");
  const second = say("whitfield", "DEFENDING_ATTORNEY", "Actually, strike that.");
  const question = say("whitfield", "DEFENDING_ATTORNEY", "When did you arrive?");
  assert.deepEqual(shape([first, second, question], [first.wordId, second.wordId]),
    ["COLLOQUY:MS. WHITFIELD:", "COLLOQUY:MS. WHITFIELD:", "QUESTION:Q."]);
});

// --- the open question ----------------------------------------------------------------------------------

test("an aside while a question is pending does not cost the answer its A.", () => {
  // The rule most likely to be broken silently. Attorney colloquy already does not close a question,
  // and the examiner's own aside is no different.
  const question = say("whitfield", "DEFENDING_ATTORNEY", "Do you remember the accident?");
  const aside = say("whitfield", "DEFENDING_ATTORNEY", "Actually, let me be more specific.");
  const answer = say("witness", "WITNESS", "Yes.");
  assert.deepEqual(shape([question, aside, answer], [aside.wordId]),
    ["QUESTION:Q.", "COLLOQUY:MS. WHITFIELD:", "ANSWER:A."]);
});

test("an aside with no question open leaves the witness as colloquy", () => {
  // The other direction, so the rule is not simply "always keep it open".
  const aside = say("whitfield", "DEFENDING_ATTORNEY", "Let me back up.");
  const witness = say("witness", "WITNESS", "May I see the exhibit?");
  assert.deepEqual(shape([aside, witness], [aside.wordId]),
    ["COLLOQUY:MS. WHITFIELD:", "COLLOQUY:THE WITNESS:"]);
});

test("an aside neither consumes nor creates a resumption by-line", () => {
  // Not consumed: the marker belongs on the question, which the first test asserts. Not created:
  // her own aside is not an interruption by somebody else, so a by-line after it would announce a
  // return from nowhere.
  const question = say("whitfield", "DEFENDING_ATTORNEY", "Did you see it?");
  const aside = say("whitfield", "DEFENDING_ATTORNEY", "Let me back up.");
  const next = say("whitfield", "DEFENDING_ATTORNEY", "When did you arrive?");
  assert.deepEqual(shape([question, aside, next], [aside.wordId]),
    ["QUESTION:Q.", "COLLOQUY:MS. WHITFIELD:", "QUESTION:Q."], "no by-line was invented");
});

// --- it is about the utterance, not the person ----------------------------------------------------------

test("the speaker and the role are untouched", () => {
  const aside = say("whitfield", "DEFENDING_ATTORNEY", "I will rephrase.");
  const [labelled] = labelParagraphs([aside], { labels:LABELS, examinerIdentity:"whitfield", colloquy:new Set([aside.wordId]) }).paragraphs;
  assert.equal(labelled.speakerIdentity, "whitfield", "she did say it");
  assert.equal(labelled.transcriptRole, "DEFENDING_ATTORNEY", "her participant role is not a classification");
});

test("marking an utterance does not move examination authority", () => {
  const direct = say("alvarez", "QUESTIONING_ATTORNEY", "Where were you going?");
  const cross = say("whitfield", "DEFENDING_ATTORNEY", "Did you see the vehicle?");
  const aside = say("whitfield", "DEFENDING_ATTORNEY", "Let me back up.");
  const options = { labels:LABELS, examinerIdentity:"alvarez", examinations:[{ atWordId:cross.wordId, examinerPersonId:"whitfield", type:"CROSS" }] };
  const withMark = labelParagraphs([direct, cross, aside], { ...options, colloquy:new Set([aside.wordId]) });
  const without = labelParagraphs([direct, cross, aside], options);
  assert.deepEqual(withMark.examinations, without.examinations, "three facts, three places");
});

test("it applies to whoever is examining at that point, in every examination", () => {
  for (const type of ["DIRECT", "CROSS", "REDIRECT", "RECROSS"]) {
    const opening = say("alvarez", "QUESTIONING_ATTORNEY", "Where were you going?");
    const start = say("whitfield", "DEFENDING_ATTORNEY", "Did you see the vehicle?");
    const aside = say("whitfield", "DEFENDING_ATTORNEY", "Let me back up.");
    // Alvarez's opening question needs a boundary of its own. Q. requires an established
    // examination, and "alvarez is the examiner" is not one -- it says who, never when.
    const shaped = shape([opening, start, aside], [aside.wordId], {
      examinerIdentity:"alvarez", examinations:[
        { atWordId:opening.wordId, examinerPersonId:"alvarez", type:"DIRECT" },
        { atWordId:start.wordId, examinerPersonId:"whitfield", type },
      ],
    });
    assert.deepEqual(shaped, ["QUESTION:Q.", "QUESTION:Q.", "COLLOQUY:MS. WHITFIELD:"], type);
  }
});

// --- clearing, and the machinery -------------------------------------------------------------------------

const ASIDE_WORD = WORKING.segments[2].asrWordIds[0];
const render = overlay => renderTranscript({ working:WORKING, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley", overlay });
const elementOf = (result, wordId) => result.paragraphs.find(item => (item.asrWordIds ?? []).includes(wordId))?.elementType;

test("clearing returns the utterance to what the model derives", () => {
  // Not to QUESTION by assertion. The clear removes a determination; the paragraph is derived again,
  // and here that derivation happens to produce a question.
  const marked = appendTransaction(emptyOverlay("DEP-TEST"), [{ op:"colloquy", wordId:ASIDE_WORD }]);
  assert.equal(elementOf(render(marked), ASIDE_WORD), "COLLOQUY");
  const cleared = appendTransaction(marked, [{ op:"uncolloquy", wordId:ASIDE_WORD }]);
  assert.equal(elementOf(render(cleared), ASIDE_WORD), elementOf(render(emptyOverlay("DEP-TEST")), ASIDE_WORD));
});

test("a mark undoes, redoes and survives a reload", () => {
  const overlay = appendTransaction(emptyOverlay("DEP-TEST"), [{ op:"colloquy", wordId:ASIDE_WORD }]);
  assert.equal(elementOf(render(overlay), ASIDE_WORD), "COLLOQUY");
  const undone = undoLastTransaction(overlay);
  assert.equal(elementOf(render(undone.overlay), ASIDE_WORD), "QUESTION");
  const redone = redoLastTransaction(undone.overlay);
  assert.equal(elementOf(render(redone.overlay), ASIDE_WORD), "COLLOQUY");
  assert.deepEqual(render(JSON.parse(JSON.stringify(overlay))).paragraphs, render(overlay).paragraphs,
    "reconstruction from the persisted record renders identically");
});

test("a mark written against a stale transcript is refused like any other edit", (t) => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-247-"));
  t.after(() => fs.rmSync(storageRoot, { recursive:true, force:true }));
  const depositionId = "DEP-20260901-C0LL1";
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
  const operations = [{ op:"colloquy", wordId:"job1:word:1" }];

  assert.throws(() => appendReporterOperations(process.cwd(), { ...store, operations }),
    error => error.code === STALE_REPORTER_TRANSACTION, "an edit that does not say what it was made against is refused");
  assert.throws(() => appendReporterOperations(process.cwd(), { ...store, operations, expectedReviewStateHash:"stale" }),
    error => error.code === STALE_REPORTER_TRANSACTION);
  assert.equal(readReporterOverlay(process.cwd(), store).operations.length, 0, "and nothing reached the overlay");

  const current = computeReviewStateHash({ transcript:getWorkingTranscript(process.cwd(), store), overlay:readReporterOverlay(process.cwd(), store) });
  appendReporterOperations(process.cwd(), { ...store, operations, expectedReviewStateHash:current });
  assert.equal(readReporterOverlay(process.cwd(), store).operations.length, 1, "and the same write succeeds once it proves currency");
});

// --- nothing moves without a mark ----------------------------------------------------------------------

test("a transcript with no mark renders exactly as it did", () => {
  const rendered = render(emptyOverlay("DEP-TEST"));
  const plain = renderTranscript({ working:WORKING, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley", overlay:null });
  assert.deepEqual(rendered.paragraphs, plain.paragraphs);
  for (const colloquy of [undefined, null, new Set(), []]) {
    const supplied = labelParagraphs(WORKING.segments, { labels:LABELS, examinerIdentity:"counsel-bentley", colloquy });
    const untouched = labelParagraphs(WORKING.segments, { labels:LABELS, examinerIdentity:"counsel-bentley" });
    assert.deepEqual(supplied.paragraphs.map(item => item.elementType), untouched.paragraphs.map(item => item.elementType),
      `an empty mark set (${JSON.stringify(colloquy)}) must reproduce today's output exactly`);
  }
});
