// Phase D3 of the Examination Model. See §246 and §122 in the audit ledger.
//
// §122 refused to place more than one examination, and said why: "nothing here knows where one
// examination ends and the next begins." That was true. The overlay now carries boundaries (D1),
// the transcript announces them (D2), and every printed line carries a trace naming the words
// behind it -- so an examination's page is a lookup in the paginator's own output.
//
// Nothing is supplied and nothing is stored. §122's refusal of caller-supplied page numbers stays
// exactly as it was, and is asserted here rather than assumed: the whole reason that refusal exists
// is that a supplied "4-5" once printed on the index of a body running to 216.
import assert from "node:assert/strict";
import test from "node:test";
import { WORKING as LONG, EVIDENCE as LONG_EVIDENCE, SPEAKER_CANDIDATES as LONG_SPEAKERS } from "./fixtures/long-deposition.mjs";
import { completePagination } from "../server/complete-transcript-model.mjs";
import { EXAMINATION_INDEX_LABELS } from "../server/transcript-labels.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";
import { buildTranscriptPrintModel } from "../server/transcript-print-model.mjs";
import { appendTransaction, emptyOverlay } from "../server/reporter-overlay.mjs";

const RECORD = { counsel:[
  { id:"counsel-alvarez", fullName:{ value:"Ana Alvarez" }, honorific:{ value:"Ms." } },
  { id:"counsel-whitfield", fullName:{ value:"Grace Whitfield" }, honorific:{ value:"Ms." } },
  { id:"counsel-ramirez", fullName:{ value:"Luis Ramirez" }, honorific:{ value:"Mr." } },
] };
const exam = (examinerPersonId, type, testimonyPage, implicit = false) => ({ examinerPersonId, type, testimonyPage, implicit, atWordId:implicit ? null : `w${testimonyPage}` });
const place = (resolvedExaminations, extra = {}) => completePagination({
  testimonyPages:200, signatureDisposition:"waived", frontPages:3, record:RECORD, resolvedExaminations, ...extra,
}).index.examinations;
const cite = entries => entries.map(entry => `${entry.examiner} ${entry.startPage}-${entry.endPage}`);

// --- ranges come from the paginator ------------------------------------------------------------

test("a single implicit examination leaves the existing path untouched", () => {
  // No handover, no override. Every deposition that renders today keeps citing the examiner the
  // reporter chose in Prepare, rather than a second answer derived from the same record.
  const entries = place([exam("counsel-alvarez", "DIRECT", 1, true)], { examiner:"Ms. Ana Alvarez" });
  assert.deepEqual(cite(entries), ["Ms. Ana Alvarez 4-203"], "testimony spans pages 4 through 203 behind three front pages");
});

test("direct and cross each cite the pages they actually occupy", () => {
  assert.deepEqual(cite(place([
    exam("counsel-alvarez", "DIRECT", 1, true),
    exam("counsel-whitfield", "CROSS", 135),
  ])), ["Ms. Ana Alvarez 4-137", "Ms. Grace Whitfield 138-203"]);
});

test("direct, cross and redirect divide the testimony between them", () => {
  assert.deepEqual(cite(place([
    exam("counsel-alvarez", "DIRECT", 1, true),
    exam("counsel-whitfield", "CROSS", 100),
    exam("counsel-alvarez", "REDIRECT", 150),
  ])), ["Ms. Ana Alvarez 4-102", "Ms. Grace Whitfield 103-152", "Ms. Ana Alvarez 153-203"]);
});

test("a recross takes the tail", () => {
  const entries = place([
    exam("counsel-alvarez", "DIRECT", 1, true),
    exam("counsel-whitfield", "CROSS", 100),
    exam("counsel-alvarez", "REDIRECT", 150),
    exam("counsel-whitfield", "RECROSS", 180),
  ]);
  assert.deepEqual(cite(entries).at(-1), "Ms. Grace Whitfield 183-203");
  assert.equal(entries.at(-1).endPage, 203, "the last examination runs to the end of testimony");
});

test("two examinations beginning on one page do not cite a range that runs backwards", () => {
  const entries = place([
    exam("counsel-alvarez", "DIRECT", 1, true),
    exam("counsel-whitfield", "CROSS", 50),
    exam("counsel-alvarez", "REDIRECT", 50),
  ]);
  for (const entry of entries) assert.ok(entry.endPage >= entry.startPage, `${entry.examiner} ${entry.startPage}-${entry.endPage}`);
});

test("the index names the examiner the transcript adopted when none was chosen", () => {
  // The D1 gap, all the way through to the printed index. With no examinerIdentity supplied, the
  // walk adopts the first questioning attorney; that identity is what the index now prints.
  const entries = place([
    exam("counsel-alvarez", "DIRECT", 1, true),
    exam("counsel-whitfield", "CROSS", 120),
  ], { examiner:null });
  assert.equal(entries[0].examiner, "Ms. Ana Alvarez", "no COMPLETE_TRANSCRIPT_EXAMINER_REQUIRED, and no blank");
});

test("an examination naming counsel the record no longer has is refused, not printed", () => {
  assert.throws(() => place([
    exam("counsel-alvarez", "DIRECT", 1, true),
    exam("counsel-departed", "CROSS", 100),
  ]), /COMPLETE_TRANSCRIPT_EXAMINER_UNRESOLVED/);
});

test("an examination the transcript could not place is refused rather than cited", () => {
  assert.throws(() => place([
    exam("counsel-alvarez", "DIRECT", 1, true),
    { examinerPersonId:"counsel-whitfield", type:"CROSS", testimonyPage:null, implicit:false, atWordId:"w1" },
  ]), /COMPLETE_TRANSCRIPT_EXAMINATION_PAGE_UNRESOLVED/);
});

// --- which page an examination begins on -------------------------------------------------------

// K one-line paragraphs and then the handover, so the line the heading lands on is chosen rather
// than searched for. The paginator is a flat 25-line chop with no keep-together rule, so a heading
// CAN be left at the foot of a page while its first question starts the next one -- 90 insert sizes
// on the realistic fixture never happened to produce one, which is precisely why it is built here.
function synthetic(paragraphsBeforeHandover, type = "CROSS") {
  const segments = [], words = [];
  const add = (index, speakerIdentity, transcriptRole, text) => {
    const id = `j:word:${index}`;
    words.push({ id, word:text, punctuatedWord:text, start:index, end:index + 0.5, confidence:0.99, deepgramSpeaker:1 });
    segments.push({ id:`j:segment:${index}`, sourceJobIdentity:"j", sourceUploadId:"u", sourceOrdinal:0,
      asrWordIds:[id], text, deepgramSpeaker:1, speakerIdentity, transcriptRole, start:index, end:index + 0.5 });
  };
  for (let index = 1; index <= paragraphsBeforeHandover; index += 1)
    add(index, index % 2 ? "a" : "w", index % 2 ? "QUESTIONING_ATTORNEY" : "WITNESS", index % 2 ? "Question" : "Answer");
  const crossAt = `j:word:${paragraphsBeforeHandover + 1}`;
  add(paragraphsBeforeHandover + 1, "b", "QUESTIONING_ATTORNEY", "Crossing");
  const overlay = appendTransaction(emptyOverlay("SYN"), [{ op:"examination", atWordId:crossAt, examinerPersonId:"b", type }]);
  const rendered = renderTranscript({
    working:{ schemaVersion:"1.1.0", recordType:"WORKING_TRANSCRIPT", derivedFrom:["j"], speakerMap:null, segments },
    evidence:[{ schemaVersion:"1.1.0", recordType:"CANONICAL_ASR_EVIDENCE", jobIdentity:"j", words }],
    speakerCandidates:[
      { id:"a", label:"Ann Alpha", defaultRole:"QUESTIONING_ATTORNEY", honorific:"Ms." },
      { id:"b", label:"Bo Beta", defaultRole:"QUESTIONING_ATTORNEY", honorific:"Mr." },
      { id:"w", label:"Wit Ness", defaultRole:"WITNESS" }],
    examinerIdentity:"a", overlay });
  const model = buildTranscriptPrintModel({ rendered, reviewStateHash:"syn", deposition:{ id:"SYN" } });
  const pageOf = predicate => model.pages.find(page => page.lines.some(predicate))?.pageNumber ?? null;
  return { model,
    headingPage:pageOf(line => line.paragraphId === `examination:${type}:${crossAt}`),
    firstQuestionPage:pageOf(line => line.trace?.sourceWordIds?.includes(crossAt)),
    cross:model.examinations.find(item => item.type === type && !item.implicit),
    direct:model.examinations.find(item => item.implicit) };
}

test("with the heading, by-line and first question on one page, the index cites that page", () => {
  const laid = synthetic(21);
  assert.equal(laid.headingPage, 1);
  assert.equal(laid.firstQuestionPage, 1, "nothing straddles here");
  assert.equal(laid.cross.testimonyPage, 1);
});

test("an examination begins where its heading prints, even when its first question is overleaf", () => {
  // The rule, made falsifiable. At 23 preceding paragraphs the heading takes line 24 and the
  // by-line line 25, so the first Q. opens the next page; at 24 the heading itself takes line 25.
  // In both the examination begins where the reader sees it announced.
  for (const before of [23, 24]) {
    const laid = synthetic(before);
    assert.equal(laid.firstQuestionPage, laid.headingPage + 1, `${before}: the transition must straddle for this to prove anything`);
    assert.equal(laid.cross.testimonyPage, laid.headingPage,
      `${before}: the index cites the page carrying CROSS-EXAMINATION, not the page carrying the first question`);
  }
});

test("an examination with no heading falls back to where its testimony begins", () => {
  // Reachable, and this is the case that reaches it: a reporter may mark a second DIRECT -- another
  // attorney taking the witness on direct rather than on cross -- and DIRECT has no heading form,
  // so there is no heading paragraph to find. It is not implicit either, so page 1 is wrong. The
  // fallback reads the first traced word of the examination, which is where it begins.
  const laid = synthetic(23, "DIRECT");
  assert.equal(laid.headingPage, null, "no heading is printed for a direct examination");
  assert.equal(laid.cross.testimonyPage, laid.firstQuestionPage,
    "so the index cites the page its first question prints on");
});

test("the implicit first examination begins on the first page of testimony", () => {
  // Absolute, not merely equal to itself across two builds. It has no anchor and no heading, so
  // page 1 is a definition rather than a lookup -- and a definition nothing asserts is a default.
  assert.equal(synthetic(21).direct.testimonyPage, 1);
});

// --- how each examination is named ---------------------------------------------------------------

test("each examination type names itself on the index", () => {
  const entries = place([
    exam("counsel-alvarez", "DIRECT", 1, true),
    exam("counsel-whitfield", "CROSS", 60),
    exam("counsel-alvarez", "REDIRECT", 120),
    exam("counsel-whitfield", "RECROSS", 170),
  ]);
  assert.deepEqual(entries.map(entry => `${entry.examinationLabel} by ${entry.examiner}`), [
    "Examination by Ms. Ana Alvarez",
    "Cross-Examination by Ms. Grace Whitfield",
    "Redirect Examination by Ms. Ana Alvarez",
    "Recross-Examination by Ms. Grace Whitfield",
  ]);
  // And the pages are still the paginator's, not something the naming changed.
  assert.deepEqual(entries.map(entry => `${entry.startPage}-${entry.endPage}`), ["4-62", "63-122", "123-172", "173-203"]);
});

test("a deposition's first examination is Examination, not Direct Examination", () => {
  // Settled on the source, not chosen. F-09 measures UFM Figures 14 and 15 as identical but for one
  // line: the trial record heads DIRECT EXAMINATION and the freelance deposition heads EXAMINATION.
  // The certified specimen agrees -- thomas-regression's real index entry reads "Examination by
  // Mr. Nunez". This application produces freelance depositions.
  assert.equal(EXAMINATION_INDEX_LABELS.DIRECT, "Examination");
  assert.notEqual(EXAMINATION_INDEX_LABELS.DIRECT, "Direct Examination");
  assert.deepEqual(Object.keys(EXAMINATION_INDEX_LABELS).sort(), ["CROSS", "DIRECT", "RECROSS", "REDIRECT"]);
});

test("an untyped examination keeps the certified specimen's wording", () => {
  // The single-examiner path supplies no type, and its line must not change: this is the form a
  // real certified transcript uses.
  const [entry] = place([exam("counsel-alvarez", "DIRECT", 1, true)], { examiner:"Ms. Ana Alvarez" });
  assert.equal(entry.examinationLabel, undefined, "the legacy path carries no label");
});

test("the longest typed index line still fits the certified page width", () => {
  // "Recross-Examination by " is 23 characters before the name. A line that overflows 63 characters
  // is a blocking finding at assembly, so the naming decision has to be checked against the
  // geometry rather than assumed to fit.
  const entries = place([exam("counsel-alvarez", "DIRECT", 1, true), exam("counsel-whitfield", "RECROSS", 170)]);
  const rendered = entries.map(entry => `  ${entry.examinationLabel ?? "Examination"} by ${entry.examiner}........... ${entry.startPage}-${entry.endPage}`);
  for (const line of rendered) assert.ok(line.length <= 63, `${line.length} characters: ${line}`);
});

// --- §122's refusals are untouched ---------------------------------------------------------------

test("a caller-supplied page number is still refused outright", () => {
  assert.throws(() => completePagination({ testimonyPages:200, signatureDisposition:"waived", frontPages:3,
    examinations:[{ examiner:"Ms. Ana Alvarez", startPage:4, endPage:5 }] }),
    /COMPLETE_TRANSCRIPT_EXAMINATION_PAGES_NOT_ACCEPTED/);
});

test("caller-supplied multiple examinations are still unplaceable", () => {
  // Derived boundaries are placeable; a caller asserting two examinations without them is not.
  assert.throws(() => completePagination({ testimonyPages:200, signatureDisposition:"waived", frontPages:3,
    examinations:[{ examiner:"A" }, { examiner:"B" }] }),
    /COMPLETE_TRANSCRIPT_MULTIPLE_EXAMINATIONS_UNPLACEABLE/);
});

// --- reflow --------------------------------------------------------------------------------------

test("front matter growing by a page moves every examination citation with it", () => {
  const resolved = [exam("counsel-alvarez", "DIRECT", 1, true), exam("counsel-whitfield", "CROSS", 135)];
  const three = place(resolved), four = place(resolved, { frontPages:4 });
  assert.deepEqual(cite(three), ["Ms. Ana Alvarez 4-137", "Ms. Grace Whitfield 138-203"]);
  assert.deepEqual(cite(four), ["Ms. Ana Alvarez 5-138", "Ms. Grace Whitfield 139-204"]);
});

test("testimony growing by a page moves the later citation and leaves the earlier one alone", () => {
  // Measured on the realistic deposition rather than simulated: 80 words of reporter-authored text
  // inserted early takes the body from 207 pages to 208, and the cross with it.
  const evidence = Array.isArray(LONG_EVIDENCE) ? LONG_EVIDENCE : [LONG_EVIDENCE];
  const crossAt = LONG.segments.find(segment => segment.speakerIdentity === "counsel-whitfield").asrWordIds[0];
  const earlyWord = LONG.segments[2].asrWordIds[0];
  const crossOperation = { op:"examination", atWordId:crossAt, examinerPersonId:"counsel-whitfield", type:"CROSS" };
  const build = operations => {
    const overlay = operations.reduce((current, operation) => appendTransaction(current, [operation]), emptyOverlay("DEP-D3"));
    const rendered = renderTranscript({ working:LONG, evidence, speakerCandidates:LONG_SPEAKERS ?? [], examinerIdentity:"counsel-alvarez", overlay });
    const model = buildTranscriptPrintModel({ rendered, reviewStateHash:"d3", deposition:{ id:"DEP-D3" } });
    return { model, pagination:completePagination({ testimonyPages:model.pages.length, signatureDisposition:"waived",
      frontPages:3, record:RECORD, resolvedExaminations:model.examinations }) };
  };
  const before = build([crossOperation]);
  const after = build([crossOperation, { op:"insert", afterWordId:earlyWord, text:Array.from({ length:80 }, () => "supplemental").join(" ") }]);

  assert.equal(before.model.pages.length, 207);
  assert.equal(after.model.pages.length, 208, "the insertion grew the body by exactly one page");

  const crossOf = result => result.pagination.index.examinations.find(entry => entry.type === "CROSS");
  const directOf = result => result.pagination.index.examinations.find(entry => entry.type === "DIRECT");
  assert.equal(crossOf(before).startPage, 138, "cross begins on testimony page 135, page 138 behind three front pages");
  assert.equal(crossOf(after).startPage, 139, "and one page of upstream growth moves the citation by exactly one");
  assert.equal(directOf(before).startPage, directOf(after).startPage,
    "while the examination above the insertion still begins where it did");
  assert.equal(directOf(after).endPage, directOf(before).endPage + 1, "its range grows rather than moving");
});
