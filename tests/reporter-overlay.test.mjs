import assert from "node:assert/strict";
import test from "node:test";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/etminan-evidence.mjs";
import { ELEMENT } from "../server/transcript-labels.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";
import { appendOperations, applyOverlay, emptyOverlay, undoLast, validateOperation } from "../server/reporter-overlay.mjs";

const overlayOf = (...operations) => ({ ...emptyOverlay("DEP-TEST"), operations });
const render = overlay => renderTranscript({ working:WORKING, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley", overlay });
// The answer "Uh, my name is Dr. Mohammad Etminan." -- long enough to split inside.
const ANSWER = WORKING.segments[3];
const MIDWORD = ANSWER.asrWordIds[3];

test("an empty overlay renders identically to no overlay",()=>{
  assert.deepEqual(render(overlayOf()).paragraphs, render(null).paragraphs);
});

// --- I1: the multiset of Deepgram word ids never changes -------------------------------------
test("I1: no operation adds, removes or duplicates a Deepgram word id",()=>{
  const evidenceIds = EVIDENCE.words.map(word => word.id).sort();
  const overlays = [
    overlayOf(),
    overlayOf({ op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD }),
    overlayOf({ op:"replace", wordId:MIDWORD, text:"Muhammad" }),
    overlayOf({ op:"delete", wordId:MIDWORD }),
    overlayOf({ op:"insert", afterWordId:MIDWORD, text:"(sic)" }),
    overlayOf({ op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD },{ op:"delete", wordId:MIDWORD },{ op:"insert", afterWordId:MIDWORD, text:"Mohammad" }),
  ];
  for (const overlay of overlays) {
    const result = render(overlay);
    const rendered = result.paragraphs.flatMap(paragraph => paragraph.words.filter(word => !word.authored).map(word => word.id)).sort();
    assert.deepEqual(rendered, evidenceIds, `overlay ${JSON.stringify(overlay.operations)} changed the word multiset`);
  }
});

test("I1: delete tombstones a word, keeping its id and its original text",()=>{
  const result = render(overlayOf({ op:"delete", wordId:MIDWORD }));
  const word = result.paragraphs.flatMap(paragraph => paragraph.words).find(item => item.id === MIDWORD);
  assert.ok(word,"a struck word stays in the record");
  assert.equal(word.deleted,true);
  assert.equal(word.originalText, EVIDENCE.words.find(item => item.id === MIDWORD).punctuatedWord);
});

test("I1: reporter-authored text carries no Deepgram anchor",()=>{
  // This is what makes audio-derived and human-added text distinguishable at a glance, which is
  // what the evidentiary claim rests on.
  const result = render(overlayOf({ op:"insert", afterWordId:MIDWORD, text:"(sic)" }));
  const authored = result.paragraphs.flatMap(paragraph => paragraph.words).filter(word => word.authored);
  assert.equal(authored.length,1);
  assert.equal(authored[0].text,"(sic)");
  assert.equal(authored[0].start,null);
  assert.equal(EVIDENCE.words.some(word => word.id === authored[0].id),false,"an authored word must not borrow an evidence id");
});

// --- I2: nothing is written ------------------------------------------------------------------
test("I2: applying an overlay mutates neither the projection nor the evidence",()=>{
  const workingBefore = JSON.stringify(WORKING), evidenceBefore = JSON.stringify(EVIDENCE);
  render(overlayOf(
    { op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD },
    // The tail is named for the word it begins at. It was `#2` for every split, which collided
    // when one segment was split twice; nothing stored depends on the old form, because the
    // Workspace only ever labels by wordId and a stale segment id orphans visibly rather than
    // resolving to the wrong half.
    { op:"label", segmentId:`${ANSWER.id}#${MIDWORD}`, speakerIdentity:"counsel-ramon", transcriptRole:"DEFENDING_ATTORNEY" },
    { op:"replace", wordId:MIDWORD, text:"Muhammad" },
  ));
  assert.equal(JSON.stringify(WORKING), workingBefore,"working.json must be untouched");
  assert.equal(JSON.stringify(EVIDENCE), evidenceBefore,"asr-evidence.json must be untouched");
});

test("I2: applyOverlay returns new segments rather than editing the ones it was given",()=>{
  const segments = WORKING.segments.map(segment => ({ ...segment, asrWordIds:[...segment.asrWordIds] }));
  const snapshot = JSON.stringify(segments);
  // The label must DIFFER from what the segment already carries. Relabelling the witness as the
  // witness mutates nothing, so the assertion would hold whether or not the input was copied --
  // which is how this test first passed against an implementation that mutated in place.
  assert.equal(ANSWER.speakerIdentity,"witness");
  const result = applyOverlay(segments, overlayOf({ op:"label", segmentId:ANSWER.id, speakerIdentity:"counsel-ramon", transcriptRole:"DEFENDING_ATTORNEY" }));
  assert.equal(JSON.stringify(segments), snapshot,"the caller's segments must be untouched");
  assert.equal(result.segments.find(segment => segment.id === ANSWER.id).speakerIdentity,"counsel-ramon","and the returned copy must carry the change");
});

// --- I3: a lost anchor is reported ------------------------------------------------------------
test("I3: an operation whose anchor is gone is orphaned, never silently dropped",()=>{
  const result = render(overlayOf(
    { op:"replace", wordId:"job0000000000000000000000000000000000000000000000000000000000000:word:99999", text:"nope" },
    { op:"split", segmentId:"no-such-segment", beforeWordId:MIDWORD },
    { op:"label", segmentId:"no-such-segment", speakerIdentity:"witness", transcriptRole:"WITNESS" },
  ));
  const orphans = result.findings.filter(finding => finding.code === "ORPHANED_OPERATION");
  assert.equal(orphans.length,3);
  assert.deepEqual(orphans.map(orphan => orphan.reason),["WORD_NOT_FOUND","SEGMENT_NOT_FOUND","SEGMENT_NOT_FOUND"]);
  assert.equal(result.counts.orphaned,3);
});

test("I3: splitting at a segment's first word is reported, not silently accepted",()=>{
  // It would produce an empty head -- a no-op that quietly multiplies segment ids.
  const result = render(overlayOf({ op:"split", segmentId:ANSWER.id, beforeWordId:ANSWER.asrWordIds[0] }));
  assert.equal(result.findings.find(finding => finding.code === "ORPHANED_OPERATION").reason,"SPLIT_AT_SEGMENT_START");
});

// --- I4: determinism --------------------------------------------------------------------------
test("I4: the same overlay against the same projection renders byte-identically",()=>{
  const overlay = overlayOf(
    { op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD },
    { op:"insert", afterWordId:MIDWORD, text:"(sic)" },
    { op:"insert", afterWordId:MIDWORD, text:"[second]" },
    { op:"replace", wordId:ANSWER.asrWordIds[1], text:"MY" },
  );
  assert.equal(JSON.stringify(render(overlay)), JSON.stringify(render(overlay)));
});

// --- behaviour -------------------------------------------------------------------------------
test("split separates a paragraph and each half seeks to its own first word",()=>{
  const before = render(overlayOf());
  const after = render(overlayOf({ op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD }));
  assert.equal(after.counts.paragraphs, before.counts.paragraphs + 1);
  const tail = after.paragraphs.find(paragraph => paragraph.words[0]?.id === MIDWORD);
  assert.ok(tail,"the second half must begin at the split word");
  assert.equal(tail.start, EVIDENCE.words.find(word => word.id === MIDWORD).start,"and seek to that word, not to the segment it inherited");
  assert.notEqual(tail.start, ANSWER.start,"the fixture must actually separate the two");
});

test("label relabels a split half without touching the other",()=>{
  // The user's case: highlight "Yes." inside a question and make it an answer.
  const result = render(overlayOf(
    { op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD },
    // The tail is named for the word it begins at. Every tail used to be `#2`, which collided
    // when one segment was split twice. Nothing stored depends on the old form: the Workspace
    // only ever labels by wordId, and a stale segment id now orphans visibly rather than
    // resolving to the wrong half.
    { op:"label", segmentId:`${ANSWER.id}#${MIDWORD}`, speakerIdentity:"counsel-ramon", transcriptRole:"DEFENDING_ATTORNEY" },
  ));
  const tail = result.paragraphs.find(paragraph => paragraph.words[0]?.id === MIDWORD);
  assert.equal(tail.elementType, ELEMENT.COLLOQUY);
  assert.equal(tail.label,"MR. RAMON:");
});

test("replace changes the reading and keeps the original beside it",()=>{
  const result = render(overlayOf({ op:"replace", wordId:MIDWORD, text:"Muhammad" }));
  const word = result.paragraphs.flatMap(paragraph => paragraph.words).find(item => item.id === MIDWORD);
  assert.equal(word.text,"Muhammad");
  assert.equal(word.edited,true);
  assert.ok(word.originalText,"what Deepgram heard must stay recoverable");
  assert.notEqual(word.originalText,"Muhammad");
});

test("paragraph text is rebuilt from its words after an edit",()=>{
  const result = render(overlayOf({ op:"replace", wordId:MIDWORD, text:"Muhammad" }));
  const paragraph = result.paragraphs.find(item => item.words.some(word => word.id === MIDWORD));
  assert.match(paragraph.text,/Muhammad/,"the paragraph must read what the words now say");
});

test("split and label address a word, so the client never needs segment boundaries",()=>{
  // A rendered paragraph can span several segments. The first version of the Workspace passed
  // `segmentIds.at(-1)` -- the last segment, not the one holding the anchor -- and against the
  // real deposition the split orphaned silently, taking its label with it. Resolving from the
  // word server-side removes the class of error, and after a split the segment holding the
  // anchor IS the new tail, so the label needs no second lookup.
  const result = render(overlayOf(
    { op:"split", beforeWordId:MIDWORD },
    { op:"label", wordId:MIDWORD, speakerIdentity:"counsel-ramon", transcriptRole:"DEFENDING_ATTORNEY" },
  ));
  assert.deepEqual(result.findings.filter(finding => finding.code === "ORPHANED_OPERATION"),[]);
  const tail = result.paragraphs.find(paragraph => paragraph.words[0]?.id === MIDWORD);
  assert.equal(tail.label,"MR. RAMON:");
});

test("a word-addressed operation orphans when the word is gone",()=>{
  const result = render(overlayOf({ op:"split", beforeWordId:"job0000000000000000000000000000000000000000000000000000000000000:word:99999" }));
  assert.equal(result.findings.find(finding => finding.code === "ORPHANED_OPERATION").reason,"WORD_NOT_FOUND");
});

test("an explicit segmentId still works, and still orphans when wrong",()=>{
  assert.equal(render(overlayOf({ op:"label", segmentId:ANSWER.id, speakerIdentity:"counsel-ramon", transcriptRole:"DEFENDING_ATTORNEY" })).counts.orphaned,0);
  assert.equal(render(overlayOf({ op:"label", segmentId:"nope", speakerIdentity:"witness", transcriptRole:"WITNESS" })).counts.orphaned,1);
});

// --- validation and the operation list --------------------------------------------------------
test("an unsupported or incomplete operation is rejected rather than normalised",()=>{
  for (const bad of [{},{ op:"nope" },{ op:"split", segmentId:"a" },{ op:"label" },{ op:"replace", wordId:"a" },{ op:"replace", wordId:"a", text:"   " },{ op:"delete" },{ op:"insert", text:"x" }]) {
    // split without beforeWordId and label without either anchor are the two that matter: both
    // would otherwise be accepted and then silently do nothing.
    assert.equal(validateOperation(bad).ok,false,`${JSON.stringify(bad)} must be rejected`);
  }
  assert.equal(validateOperation({ op:"replace", wordId:"a", text:"b" }).ok,true);
});

test("an empty replacement is refused, because a struck word is a different act",()=>{
  const result = validateOperation({ op:"replace", wordId:"a", text:"" });
  assert.equal(result.ok,false);
  assert.match(result.message,/use delete/);
});

test("undo pops the last operation and returns it",()=>{
  const overlay = appendOperations(emptyOverlay("D"),[{ op:"delete", wordId:"a" },{ op:"delete", wordId:"b" }]);
  const { overlay:after, removed } = undoLast(overlay);
  assert.equal(after.operations.length,1);
  assert.equal(removed.wordId,"b");
  assert.deepEqual(undoLast(emptyOverlay("D")).removed,null);
});

test("appendOperations rejects the whole batch if any operation is invalid",()=>{
  assert.throws(()=>appendOperations(emptyOverlay("D"),[{ op:"delete", wordId:"a" },{ op:"bogus" }]));
});

test("splitting one segment twice produces two distinct segments",()=>{
  // Every tail was named `${segment.id}#2`, so a second split of the same segment produced two
  // segments sharing an id and raised no orphan. A later `label` addressed by segment id then
  // resolved to whichever came first, moving a speaker attribution to the wrong half of a
  // deposition silently.
  const segments=[{ id:"job:segment:1", sourceJobIdentity:"job", asrWordIds:["w1","w2","w3","w4","w5"], text:"a b c d e", deepgramSpeaker:0 }];
  const overlay={ schemaVersion:"1.0.0", recordType:"REPORTER_OVERLAY", depositionId:"DEP",
    operations:[{ op:"split", segmentId:null, beforeWordId:"w5" },{ op:"split", segmentId:null, beforeWordId:"w3" }] };
  const applied=applyOverlay(segments,overlay,{ knownWordIds:new Set(["w1","w2","w3","w4","w5"]) });
  const ids=applied.segments.map(segment=>segment.id);
  assert.equal(new Set(ids).size,ids.length,`segment ids must be unique, got ${ids.join(", ")}`);
  assert.equal(applied.segments.length,3);
  assert.equal(applied.orphaned.length,0);
  // Deterministic, so replaying the same overlay rebuilds the same ids.
  const again=applyOverlay(segments,overlay,{ knownWordIds:new Set(["w1","w2","w3","w4","w5"]) });
  assert.deepEqual(again.segments.map(segment=>segment.id),ids);
});

test("a label pointed at a segment id that no longer exists is reported, not guessed",()=>{
  // The failure mode the unique ids remove. A stale reference must orphan with a reason rather
  // than resolve to whichever segment happens to match first.
  const result = render(overlayOf(
    { op:"split", segmentId:ANSWER.id, beforeWordId:MIDWORD },
    { op:"label", segmentId:`${ANSWER.id}#2`, speakerIdentity:"counsel-ramon", transcriptRole:"DEFENDING_ATTORNEY" },
  ));
  const orphan = result.findings.find(finding => finding.code === "ORPHANED_OPERATION");
  assert.ok(orphan,"a stale segment id must be reported");
  assert.match(orphan.message,/SEGMENT_NOT_FOUND/);
});
