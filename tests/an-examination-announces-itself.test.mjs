// Phase D2 of the Examination Model. See §246 in the audit ledger.
//
// D1 resolved the examination sequence once. This is the first thing that prints from it: the
// heading that announces an examination and the BY-line that names who is conducting it.
//
// Both are reporter-derived structural content, not testimony. They carry no ASR word, no timing
// and no segment -- a heading is something the record's structure says, not something a microphone
// heard, and a borrowed timestamp would let a click seek audio to a line nobody spoke.
//
// The implicit first examination is anchored to its first rendered question, so it receives the
// same structural treatment without storing a redundant synthetic boundary.
import assert from "node:assert/strict";
import test from "node:test";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/etminan-evidence.mjs";
import { WORKING as LONG, EVIDENCE as LONG_EVIDENCE, SPEAKER_CANDIDATES as LONG_SPEAKERS } from "./fixtures/long-deposition.mjs";
import { EXAMINATION_HEADINGS } from "../server/transcript-labels.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";
import { buildTranscriptPrintModel } from "../server/transcript-print-model.mjs";
import { appendTransaction, emptyOverlay } from "../server/reporter-overlay.mjs";

const CROSS_WORD = WORKING.segments[7].asrWordIds[0];
const REDIRECT_WORD = WORKING.segments[9].asrWordIds[0];
const boundary = (atWordId, examinerPersonId, type) => ({ op:"examination", atWordId, examinerPersonId, type });
const overlayOf = (...operations) => operations.reduce((overlay, operation) => appendTransaction(overlay, [operation]), emptyOverlay("DEP-TEST"));
const render = overlay => renderTranscript({ working:WORKING, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley", overlay });
const structural = result => result.paragraphs.filter(item => item.derived).map(item => `${item.elementType}:${item.text}`);

// --- the heading and the BY-line ---------------------------------------------------------------

test("a cross-examination announces itself once, and names who is conducting it", () => {
  const result = render(overlayOf(boundary(CROSS_WORD, "counsel-ramon", "CROSS")));
  assert.deepEqual(structural(result), ["HEADING:EXAMINATION", "BY_LINE:BY MR. BENTLEY:", "HEADING:CROSS-EXAMINATION", "BY_LINE:BY MR. RAMON:"]);
});

test("the heading sits immediately before the examination it announces", () => {
  const result = render(overlayOf(boundary(CROSS_WORD, "counsel-ramon", "CROSS")));
  const headingAt = result.paragraphs.findIndex(item => item.text === "CROSS-EXAMINATION");
  assert.equal(result.paragraphs[headingAt + 1].elementType, "BY_LINE");
  const first = result.paragraphs[headingAt + 2];
  assert.ok((first.asrWordIds ?? []).includes(CROSS_WORD), "the anchored paragraph follows the by-line");
  assert.equal(first.elementType, "QUESTION", "and it is the new examiner's question");
});

test("redirect and recross carry their own headings", () => {
  const result = render(overlayOf(
    boundary(CROSS_WORD, "counsel-ramon", "CROSS"),
    boundary(REDIRECT_WORD, "counsel-bentley", "REDIRECT"),
  ));
  assert.deepEqual(structural(result), [
    "HEADING:EXAMINATION", "BY_LINE:BY MR. BENTLEY:",
    "HEADING:CROSS-EXAMINATION", "BY_LINE:BY MR. RAMON:",
    "HEADING:REDIRECT EXAMINATION", "BY_LINE:BY MR. BENTLEY:",
  ]);
});

test("every examination uses the qualified freelance-deposition heading", () => {
  assert.deepEqual(EXAMINATION_HEADINGS, { DIRECT:"EXAMINATION", CROSS:"CROSS-EXAMINATION", REDIRECT:"REDIRECT EXAMINATION", RECROSS:"RECROSS-EXAMINATION" });
});

test("the BY-line uses the canonical display name, not the raw identity", () => {
  const result = render(overlayOf(boundary(CROSS_WORD, "counsel-ramon", "CROSS")));
  const byLine = result.paragraphs.find(item => item.text === "BY MR. RAMON:");
  assert.equal(byLine.text, `BY ${result.labels["counsel-ramon"]}:`,
    "one name formatter, the one that already refuses to guess an honorific");
  assert.doesNotMatch(byLine.text, /counsel-ramon/, "the canonical id is never printed");
});

test("an examiner with no label gets the heading and no blank BY-line", () => {
  // buildSpeakerLabels already falls back to a surname and raises HONORIFIC_MISSING rather than
  // guessing. An examiner it cannot name at all would otherwise print "BY :" on a certified page.
  const result = renderTranscript({ working:WORKING, evidence:[EVIDENCE], speakerCandidates:[], examinerIdentity:"counsel-bentley",
    overlay:overlayOf(boundary(CROSS_WORD, "counsel-ramon", "CROSS")) });
  assert.deepEqual(structural(result), ["HEADING:EXAMINATION", "HEADING:CROSS-EXAMINATION"]);
  assert.ok(result.findings.some(finding => finding.code === "EXAMINATION_EXAMINER_UNLABELLED"),
    "and the reporter is told why the by-line is absent");
});

// --- structural, not testimony -------------------------------------------------------------------

test("a heading carries no word, no segment and no borrowed timing", () => {
  const result = render(overlayOf(boundary(CROSS_WORD, "counsel-ramon", "CROSS")));
  for (const row of result.paragraphs.filter(item => item.derived)) {
    assert.deepEqual(row.asrWordIds, [], "no ASR word is claimed");
    assert.deepEqual(row.segmentIds, []);
    assert.deepEqual(row.words, []);
    assert.equal(row.start, null, "a click must not seek audio to a line nobody spoke");
    assert.equal(row.end, null);
    assert.equal(row.speakerIdentity, null, "nobody speaks a heading");
  }
});

test("the anchor word is untouched and still reads as it did", () => {
  const plain = render(emptyOverlay("DEP-TEST"));
  const marked = render(overlayOf(boundary(CROSS_WORD, "counsel-ramon", "CROSS")));
  const wordsOf = result => result.paragraphs.flatMap(item => item.words).map(word => ({ id:word.id, text:word.text, start:word.start }));
  assert.deepEqual(wordsOf(marked), wordsOf(plain),
    "every word, its text and its timing survive the heading untouched");
});

test("Phase C labelling is unchanged, and objections stay colloquy", () => {
  const result = render(overlayOf(boundary(CROSS_WORD, "counsel-ramon", "CROSS")));
  const spoken = result.paragraphs.filter(item => !item.derived);
  const plain = render(overlayOf()).paragraphs.filter(item => !item.derived);
  assert.equal(spoken.length, plain.length, "no spoken paragraph was added or lost");
  const cross = spoken.find(item => (item.asrWordIds ?? []).includes(CROSS_WORD));
  assert.equal(cross.elementType, "QUESTION");
  assert.ok(spoken.some(item => item.elementType === "COLLOQUY"), "colloquy still exists in the transcript");
});

// --- nothing changes without a handover ----------------------------------------------------------

test("a single-examiner deposition begins with EXAMINATION and the canonical attorney by-line", () => {
  const result = render(emptyOverlay("DEP-TEST"));
  assert.deepEqual(structural(result), ["HEADING:EXAMINATION", "BY_LINE:BY MR. BENTLEY:"]);
  const plain = renderTranscript({ working:WORKING, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley", overlay:null });
  assert.deepEqual(result.paragraphs, plain.paragraphs, "the existing qualified output is untouched");
});

test("a single-examiner deposition raises no examination finding either", () => {
  // Not just an empty heading list. The implicit examination has no anchor, and code that tried to
  // place a heading for it would report the anchor as unrenderable -- a finding on the reporter's
  // screen about a transcript that is perfectly correct.
  const findings = render(emptyOverlay("DEP-TEST")).findings.filter(finding => finding.code?.startsWith("EXAMINATION_"));
  assert.deepEqual(findings, []);
});

test("a reload produces the identical document", () => {
  const overlay = overlayOf(boundary(CROSS_WORD, "counsel-ramon", "CROSS"), boundary(REDIRECT_WORD, "counsel-bentley", "REDIRECT"));
  assert.deepEqual(render(JSON.parse(JSON.stringify(overlay))).paragraphs, render(overlay).paragraphs);
});

// --- repagination --------------------------------------------------------------------------------

test("the added structural lines flow through pagination like any other line", () => {
  // Two extra lines on a 25-line page must push the body, not overlay it or be dropped. Measured
  // on the realistic deposition rather than asserted.
  const crossAt = LONG.segments.find(segment => segment.speakerIdentity === "counsel-whitfield").asrWordIds[0];
  const build = overlay => {
    const rendered = renderTranscript({ working:LONG, evidence:Array.isArray(LONG_EVIDENCE) ? LONG_EVIDENCE : [LONG_EVIDENCE],
      speakerCandidates:LONG_SPEAKERS ?? [], examinerIdentity:"counsel-alvarez", overlay });
    return { rendered, model:buildTranscriptPrintModel({ rendered, reviewStateHash:"d2", deposition:{ id:"DEP-D2" } }) };
  };
  const plain = build(emptyOverlay("DEP-D2"));
  const marked = build(overlayOf({ op:"examination", atWordId:crossAt, examinerPersonId:"counsel-whitfield", type:"CROSS" }));

  // Not a line-count delta against the unmarked render. The same boundary also turns 450 colloquy
  // paragraphs into Q./A., and a "MS. WHITFIELD:" label wraps differently from "Q." -- measured,
  // the body gets 144 lines SHORTER. That is Phase C working, and folding it into a D2 assertion
  // would measure two things and prove neither.
  const linesOf = model => model.pages.flatMap(page => page.lines);
  const headingLines = linesOf(marked.model).filter(line => line.content?.includes("CROSS-EXAMINATION"));
  const byLines = linesOf(marked.model).filter(line => line.content?.includes("BY MS. WHITFIELD:"));
  assert.equal(headingLines.length, 1, "the heading reached exactly one printed line");
  assert.equal(byLines.length, 1, "and so did the by-line");
  assert.equal(linesOf(plain.model).filter(line => line.content?.includes("CROSS-EXAMINATION")).length, 0,
    "neither exists without the boundary");

  // 25-line fidelity survives the insertion. Every page carries a full slot count, occupied or not.
  const perPage = marked.model.layoutProfile.linesPerPage;
  assert.ok(marked.model.pages.every(page => page.lines.length === perPage),
    `every page still carries exactly ${perPage} line slots`);

  // And the heading is on the page where the cross begins, not somewhere else.
  const headingPage = marked.model.pages.find(page => page.lines.some(line => line.content?.includes("CROSS-EXAMINATION")));
  const anchorPage = marked.model.pages.find(page => page.lines.some(line => line.trace?.sourceWordIds?.includes(crossAt)));
  assert.ok(Math.abs(headingPage.pageNumber - anchorPage.pageNumber) <= 1,
    `the heading (page ${headingPage.pageNumber}) sits with the examination it announces (page ${anchorPage.pageNumber})`);
});
