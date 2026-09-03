import assert from "node:assert/strict";
import test from "node:test";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/etminan-evidence.mjs";
import { ELEMENT } from "../server/transcript-labels.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";
import { buildTranscriptPrintModel } from "../server/transcript-print-model.mjs";
import { appendOperations, appendTransaction, applyOverlay, emptyOverlay, redoLastTransaction, undoLast, undoLastTransaction, validateOperation } from "../server/reporter-overlay.mjs";

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

test("deleting a complete opening paragraph removes it from print without rebasing later audio",()=>{
  const plain=render(overlayOf()),first=plain.paragraphs.find(paragraph=>paragraph.words.some(word=>Number.isFinite(word.start))),next=plain.paragraphs.find(paragraph=>paragraph.id!==first.id&&paragraph.words.some(word=>Number.isFinite(word.start)));
  const deleted=render(overlayOf(...first.words.map(word=>({op:"delete",wordId:word.id}))));
  const tombstone=deleted.paragraphs.find(paragraph=>paragraph.id===first.id);
  assert.ok(tombstone.words.every(word=>word.deleted));assert.equal(tombstone.text,"");
  const retained=deleted.paragraphs.find(paragraph=>paragraph.id===next.id);assert.equal(retained.start,next.start);
  const print=buildTranscriptPrintModel({rendered:deleted,reviewStateHash:"frozen-timestamp-test",deposition:{id:"DEP-TEST"}});
  assert.equal(print.paragraphs.some(paragraph=>paragraph.id===first.id),false);
  assert.equal(print.paragraphs.find(paragraph=>paragraph.id===next.id).start,next.start);
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

test("an intentional join removes one boundary while preserving every evidence word",()=>{
  const split=appendOperations(emptyOverlay("DEP-TEST"),{op:"split",beforeWordId:MIDWORD});
  const joined=appendOperations(split,{op:"join",leadingWordId:ANSWER.asrWordIds[0],trailingWordId:MIDWORD});
  const before=render(overlayOf()),after=render(joined);
  assert.equal(after.counts.paragraphs,before.counts.paragraphs);
  assert.deepEqual(
    after.paragraphs.flatMap(paragraph=>paragraph.words.filter(word=>!word.authored).map(word=>word.id)).sort(),
    EVIDENCE.words.map(word=>word.id).sort(),
  );
  assert.equal(after.findings.filter(finding=>finding.code==="ORPHANED_OPERATION").length,0);
});

test("join keeps the leading paragraph speaker and role and is one undoable transaction",()=>{
  const split=appendTransaction(emptyOverlay("DEP-TEST"),[
    {op:"split",beforeWordId:MIDWORD},
    {op:"label",wordId:MIDWORD,speakerIdentity:"counsel-ramon",transcriptRole:"DEFENDING_ATTORNEY"},
  ]);
  const splitRender=render(split);
  const joined=appendTransaction(split,{op:"join",leadingWordId:ANSWER.asrWordIds[ANSWER.asrWordIds.indexOf(MIDWORD)-1],trailingWordId:MIDWORD,leadingFirstWordId:ANSWER.asrWordIds[0],trailingLastWordId:ANSWER.asrWordIds.at(-1)});
  const paragraph=render(joined).paragraphs.find(item=>item.words.some(word=>word.id===MIDWORD));
  assert.equal(render(joined).counts.paragraphs,splitRender.counts.paragraphs-1,"one join removes exactly one rendered boundary");
  assert.equal(paragraph.speakerIdentity,ANSWER.speakerIdentity);
  assert.equal(paragraph.transcriptRole,ANSWER.transcriptRole);
  assert.deepEqual(redoLastTransaction(undoLastTransaction(joined).overlay).overlay.operations,joined.operations);
});

test("low-confidence review is durable and undoable without changing evidence confidence",()=>{
  const word=EVIDENCE.words.find(item=>Number.isFinite(item.confidence));
  const approved=appendTransaction(emptyOverlay("DEP-TEST"),{op:"review",wordId:word.id,disposition:"APPROVED",at:"2026-08-26T12:00:00.000Z",actor:"reporter"});
  const rendered=render(approved),current=rendered.paragraphs.flatMap(paragraph=>paragraph.words).find(item=>item.id===word.id);
  assert.equal(current.reviewDisposition,"APPROVED");
  assert.equal(current.confidence,word.confidence);
  assert.equal(render(undoLastTransaction(approved).overlay).paragraphs.flatMap(paragraph=>paragraph.words).find(item=>item.id===word.id).reviewDisposition,null);
});

test("correcting a low-confidence evidence word records CORRECTED while retaining confidence",()=>{
  const word=EVIDENCE.words.find(item=>Number.isFinite(item.confidence));
  const corrected=render(appendTransaction(emptyOverlay("DEP-TEST"),{op:"replace",wordId:word.id,text:"Corrected"})).paragraphs.flatMap(paragraph=>paragraph.words).find(item=>item.id===word.id);
  assert.equal(corrected.reviewDisposition,"CORRECTED");
  assert.equal(corrected.confidence,word.confidence);
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

// --- the flag: one mark, one meaning
//
// Built through appendOperations rather than as literals: validation is where a single-word flag
// becomes a range of one, and the API path always runs it. Bypassing it would test a shape the
// server never produces.
const flagOverlay = (...operations) => appendOperations(emptyOverlay("DEP-TEST"), operations);
//
// A scopist listening to the recording marks a passage that needs another listen, and comes back
// to it. There is one mark type on purpose: a mark whose meaning is chosen per mark asks for a
// decision at the moment the tool exists to make fast.

test("a flagged passage reads exactly as it did unflagged",()=>{
  // The whole guard. A flag is not an edit, and a caller that asks for the text must not be able
  // to tell a flag was ever applied.
  const flagged = render(flagOverlay({ op:"flag", fromWordId:ANSWER.asrWordIds[1], toWordId:ANSWER.asrWordIds[4] }));
  const plain = render(flagOverlay());
  assert.deepEqual(flagged.paragraphs.map(paragraph => paragraph.text), plain.paragraphs.map(paragraph => paragraph.text));
  assert.equal(flagged.findings.filter(finding => finding.code === "ORPHANED_OPERATION").length, 0);
});

test("a flag covers the passage it spans, and every word names the flag it belongs to",()=>{
  const from = ANSWER.asrWordIds[1], to = ANSWER.asrWordIds[4];
  const words = render(flagOverlay({ op:"flag", fromWordId:from, toWordId:to })).paragraphs.flatMap(paragraph => paragraph.words);
  const marked = words.filter(word => word.flagged);
  assert.deepEqual(marked.map(word => word.id), ANSWER.asrWordIds.slice(1, 5), "the range is inclusive at both ends and stops there");
  // A click anywhere inside the passage has to be able to clear the whole of it, which means
  // every word carries the anchor rather than only the first.
  assert.ok(marked.every(word => word.flaggedFrom === from));
  assert.ok(words.filter(word => !word.flagged).every(word => word.flaggedFrom === undefined));
});

test("a single word is a range of one",()=>{
  const words = render(flagOverlay({ op:"flag", fromWordId:MIDWORD })).paragraphs.flatMap(paragraph => paragraph.words);
  assert.deepEqual(words.filter(word => word.flagged).map(word => word.id), [MIDWORD]);
});

test("clearing a flag removes it, and clearing nothing says so",()=>{
  // Clearing is the half that makes the tool usable. A list that only grows is one the scopist
  // stops trusting.
  const cleared = render(flagOverlay(
    { op:"flag", fromWordId:ANSWER.asrWordIds[1], toWordId:ANSWER.asrWordIds[4] },
    { op:"unflag", fromWordId:ANSWER.asrWordIds[1] },
  ));
  assert.equal(cleared.paragraphs.flatMap(paragraph => paragraph.words).filter(word => word.flagged).length, 0);
  assert.equal(cleared.counts.flags, 0);
  // An unflag with nothing to clear is reported, not ignored: a clear that silently did nothing
  // leaves the scopist believing a passage is resolved while it is still marked.
  const orphan = render(flagOverlay({ op:"unflag", fromWordId:MIDWORD })).findings.find(finding => finding.code === "ORPHANED_OPERATION");
  assert.equal(orphan?.reason, "FLAG_NOT_FOUND");
});

test("the count is passages, not words",()=>{
  // What a scopist works through is places, and "31 flagged" for two passages would be a lie
  // about how much is left.
  const rendered = render(flagOverlay(
    { op:"flag", fromWordId:ANSWER.asrWordIds[0], toWordId:ANSWER.asrWordIds[3] },
    { op:"flag", fromWordId:ANSWER.asrWordIds[5] },
  ));
  assert.equal(rendered.counts.flags, 2);
  assert.equal(rendered.paragraphs.flatMap(paragraph => paragraph.words).filter(word => word.flagged).length, 5);
});

test("flagging the same passage twice moves the mark rather than stacking two",()=>{
  const rendered = render(flagOverlay(
    { op:"flag", fromWordId:ANSWER.asrWordIds[1], toWordId:ANSWER.asrWordIds[2] },
    { op:"flag", fromWordId:ANSWER.asrWordIds[1], toWordId:ANSWER.asrWordIds[4] },
  ));
  assert.equal(rendered.counts.flags, 1, "one passage, re-marked");
  // And one unflag clears it, which would not hold if the second flag had stacked.
  assert.equal(render(flagOverlay(
    { op:"flag", fromWordId:ANSWER.asrWordIds[1], toWordId:ANSWER.asrWordIds[2] },
    { op:"flag", fromWordId:ANSWER.asrWordIds[1], toWordId:ANSWER.asrWordIds[4] },
    { op:"unflag", fromWordId:ANSWER.asrWordIds[1] },
  )).counts.flags, 0);
});

test("a flag whose anchor no longer exists is reported, not silently dropped",()=>{
  const orphan = render(flagOverlay({ op:"flag", fromWordId:MIDWORD, toWordId:"job:word:99999" }))
    .findings.find(finding => finding.code === "ORPHANED_OPERATION");
  assert.equal(orphan?.reason, "WORD_NOT_FOUND");
  assert.equal(render(flagOverlay({ op:"flag", fromWordId:MIDWORD, toWordId:"job:word:99999" })).counts.flags, 0);
});

test("a flag survives a split of the passage it covers",()=>{
  // Word ids are what the flag is anchored to and a split does not move words, so a paragraph
  // boundary appearing inside a marked passage leaves the mark where it was.
  const from = ANSWER.asrWordIds[1], to = ANSWER.asrWordIds[4];
  const before = render(flagOverlay({ op:"flag", fromWordId:from, toWordId:to }));
  const after = render(flagOverlay({ op:"flag", fromWordId:from, toWordId:to },{ op:"split", beforeWordId:ANSWER.asrWordIds[3] }));
  assert.ok(after.paragraphs.length > before.paragraphs.length, "the split really happened");
  assert.deepEqual(
    after.paragraphs.flatMap(paragraph => paragraph.words).filter(word => word.flagged).map(word => word.id),
    before.paragraphs.flatMap(paragraph => paragraph.words).filter(word => word.flagged).map(word => word.id));
});

test("a flag is rejected without an anchor, and undo pops it like any other operation",()=>{
  assert.equal(validateOperation({ op:"flag" }).ok, false);
  assert.equal(validateOperation({ op:"unflag" }).ok, false);
  const overlay = appendOperations(emptyOverlay("DEP-TEST"), [{ op:"flag", fromWordId:MIDWORD }]);
  assert.equal(undoLast(overlay).removed.op, "flag");
  assert.equal(undoLast(overlay).overlay.operations.length, 0);
});

test("a flag reaches no correction pass",()=>{
  // The mark is the scopist's working note. It carries no evidence anchor a correction could be
  // proposed against, and applyOverlay keeps it out of the four things a chunk is built from.
  const applied = applyOverlay(WORKING.segments, flagOverlay({ op:"flag", fromWordId:MIDWORD }));
  const plain = applyOverlay(WORKING.segments, flagOverlay());
  assert.deepEqual(applied.segments, plain.segments, "no segment is changed by a flag");
  assert.equal(applied.replaced.size, 0);
  assert.equal(applied.deleted.size, 0);
  assert.equal(applied.inserted.size, 0);
  assert.equal(applied.flagged.get(MIDWORD), MIDWORD, "and the flag itself is available, just not as an edit");
});
