// "Speaker 5" meant two different people on the same screen.
//
// Before the speaker map is reconciled, the Print Model substitutes a placeholder label so a reporter
// can tell voices apart by number. It numbered them 1, 2, 3... in order of first appearance. The
// Counsel Editor's speaker selector, three inches to the right, numbers the same voices by their raw
// Deepgram cluster index. Nothing said which was which, and both read "Speaker N".
//
// On Production Trial #1 that put Pablo Rivera on screen as "SPEAKER 5:" in the transcript while the
// selector correctly showed him as "Speaker 1 - 109 words". Deepgram cluster 5 is a different voice
// entirely: two words, "1 2nd.", still unidentified. The reporter read the transcript, read the
// selector, and concluded the application had assigned the wrong speaker. It had not.
//
// A number a reporter cannot carry from one control to another is worse than no number. So the
// placeholder now prints the cluster index -- the thing every other control already names.
//
// GENERIC: every deposition, before reconciliation. Which is every deposition.
import assert from "node:assert/strict";
import test from "node:test";
import { buildTranscriptPrintModel } from "../server/transcript-print-model.mjs";

const JOB = "job0000000000000000000000000000000000000000000000000000000000001";
const word = (id, text) => ({ id:`${JOB}:word:${id}`, text, authored:false, confidence:0.9, start:id, end:id + 1 });
const paragraph = (id, deepgramSpeaker, text, extra = {}) => ({
  id:`p${id}`, elementType:"COLLOQUY", label:null, byLine:null, speakerIdentity:null,
  deepgramSpeaker, sourceJobIdentity:JOB, words:[word(id, text)], asrWordIds:[`${JOB}:word:${id}`],
  segmentIds:[`${JOB}:segment:${id}`], text, start:id, end:id + 1, ...extra,
});
const model = paragraphs => buildTranscriptPrintModel({
  rendered:{ paragraphs, labels:{}, speakerMap:{ status:"unreconciled", assignments:[] }, counts:{} },
  reviewStateHash:"hash", deposition:{ id:"DEP-TEST" },
});
test("the placeholder prints the Deepgram cluster index, not a counter", () => {
  // Cluster 6 speaks first. Under the counter it printed "SPEAKER 1:", which named a cluster that
  // exists and is somebody else.
  const built = model([paragraph(1, 6, "Ruben Olvera for DTK."), paragraph(2, 1, "Pablo Rivera for plaintiff.")]);
  const labels = built.previewLabelled.map(item => item.label);
  assert.deepEqual(labels, ["SPEAKER 6:", "SPEAKER 1:"]);
});

test("the same cluster keeps the same number wherever it speaks", () => {
  const built = model([paragraph(1, 6, "First."), paragraph(2, 1, "Second."), paragraph(3, 6, "Third.")]);
  assert.deepEqual(built.previewLabelled.map(item => item.label), ["SPEAKER 6:", "SPEAKER 1:", "SPEAKER 6:"]);
});

test("cluster zero is numbered zero, not one", () => {
  // The off-by-one that made the two schemes look almost aligned and therefore harder to spot.
  const built = model([paragraph(1, 0, "I'm Mia, the court reporter.")]);
  assert.deepEqual(built.previewLabelled.map(item => item.label), ["SPEAKER 0:"]);
});

test("a paragraph with no cluster still says so rather than borrowing a number", () => {
  const built = model([paragraph(1, null, "Unattributed speech.")]);
  assert.deepEqual(built.previewLabelled.map(item => item.label), ["SPEAKER UNKNOWN:"]);
});

test("structural content gets no speaker at all", () => {
  // A heading is the reporter's record, not speech. Giving it a fallback once printed
  // "SPEAKER UNKNOWN:BY MS. WHITFIELD:" into a Word document.
  const built = model([paragraph(1, 6, "CROSS-EXAMINATION", { derived:true, elementType:"HEADING" }), paragraph(2, 1, "Spoken.")]);
  assert.deepEqual(built.previewLabelled.map(item => item.label), ["SPEAKER 1:"], "only the spoken paragraph");
});

test("a paragraph that already has a label is left alone", () => {
  const built = model([paragraph(1, 6, "Answer.", { label:"A." }), paragraph(2, 1, "Unlabelled.")]);
  assert.deepEqual(built.previewLabelled.map(item => item.label), ["SPEAKER 1:"]);
});

test("every substitution is still marked, so a certified page still refuses", () => {
  // The whole point of previewLabel. Changing the number must not change what it means.
  const built = model([paragraph(1, 6, "One."), paragraph(2, 1, "Two.")]);
  assert.equal(built.previewLabelled.length, 2);
  for (const item of built.previewLabelled) {
    assert.equal(typeof item.deepgramSpeaker, "number");
    assert.equal(item.speakerIdentity, null);
  }
});

test("two jobs sharing a cluster index are told apart", () => {
  // Without this the number stops being unique the moment a deposition has two recordings, which is
  // the ambiguity the counter was avoiding. It is disambiguated rather than renumbered, so the
  // cluster index a reporter reads in the selector is still the one they read here.
  const OTHER = "job0000000000000000000000000000000000000000000000000000000000002";
  const built = model([
    paragraph(1, 0, "First recording."),
    { ...paragraph(2, 0, "Second recording."), sourceJobIdentity:OTHER,
      words:[{ ...word(2, "Second recording."), id:`${OTHER}:word:2` }], asrWordIds:[`${OTHER}:word:2`] },
  ]);
  const labels = built.previewLabelled.map(item => item.label);
  assert.equal(new Set(labels).size, 2, `two different voices must not share a label: ${labels.join(", ")}`);
  for (const label of labels) assert.match(label, /^SPEAKER 0\b/, "and both still carry the cluster index they were given");
});
