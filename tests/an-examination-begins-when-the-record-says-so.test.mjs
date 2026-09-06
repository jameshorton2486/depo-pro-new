// Q. requires an established examination. An attorney speaking is not one.
//
// THE DEFECT. The labeller carried the rule "speaker is the questioning attorney, therefore this
// utterance is a question." On Heath Thomas that made counsel's own appearance -- "Steven Nunez for
// Plaintiff" -- a question put to a witness who had not yet been sworn, and made every word of the
// opening procedure testimony. Examiner identity says WHO conducts the examination. It has never
// said WHEN one begins, and the two facts were being read off the same field.
//
// WHY NOT THE OATH. Whether the witness was sworn and where examination begins are related and
// distinct. For a deposition transcribed from an existing recording the oath was administered in
// the recording, long before this reporter opened the file; gating Q. on an attestation the current
// reporter never performed would strip testimony from exactly the records this application exists
// to transcribe. The transcript itself holds the transition -- the reporter finishes the oath and
// hands the proceeding to counsel -- and that transition is its own structural fact.
//
// The specimen below is the sequence the human-corrected Heath Thomas transcript establishes. It is
// a regression specimen, not a rule: nothing here matches on a phrase, a name or a party.
import assert from "node:assert/strict";
import test from "node:test";
import { EXAMINATION_CONTEXT, labelParagraphs } from "../server/transcript-labels.mjs";

const LABELS = { nunez:"MR. NUNEZ", zhan:"MS. ZHAN", reporter:"THE REPORTER", witness:"THE WITNESS" };
let counter = 0;
const say = (id, role, text) => {
  const wordId = `job1:word:${++counter}`;
  return { id:`seg-${counter}`, speakerIdentity:id, transcriptRole:role, text, asrWordIds:[wordId], wordId };
};
const at = (paragraph, examinerPersonId, type = "DIRECT") => ({ atWordId:paragraph.wordId, examinerPersonId, type });
const run = (paragraphs, options = {}) => labelParagraphs(paragraphs, { labels:LABELS, ...options });
const shape = (paragraphs, options = {}) =>
  run(paragraphs, options).paragraphs.map(item => `${item.elementType}:${item.label ?? "-"}`);

/** The opening of a deposition, in the order it actually runs. */
const opening = () => {
  const open = say("reporter", "COURT_REPORTER", "We are on the record.");
  const appearance = say("nunez", "QUESTIONING_ATTORNEY", "Steven Nunez for Plaintiff.");
  const defending = say("zhan", "DEFENDING_ATTORNEY", "Lucia Zhan for Defendants.");
  const oath = say("reporter", "COURT_REPORTER", "Do you solemnly swear the testimony you are about to give is the truth?");
  const swore = say("witness", "WITNESS", "I do.");
  const handoff = say("reporter", "COURT_REPORTER", "Thank you. You may proceed with the examination.");
  const first = say("nunez", "QUESTIONING_ATTORNEY", "Good afternoon. Would you state your name?");
  const answer = say("witness", "WITNESS", "Heath Thomas.");
  return { open, appearance, defending, oath, swore, handoff, first, answer,
    all:[open, appearance, defending, oath, swore, handoff, first, answer] };
};

// --- 1, 2, 3, 4: before the examination, and after it -------------------------------------------

test("the examining attorney's appearance is colloquy, not a question", () => {
  // THE DEFECT ITSELF. Nunez conducts the examination; this is still not part of it.
  const { all, first } = opening();
  const shaped = shape(all, { examinerIdentity:"nunez", examinations:[at(first, "nunez")] });
  assert.equal(shaped[1], "COLLOQUY:MR. NUNEZ:", "his appearance, spoken before any examination began");
});

test("defending counsel's appearance is colloquy too", () => {
  const { all, first } = opening();
  assert.equal(shape(all, { examinerIdentity:"nunez", examinations:[at(first, "nunez")] })[2], "COLLOQUY:MS. ZHAN:");
});

test("the whole opening reads as the proceeding, and testimony begins at the boundary", () => {
  // The complete specimen sequence, asserted in one place so a change to any part of it is visible.
  const { all, first } = opening();
  assert.deepEqual(shape(all, { examinerIdentity:"nunez", examinations:[at(first, "nunez")] }), [
    "COLLOQUY:THE REPORTER:",   // on the record
    "COLLOQUY:MR. NUNEZ:",      // appearance -- examining counsel, still colloquy
    "COLLOQUY:MS. ZHAN:",       // appearance -- defending counsel
    "COLLOQUY:THE REPORTER:",   // the oath
    "COLLOQUY:THE WITNESS:",    // "I do." -- an answer to nobody's question
    "COLLOQUY:THE REPORTER:",   // the handoff
    "QUESTION:Q.",              // 3. the first actual examination question
    "ANSWER:A.",                // 4. the witness answering it
  ]);
});

// --- 5, 6: what stays colloquy once the examination is running ----------------------------------

test("an objection does not become a question", () => {
  const { all, first } = opening();
  const objection = say("zhan", "DEFENDING_ATTORNEY", "Objection, form.");
  const answer = say("witness", "WITNESS", "About three years.");
  // Interposed between the question and its answer -- which is where an objection is actually made,
  // and the only arrangement in which "the answer keeps its A." means anything.
  const shaped = shape([...all.slice(0, -1), objection, answer], { examinerIdentity:"nunez", examinations:[at(first, "nunez")] });
  assert.equal(shaped.at(-2), "COLLOQUY:MS. ZHAN:");
  assert.equal(shaped.at(-1), "ANSWER:A.", "and the objection does not cost the witness their A.");
});

test("the examiner's own procedural colloquy stays colloquy", () => {
  // "I will pass the witness." is the examiner speaking inside their own examination, and it is not
  // a question. The reporter's determination establishes it; the boundary does not override it.
  const { all, first } = opening();
  const pass = say("nunez", "QUESTIONING_ATTORNEY", "I will pass the witness.");
  const options = { examinerIdentity:"nunez", examinations:[at(first, "nunez")], colloquy:[pass.wordId] };
  assert.equal(shape([...all, pass], options).at(-1), "COLLOQUY:MR. NUNEZ:");
  assert.equal(run([...all, pass], options).paragraphs.at(-1).examinerColloquy, true,
    "and it is marked as the reporter's determination, not the model's");
});

// --- 7, 8: recess, resumption, and the next examiner --------------------------------------------

test("a recess does not terminate the examination", () => {
  const { all, first } = opening();
  const off = say("reporter", "COURT_REPORTER", "We are off the record at 2:15 p.m.");
  const back = say("reporter", "COURT_REPORTER", "We are back on the record at 2:31 p.m.");
  const resumed = say("nunez", "QUESTIONING_ATTORNEY", "Before the break we were discussing the invoice.");
  const shaped = shape([...all, off, back, resumed], { examinerIdentity:"nunez", examinations:[at(first, "nunez")] });
  assert.equal(shaped.at(-1), "QUESTION:Q.", "the examination survives the recess");
  assert.deepEqual(shaped.slice(-3, -1), ["COLLOQUY:THE REPORTER:", "COLLOQUY:THE REPORTER:"]);
});

test("a subsequent examiner takes the questions with them", () => {
  const { all, first } = opening();
  const cross = say("zhan", "DEFENDING_ATTORNEY", "I have a few questions for you.");
  const crossAnswer = say("witness", "WITNESS", "All right.");
  const stray = say("nunez", "QUESTIONING_ATTORNEY", "Same objection.");
  const shaped = shape([...all, cross, crossAnswer, stray],
    { examinerIdentity:"nunez", examinations:[at(first, "nunez"), at(cross, "zhan", "CROSS")] });
  assert.deepEqual(shaped.slice(-3), ["QUESTION:Q.", "ANSWER:A.", "COLLOQUY:MR. NUNEZ:"],
    "Zhan is examining now, so Nunez's utterance is colloquy");
});

// --- 9, 10, 11: the boundary as authority -------------------------------------------------------

test("a reporter boundary outranks what the machine would have inferred", () => {
  // The inference would open the examination at Nunez's appearance. The reporter says it begins
  // after the oath, and that is where it begins.
  const { all, first } = opening();
  assert.equal(shape(all, { examinerIdentity:"nunez" })[1], "QUESTION:Q.",
    "with no boundary the legacy rule still produces the defect");
  const stated = run(all, { examinerIdentity:"nunez", examinations:[at(first, "nunez")] });
  assert.equal(stated.paragraphs[1].elementType, "COLLOQUY");
  assert.deepEqual(stated.examinations, [{ examinerPersonId:"nunez", type:"DIRECT", atWordId:first.wordId, implicit:false }],
    "one examination, anchored where the reporter put it -- not an implicit one plus a duplicate");
});

test("a boundary naming somebody else does not leave a phantom examination behind", () => {
  // FOUND BY A SURVIVING MUTATION. Removing the fence on the implicit direct looked harmless,
  // because when the boundary names the SAME examiner the implicit entry is replaced by it and the
  // sequence comes out identical. It is not harmless when they differ: the deposition's recorded
  // examiner is one attorney and the only boundary names another -- co-counsel taking the direct,
  // or a corrected examiner -- and the transcript grows a second EXAMINATION heading and a second
  // index entry for an examination that never happened.
  const { all, first } = opening();
  const result = run(all, { examinerIdentity:"nunez", examinations:[at(first, "zhan")] });
  assert.deepEqual(result.examinations.map(item => item.examinerPersonId), ["zhan"],
    "one examination, conducted by whoever the boundary names");
  assert.equal(result.paragraphs[1].elementType, "COLLOQUY", "and Nunez never starts examining at all");
});

test("a struck anchor cannot establish an examination", () => {
  const { all, first } = opening();
  const result = run(all, { examinerIdentity:"nunez", examinations:[at(first, "nunez")], deleted:[first.wordId] });
  assert.equal(result.examinationContext, EXAMINATION_CONTEXT.LEGACY_UNDERIVED,
    "a word that does not print cannot be where an examination visibly begins");
  assert.equal(result.examinations.every(item => item.atWordId !== first.wordId), true);
});

test("an examination is recorded once, however many boundaries name it", () => {
  const { all, first, answer } = opening();
  const again = { atWordId:answer.wordId, examinerPersonId:"nunez", type:"DIRECT" };
  const result = run(all, { examinerIdentity:"nunez", examinations:[at(first, "nunez"), again] });
  assert.equal(result.examinations.length, 1, "one heading, one BY-line, one index entry");
  assert.equal(result.examinations[0].atWordId, first.wordId, "and it stays at the first one");
});

// --- 12: the projection is recomputed, never accumulated ----------------------------------------

test("removing the boundary returns the transcript to exactly what it was without one", () => {
  // What Undo has to produce. The label is derived from the boundary list every time, so a state
  // that no longer holds the boundary must render as though it never did -- not as a transcript
  // carrying a residue of one.
  const { all, first } = opening();
  const before = shape(all, { examinerIdentity:"nunez" });
  const during = shape(all, { examinerIdentity:"nunez", examinations:[at(first, "nunez")] });
  const after = shape(all, { examinerIdentity:"nunez", examinations:[] });
  assert.notDeepEqual(during, before, "the boundary must actually change something");
  assert.deepEqual(after, before, "and removing it must change it all the way back");
});

// --- the compatibility contract -----------------------------------------------------------------

test("a transcript with no boundary keeps its testimony, and says the context is underived", () => {
  // Every deposition already in the library is this case. Removing the legacy rule would silently
  // strip Q./A. from all of them; keeping it unlabelled would let a guess print as a fact.
  const { all, first } = opening();
  const result = run(all, { examinerIdentity:"nunez" });
  assert.equal(result.examinationContext, EXAMINATION_CONTEXT.LEGACY_UNDERIVED);
  assert.ok(result.paragraphs.some(item => item.elementType === "QUESTION"), "testimony is not lost");
  assert.equal(run(all, { examinerIdentity:"nunez", examinations:[at(first, "nunez")] }).examinationContext,
    EXAMINATION_CONTEXT.ESTABLISHED, "and a boundary is what changes the claim being made");
});

test("no oath attestation is consulted, because a recorded deposition was sworn years ago", () => {
  // The specimen contains the oath as spoken words and no attestation anywhere. Testimony must
  // still label. A rule that required the current reporter to attest an oath they did not
  // administer would refuse to transcribe the recordings this application exists for.
  const { all, first } = opening();
  const shaped = shape(all, { examinerIdentity:"nunez", examinations:[at(first, "nunez")] });
  assert.equal(shaped[6], "QUESTION:Q.");
  assert.equal(shaped[7], "ANSWER:A.");
});

test("a cross boundary does not suppress the direct examination before it", () => {
  // The narrowing that 18 failing tests forced. A boundary establishes where ITS examination
  // begins; a cross boundary says nothing whatever about the direct that preceded it, and reading
  // it as though it did stripped Q./A. from the entire first examination.
  const { all } = opening();
  const cross = say("zhan", "DEFENDING_ATTORNEY", "Just a few questions.");
  const options = { examinerIdentity:"nunez", examinations:[at(cross, "zhan", "CROSS")] };
  const shaped = shape([...all, cross], options);
  assert.equal(shaped[6], "QUESTION:Q.", "the direct examination still labels");
  assert.equal(shaped.at(-1), "QUESTION:Q.", "and so does the cross");
  assert.equal(run([...all, cross], options).examinationContext, EXAMINATION_CONTEXT.LEGACY_UNDERIVED,
    "but where direct began is still underived, and says so");
});
