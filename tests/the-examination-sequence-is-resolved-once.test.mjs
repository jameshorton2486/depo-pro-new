// Phase D1 of the Examination Model. See §246 in the audit ledger.
//
// Phase C moved examination authority as the transcript is walked, but kept the result to itself.
// Where `examinerIdentity` arrives null, `labelParagraphs` adopts the first questioning attorney it
// meets -- and nothing outside could learn who that was. Q./A. knew the examiner and the index did
// not, so an index entry for the first examination had no name to print.
//
// D1 closes that by returning the resolved sequence. It is an OUTPUT of the same walk, not a second
// computation of the same fact: the heading, the BY-line and the index entry all read this one
// list, so none of them can disagree with what the Q./A. rule actually did.
//
// The first examination stays implicit. A synthetic DIRECT boundary would be a stored fact standing
// in for a derivable one, and would force every existing deposition to acquire an overlay operation
// just to render what it already renders.
import assert from "node:assert/strict";
import test from "node:test";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/etminan-evidence.mjs";
import { labelParagraphs } from "../server/transcript-labels.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";
import { appendTransaction, emptyOverlay } from "../server/reporter-overlay.mjs";

const LABELS = { alvarez:"MR. ALVAREZ", whitfield:"MS. WHITFIELD", ramirez:"MS. RAMIREZ" };
let counter = 0;
const say = (id, role, text) => {
  const wordId = `job1:word:${++counter}`;
  return { id:`seg-${counter}`, speakerIdentity:id, transcriptRole:role, text, asrWordIds:[wordId], wordId };
};
const at = (paragraph, examinerPersonId, type) => ({ atWordId:paragraph.wordId, examinerPersonId, type });
const resolve = (paragraphs, options = {}) =>
  labelParagraphs(paragraphs, { labels:LABELS, ...options }).examinations;
const brief = sequence => sequence.map(item => `${item.type}:${item.examinerPersonId}${item.implicit ? ":implicit" : ""}`);

// --- the implicit first examination ------------------------------------------------------------

test("an explicit initial examiner opens an implicit DIRECT carrying no anchor", () => {
  const sequence = resolve([say("alvarez", "QUESTIONING_ATTORNEY", "Where were you going?")], { examinerIdentity:"alvarez" });
  assert.deepEqual(sequence, [{ examinerPersonId:"alvarez", type:"DIRECT", atWordId:null, implicit:true }]);
});

test("a null initial examiner resolves to the attorney actually adopted", () => {
  // The readiness gap, closed. Before D1 the walk adopted Mr. Alvarez, emitted Q. for him, and
  // reported nothing -- so an index would have had to name an examiner it could not see.
  const opening = say("videographer", "VIDEOGRAPHER", "We are on the record.");
  const first = say("alvarez", "QUESTIONING_ATTORNEY", "Please state your name.");
  const sequence = resolve([opening, first], { examinerIdentity:null });
  assert.deepEqual(sequence, [{ examinerPersonId:"alvarez", type:"DIRECT", atWordId:null, implicit:true }]);
});

test("the resolved identity is the canonical participant id, not a diarization number", () => {
  const first = { ...say("alvarez", "QUESTIONING_ATTORNEY", "Please state your name."), deepgramSpeaker:2 };
  const [examination] = resolve([first], { examinerIdentity:null });
  assert.equal(examination.examinerPersonId, "alvarez");
  assert.notEqual(examination.examinerPersonId, 2, "a speaker index is not a person");
});

test("a transcript where no examiner is ever established reports no examination", () => {
  // Emit nothing rather than an examination nobody can name. The index would have to print
  // "Examination by" somebody, and inventing that is exactly what the boundary operation refuses.
  const sequence = resolve([
    say("videographer", "VIDEOGRAPHER", "We are on the record."),
    say("reporter", "COURT_REPORTER", "Would counsel state appearances?"),
  ], { examinerIdentity:null });
  assert.deepEqual(sequence, []);
});

test("an initial examiner that is only whitespace names nobody either", () => {
  // The same rule applied to the other way an examiner enters: the caller's `examinerIdentity`.
  // A whitespace id is truthy, so without the trim it opens an examination whose examiner prints
  // as nothing -- and the index would carry a blank "Examination by" line.
  for (const nobody of ["   ", "", null, undefined]) {
    assert.deepEqual(resolve([say("videographer", "VIDEOGRAPHER", "We are on the record.")], { examinerIdentity:nobody }), [],
      `examinerIdentity ${JSON.stringify(nobody)} must not open an examination`);
  }
});

test("no boundaries means exactly one examination, and no overlay operation exists for it", () => {
  const overlay = emptyOverlay("DEP-TEST");
  assert.equal(overlay.operations.length, 0, "nothing is stored for the implicit first examination");
  const rendered = renderTranscript({ working:WORKING, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley", overlay });
  assert.deepEqual(rendered.examinations, [{ examinerPersonId:"counsel-bentley", type:"DIRECT", atWordId:null, implicit:true }]);
});

// --- the explicit sequence ---------------------------------------------------------------------

test("a cross boundary appends to the implicit direct rather than replacing it", () => {
  const direct = say("alvarez", "QUESTIONING_ATTORNEY", "Where were you going?");
  const cross = say("whitfield", "QUESTIONING_ATTORNEY", "Did you see the vehicle?");
  const sequence = resolve([direct, cross], { examinerIdentity:"alvarez", examinations:[at(cross, "whitfield", "CROSS")] });
  assert.deepEqual(brief(sequence), ["DIRECT:alvarez:implicit", "CROSS:whitfield"]);
  assert.equal(sequence[1].atWordId, cross.wordId, "the explicit entry keeps its anchor");
  assert.equal(sequence[1].implicit, false);
});

test("direct, cross and redirect resolve to three examinations in transcript order", () => {
  const direct = say("alvarez", "QUESTIONING_ATTORNEY", "Where were you going?");
  const cross = say("whitfield", "QUESTIONING_ATTORNEY", "Did you see the vehicle?");
  const redirect = say("alvarez", "QUESTIONING_ATTORNEY", "Briefly, on redirect.");
  assert.deepEqual(brief(resolve([direct, cross, redirect], {
    examinerIdentity:"alvarez",
    examinations:[at(cross, "whitfield", "CROSS"), at(redirect, "alvarez", "REDIRECT")],
  })), ["DIRECT:alvarez:implicit", "CROSS:whitfield", "REDIRECT:alvarez"]);
});

test("a recross by the attorney who already crossed is still its own examination", () => {
  // Keyed on examiner AND type. On examiner alone the recross would vanish, because the labeller
  // correctly treats it as no change to who is asking -- and a missing examination is a missing
  // heading and a missing index line.
  const direct = say("alvarez", "QUESTIONING_ATTORNEY", "Where were you going?");
  const cross = say("whitfield", "QUESTIONING_ATTORNEY", "Did you see the vehicle?");
  const redirect = say("alvarez", "QUESTIONING_ATTORNEY", "Briefly, on redirect.");
  const recross = say("whitfield", "QUESTIONING_ATTORNEY", "One more thing.");
  assert.deepEqual(brief(resolve([direct, cross, redirect, recross], {
    examinerIdentity:"alvarez",
    examinations:[at(cross, "whitfield", "CROSS"), at(redirect, "alvarez", "REDIRECT"), at(recross, "whitfield", "RECROSS")],
  })), ["DIRECT:alvarez:implicit", "CROSS:whitfield", "REDIRECT:alvarez", "RECROSS:whitfield"]);
});

test("boundaries marked out of order still resolve in transcript order", () => {
  const direct = say("alvarez", "QUESTIONING_ATTORNEY", "Where were you going?");
  const cross = say("whitfield", "QUESTIONING_ATTORNEY", "Did you see the vehicle?");
  const redirect = say("alvarez", "QUESTIONING_ATTORNEY", "Briefly, on redirect.");
  const rendered = order => resolve([direct, cross, redirect], { examinerIdentity:"alvarez", examinations:order });
  const forwards = [at(cross, "whitfield", "CROSS"), at(redirect, "alvarez", "REDIRECT")];
  assert.deepEqual(brief(rendered([...forwards].reverse())), brief(rendered(forwards)),
    "the reporter who marks the redirect first has described the same proceeding");
});

test("a boundary restating the examiner already examining adds no second examination", () => {
  // It says nothing new about WHO is examining, and a duplicate entry would print a duplicate
  // heading and a duplicate index line. That is still the contract, and it still holds: one entry.
  //
  // What it does say something new about is WHERE. The implicit entry carries no anchor and places
  // itself at the examiner's first printing question; the reporter's boundary names a word. So the
  // explicit one now replaces the implicit one rather than being discarded as a duplicate.
  //
  // Found on Heath Thomas: the reporter marked the paragraph after the witness was sworn, the
  // boundary was dropped as redundant, and EXAMINATION / BY NUNEZ: stayed above the appearances.
  // The only control for correcting a wrong placement could not correct it.
  const direct = say("alvarez", "QUESTIONING_ATTORNEY", "Where were you going?");
  const resolved = resolve([direct], { examinerIdentity:"alvarez", examinations:[at(direct, "alvarez", "DIRECT")] });
  assert.equal(resolved.length, 1, "one examination, so one heading and one index line");
  assert.deepEqual(brief(resolved), ["DIRECT:alvarez"], "and it is the reporter's, not the derived one");
  assert.equal(resolved[0].atWordId, direct.wordId, "carrying the anchor the reporter chose");
});

test("a derived placement is kept when the reporter has not overridden it", () => {
  // The other half of the same rule, so the replacement above cannot be mistaken for "explicit
  // always wins even when there is no explicit". With no boundary marked, the entry stays implicit
  // and anchorless, and every existing deposition renders exactly as it did.
  const direct = say("alvarez", "QUESTIONING_ATTORNEY", "Where were you going?");
  const resolved = resolve([direct], { examinerIdentity:"alvarez" });
  assert.deepEqual(brief(resolved), ["DIRECT:alvarez:implicit"]);
  assert.equal(resolved[0].atWordId, null);
});

test("a boundary naming nobody is not recorded as an examination", () => {
  // `labelParagraphs` takes the boundary list directly, so the operation validator is not in the
  // path -- a caller can hand it an entry naming nobody. The index would have to print
  // "Examination by" somebody, so it is dropped rather than carried as a blank.
  const direct = say("alvarez", "QUESTIONING_ATTORNEY", "Where were you going?");
  const cross = say("whitfield", "QUESTIONING_ATTORNEY", "Did you see the vehicle?");
  for (const nobody of [null, "", "   ", undefined]) {
    const sequence = resolve([direct, cross], {
      examinerIdentity:"alvarez",
      examinations:[{ atWordId:cross.wordId, examinerPersonId:nobody, type:"CROSS" }],
    });
    assert.deepEqual(brief(sequence), ["DIRECT:alvarez:implicit"],
      `a boundary naming ${JSON.stringify(nobody)} must not reach the sequence`);
  }
});

test("consecutive examinations by the same attorney are two examinations, not one", () => {
  // The case the type key exists for. With dedup on examiner alone this recross disappears --
  // and a missing examination is a missing heading and a missing line on the index. The earlier
  // recross test did not catch it, because a redirect by the other attorney sat in between.
  const direct = say("alvarez", "QUESTIONING_ATTORNEY", "Where were you going?");
  const cross = say("whitfield", "QUESTIONING_ATTORNEY", "Did you see the vehicle?");
  const recross = say("whitfield", "QUESTIONING_ATTORNEY", "And one more thing.");
  assert.deepEqual(brief(resolve([direct, cross, recross], {
    examinerIdentity:"alvarez",
    examinations:[at(cross, "whitfield", "CROSS"), at(recross, "whitfield", "RECROSS")],
  })), ["DIRECT:alvarez:implicit", "CROSS:whitfield", "RECROSS:whitfield"]);
});

// --- through the render, and across a reload ---------------------------------------------------

const CROSS_WORD = WORKING.segments[7].asrWordIds[0];
const renderWith = overlay => renderTranscript({ working:WORKING, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley", overlay });

test("the rendered transcript carries the sequence, and it survives a reload", () => {
  const overlay = appendTransaction(emptyOverlay("DEP-TEST"), [{ op:"examination", atWordId:CROSS_WORD, examinerPersonId:"counsel-ramon", type:"CROSS" }]);
  const live = renderWith(overlay).examinations;
  assert.deepEqual(brief(live), ["DIRECT:counsel-bentley:implicit", "CROSS:counsel-ramon"]);
  const reloaded = renderWith(JSON.parse(JSON.stringify(overlay))).examinations;
  assert.deepEqual(reloaded, live, "reconstruction from the persisted record resolves identically");
});

test("the sequence agrees with the labelling it was resolved beside", () => {
  // The point of resolving once. If these could disagree, the index would name one examiner while
  // the transcript put Q. against another.
  const overlay = appendTransaction(emptyOverlay("DEP-TEST"), [{ op:"examination", atWordId:CROSS_WORD, examinerPersonId:"counsel-ramon", type:"CROSS" }]);
  const rendered = renderWith(overlay);
  const crossParagraph = rendered.paragraphs.find(item => (item.asrWordIds ?? []).includes(CROSS_WORD));
  assert.equal(crossParagraph.elementType, "QUESTION");
  assert.equal(crossParagraph.speakerIdentity, rendered.examinations.at(-1).examinerPersonId,
    "the person the index will name is the person whose paragraph became a question");
});

// --- nothing historical moves --------------------------------------------------------------------

test("an existing single-examiner deposition renders byte-identically", () => {
  // D1 must be invisible in the output. The sequence is new information about the same transcript,
  // not a change to it.
  const rendered = renderWith(emptyOverlay("DEP-TEST"));
  const plain = renderTranscript({ working:WORKING, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley", overlay:null });
  assert.deepEqual(rendered.paragraphs, plain.paragraphs);
  assert.equal(rendered.renderedContentHash, plain.renderedContentHash,
    "the rendered content hash is unchanged, so nothing downstream sees a different transcript");
});
