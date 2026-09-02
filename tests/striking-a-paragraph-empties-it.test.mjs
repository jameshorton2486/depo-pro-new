// Struck testimony must not come back on the printed page.
//
// Found while wiring a "strike this paragraph" control, in shipped code reachable by one click on
// an existing one. `renderTranscript` rebuilt each paragraph's text from the words it now holds and
// then wrote `text: rebuilt || segment.text`. Strike the only word of a paragraph and `rebuilt` is
// legitimately "" -- which is falsy, so the fallback restored the stored utterance text.
//
// The word was then absent from `words` and present in `text`, and the printed page is built from
// the TEXT: shared-document-model walks the words to find token boundaries inside the text, finds
// none, and emits the whole remaining string as a generated run. So `SPEAKER 3: Alrighty.` printed
// in full with its only word struck.
//
// The fallback still earns its place -- two segments in Production Trial #1 and one in Heath Thomas
// carry text with no word ids at all. Struck-to-empty and nothing-to-build-from are different
// states, and telling them apart is the whole fix.
import assert from "node:assert/strict";
import test from "node:test";
import { emptyOverlay } from "../server/reporter-overlay.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";

const JOB = "job";
const w = n => `${JOB}:word:${n}`;
const word = (n, text) => ({ id: w(n), word: text, punctuatedWord: text, start: n, end: n + 0.4, confidence: 0.9, deepgramSpeaker: 0, speakerConfidence: 0.9 });
const EVIDENCE = { jobIdentity: JOB, words: [word(1, "Alrighty."), word(2, "Good"), word(3, "morning.")] };

const WORKING = {
  schemaVersion: "1.1.0", transcript_hash: "h", derivedFrom: [JOB], depositionId: "DEP-TEST",
  speakerMap: { status: "reconciled", assignments: [] },
  segments: [
    { id: "s1", sourceJobIdentity: JOB, asrWordIds: [w(1)], text: "Alrighty.", deepgramSpeaker: 0, speakerIdentity: "witness", transcriptRole: "WITNESS", start: 1, end: 2 },
    { id: "s2", sourceJobIdentity: JOB, asrWordIds: [w(2), w(3)], text: "Good morning.", deepgramSpeaker: 1, speakerIdentity: "attorney-1", transcriptRole: "QUESTIONING_ATTORNEY", start: 2, end: 4 },
  ],
};
// Different speakers, because consecutive segments sharing one are grouped into a single paragraph
// and the point here is what happens to a paragraph of its own.
const CANDIDATES = [{ id: "witness", label: "Jennifer Baier", defaultRole: "WITNESS" }, { id: "attorney-1", label: "Ruben Olvera", defaultRole: "QUESTIONING_ATTORNEY" }];
const render = operations => renderTranscript({
  working: WORKING, evidence: [EVIDENCE], speakerCandidates: CANDIDATES, examinerIdentity: null,
  overlay: { ...emptyOverlay("DEP-TEST"), operations },
});
const find = (result, id) => result.paragraphs.find(p => (p.asrWordIds ?? []).includes(id));

test("striking every word of a paragraph leaves no text behind", () => {
  const before = find(render([]), w(1));
  assert.equal(before.text, "Alrighty.", "the fixture must start with text for this to prove anything");

  const after = find(render([{ op: "delete", wordId: w(1) }]), w(1));
  assert.equal(after.text, "", "the struck word is gone from the text, not only from the words");
  assert.equal(after.words.filter(item => !item.deleted).length, 0);
  // The printed page is built from the text. Text surviving here is text on a certified transcript.
  assert.equal(/Alrighty/.test(after.text), false);
});

test("striking one word of several leaves the rest", () => {
  const after = find(render([{ op: "delete", wordId: w(2) }]), w(3));
  assert.equal(after.text, "morning.");
});

test("a segment that never had words keeps its own text", () => {
  // The case the fallback exists for: two segments in Production Trial #1 and one in Heath Thomas
  // carry text with no word ids. Nothing can be rebuilt for them, and emptying them would delete
  // testimony that was never struck.
  const working = { ...WORKING, segments: [
    { id: "s0", sourceJobIdentity: JOB, asrWordIds: [], text: "Off the record discussion.", deepgramSpeaker: 2, speakerIdentity: "attorney-1", transcriptRole: "QUESTIONING_ATTORNEY", start: 0, end: 1 },
    ...WORKING.segments,
  ] };
  const result = renderTranscript({ working, evidence: [EVIDENCE], speakerCandidates: CANDIDATES, examinerIdentity: null, overlay: emptyOverlay("DEP-TEST") });
  assert.ok(result.paragraphs.some(p => p.text === "Off the record discussion."),
    "nothing to rebuild from is not the same state as everything struck");
});

test("a struck paragraph carries no words for the document model to lay out", () => {
  // shared-document-model finds token boundaries by searching the paragraph text for each word. No
  // words and a non-empty text is exactly the shape that emitted the struck string as a generated
  // run, so both halves are asserted together.
  const after = find(render([{ op: "delete", wordId: w(1) }]), w(1));
  const laidOut = (after.words ?? []).filter(item => !item.deleted);
  assert.equal(laidOut.length, 0);
  assert.equal(after.text.length, 0, "no words and no text -- the pair that used to disagree");
});
