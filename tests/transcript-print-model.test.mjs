import assert from "node:assert/strict";
import test from "node:test";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/etminan-evidence.mjs";
import { appendOperations, emptyOverlay, undoLast } from "../server/reporter-overlay.mjs";
import { computeReviewStateHash } from "../server/review-state-hash.mjs";
import { buildTranscriptPrintModel } from "../server/transcript-print-model.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";

const DEPOSITION={ id:"DEP-TEST", caseStyle:"Etminan v. Example", witness:"Dr. Mohammad Etminan", depositionDate:"2026-04-24", causeNumber:"123" };
const overlayOf=(...operations)=>({ ...emptyOverlay(DEPOSITION.id), operations });
const render=overlay=>renderTranscript({ working:WORKING, evidence:[EVIDENCE], speakerCandidates:SPEAKER_CANDIDATES, examinerIdentity:"counsel-bentley", overlay });
const model=overlay=>buildTranscriptPrintModel({ rendered:render(overlay), reviewStateHash:computeReviewStateHash({transcript:WORKING,overlay}), deposition:DEPOSITION });
const answer=WORKING.segments[3],wordId=answer.asrWordIds[3];
const evidenceSnapshot=JSON.stringify(EVIDENCE),workingSnapshot=JSON.stringify(WORKING);
const visible=value=>value.paragraphs.map(paragraph=>`${paragraph.label??""}${paragraph.text}`).join("\n");
const pageText=value=>value.pages.flatMap(page=>page.lines.filter(line=>line.occupied).map(line=>line.content)).join("\n");

test("Print Model consumes canonical paragraphs and exposes a 25-position body grid",()=>{
  const rendered=render(overlayOf()),printed=model(overlayOf());
  assert.deepEqual(printed.paragraphs,rendered.paragraphs.map(paragraph=>({
    id:paragraph.id, elementType:paragraph.elementType, label:paragraph.label, byLine:paragraph.byLine,
    layout:paragraph.layout, text:paragraph.text, start:paragraph.start, end:paragraph.end,
    segmentIds:paragraph.segmentIds, asrWordIds:paragraph.asrWordIds,
    sourceJobIdentity:paragraph.sourceJobIdentity, deepgramSpeaker:paragraph.deepgramSpeaker,
  })),"Print Model projects canonical rendered paragraphs without rebuilding testimony");
  assert.equal(printed.paragraphs.some(paragraph=>Object.hasOwn(paragraph,"words")),false,"Print Model retains references, not copied evidence word objects");
  assert.equal(printed.pages.every(page=>page.lines.length===25),true);
  assert.equal(printed.pages.every(page=>page.lines.every((line,index)=>line.position===index+1)),true);
  assert.equal(printed.layoutProfile.id,"TEXAS_FREELANCE_DEPOSITION_V1");
  assert.equal(printed.findings.print.some(finding=>finding.code==="PRINT_LAYOUT_PROFILE_UNVERIFIED"),false);
  const traced=printed.pages.flatMap(page=>page.lines).find(line=>line.occupied&&line.trace?.sourceWordIds.length);
  assert.ok(traced.trace.sourceSegmentIds.length);
  assert.ok(traced.trace.sourceWordIds.length);
});

test("Preview preserves fillers and supplies stable display-only labels for unreconciled speakers",()=>{
  const unreconciled={...WORKING,speakerMap:{status:"pending",assignments:[]},segments:WORKING.segments.map(segment=>({...segment,speakerIdentity:null,transcriptRole:null}))};
  const rendered=renderTranscript({working:unreconciled,evidence:[EVIDENCE],speakerCandidates:SPEAKER_CANDIDATES,overlay:overlayOf()});
  const printed=buildTranscriptPrintModel({rendered,reviewStateHash:computeReviewStateHash({transcript:unreconciled,overlay:overlayOf()}),deposition:DEPOSITION});
  assert.equal(printed.paragraphs.every(paragraph=>paragraph.label),true);
  assert.match(visible(printed),/SPEAKER \d+:/);
  assert.match(visible(printed),/\bUh\b/);
  assert.match(visible(printed),/\bum\b/);
  assert.equal(printed.paragraphs.map(paragraph=>paragraph.text).join("\n"),rendered.paragraphs.map(paragraph=>paragraph.text).join("\n"));
});

const cases=[
  { name:"replace", operation:{op:"replace",wordId,text:"Muhammad"}, assertChange(rendered,printed){
      const word=rendered.paragraphs.flatMap(item=>item.words).find(item=>item.id===wordId);
      assert.equal(word.text,"Muhammad"); assert.equal(word.originalText,EVIDENCE.words.find(item=>item.id===wordId).punctuatedWord);
      assert.match(visible(printed),/Muhammad/); assert.match(pageText(printed),/Muhammad/);
    } },
  { name:"delete", operation:{op:"delete",wordId}, assertChange(rendered,printed){
      const word=rendered.paragraphs.flatMap(item=>item.words).find(item=>item.id===wordId);
      const paragraph=rendered.paragraphs.find(item=>item.asrWordIds.includes(wordId));
      assert.equal(word.deleted,true); assert.ok(word.originalText); assert.equal(paragraph.text.split(/\s+/).includes(word.originalText),false);
      assert.equal(printed.paragraphs.find(item=>item.id===paragraph.id).text,paragraph.text);
      assert.ok(printed.pages.flatMap(page=>page.lines).some(line=>line.paragraphId===paragraph.id&&line.content.includes(paragraph.text.split(/\s+/)[0])));
    } },
  { name:"insert", operation:{op:"insert",afterWordId:wordId,text:"(sic)"}, assertChange(rendered,printed){
      const authored=rendered.paragraphs.flatMap(item=>item.words).find(item=>item.authored);
      assert.equal(authored.text,"(sic)"); assert.equal(EVIDENCE.words.some(item=>item.id===authored.id),false); assert.match(visible(printed),/\(sic\)/); assert.match(pageText(printed),/\(sic\)/);
    } },
  { name:"split", operation:{op:"split",segmentId:answer.id,beforeWordId:wordId}, assertChange(rendered,printed,before){
      assert.equal(rendered.paragraphs.length,before.paragraphs.length+1); assert.equal(printed.paragraphs.length,rendered.paragraphs.length);
      assert.ok(printed.pages.flatMap(page=>page.lines).some(line=>line.trace?.sourceWordIds.includes(wordId)));
    } },
  { name:"label", operation:{op:"label",segmentId:answer.id,speakerIdentity:"counsel-ramon",transcriptRole:"DEFENDING_ATTORNEY"}, assertChange(rendered,printed){
      assert.ok(rendered.paragraphs.some(item=>item.label==="MR. RAMON:"&&item.asrWordIds.includes(wordId)));
      assert.match(visible(printed),/MR\. RAMON:/); assert.match(pageText(printed),/MR\. RAMON:/);
    } },
];

for(const entry of cases)test(`${entry.name}: overlay → canonical render → Continuous/Page Preview → exact undo`,()=>{
  const empty=overlayOf(),beforeRendered=render(empty),before=model(empty),editedOverlay=appendOperations(empty,[entry.operation]);
  const editedRendered=render(editedOverlay),edited=model(editedOverlay);
  entry.assertChange(editedRendered,edited,beforeRendered);
  assert.equal(JSON.stringify(EVIDENCE),evidenceSnapshot,"ASR evidence remains immutable");
  assert.equal(JSON.stringify(WORKING),workingSnapshot,"working projection remains immutable");
  assert.notEqual(edited.source.reviewStateHash,before.source.reviewStateHash);
  assert.notEqual(edited.modelHash,before.modelHash);
  for(const paragraph of edited.paragraphs){
    const lines=edited.pages.flatMap(page=>page.lines).filter(line=>line.paragraphId===paragraph.id);
    assert.ok(lines.length,`${paragraph.id} must reach Page Preview`);
    assert.ok(lines.every(line=>paragraph.segmentIds.every(id=>line.trace.sourceSegmentIds.includes(id))));
    assert.ok(lines.every(line=>paragraph.asrWordIds.every(id=>line.trace.sourceWordIds.includes(id))));
  }
  const {overlay:undone}=undoLast(editedOverlay),restored=model(undone);
  assert.equal(visible(restored),visible(before));
  assert.equal(pageText(restored),pageText(before));
  assert.equal(restored.source.reviewStateHash,before.source.reviewStateHash);
  assert.equal(restored.modelHash,before.modelHash);
});

test("a layout-affecting correction changes pagination content and model identity",()=>{
  const before=model(overlayOf()),long=Array.from({length:90},(_,index)=>`correction${index}`).join(" ");
  const after=model(overlayOf({op:"replace",wordId,text:long}));
  assert.notEqual(pageText(after),pageText(before));
  assert.notEqual(after.modelHash,before.modelHash);
  assert.ok(after.pages.length>=before.pages.length);
});

test("line wrapping preserves canonical two-space sentence style",()=>{
  const printed=model(overlayOf());
  const canonical=printed.paragraphs.find(paragraph=>paragraph.text.includes("  "));
  assert.ok(canonical,"fixture must contain reporter-approved double spacing");
  const physical=printed.pages.flatMap(page=>page.lines).filter(line=>line.paragraphId===canonical.id).map(line=>line.content.trim()).join(" ");
  assert.ok(physical.includes("  "),"spacing inside physical lines must remain canonical");
});
