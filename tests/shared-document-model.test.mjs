import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/etminan-evidence.mjs";
import { emptyOverlay } from "../server/reporter-overlay.mjs";
import { buildSharedDocumentModel, paginateSharedDocument, sharedDocumentConsumerView } from "../server/shared-document-model.mjs";
import { TRANSCRIPT_BODY_LAYOUT_PROFILE, buildTranscriptPrintModel } from "../server/transcript-print-model.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";

const rendered=renderTranscript({working:WORKING,evidence:[EVIDENCE],speakerCandidates:SPEAKER_CANDIDATES,examinerIdentity:"counsel-bentley",overlay:emptyOverlay("DEP")});
const build=()=>buildSharedDocumentModel({rendered,profile:TRANSCRIPT_BODY_LAYOUT_PROFILE});

test("shared model has an extensible section boundary and no second transcript authority",()=>{
  const document=build();
  assert.equal(document.recordType,"SHARED_FINAL_DOCUMENT");
  assert.deepEqual(document.sections.map(section=>section.role),["transcript-body"]);
  assert.strictEqual(document.sections[0].paragraphs,rendered.paragraphs);
  assert.deepEqual(sharedDocumentConsumerView(document).pages,document.pages);
});

test("every printable evidence and authored token reaches token-aware physical fragments",()=>{
  const document=build();
  const fragments=document.pages.flatMap(page=>page.lines).flatMap(line=>line.fragments??[]);
  const printable=rendered.paragraphs.flatMap(paragraph=>paragraph.words.filter(word=>!word.deleted));
  for(const token of printable){
    const matches=fragments.filter(fragment=>fragment.id===(token.tokenId??token.id));
    assert.ok(matches.length,`${token.id} must retain a physical-page trace`);
    assert.equal(matches.map(fragment=>fragment.text).join(""),token.display??token.text);
    if(token.tokenKind==="evidence")assert.ok(matches.every(fragment=>fragment.sourceWordId===token.id&&fragment.sourceJobIdentity));
    if(token.tokenKind==="authored")assert.ok(matches.every(fragment=>fragment.sourceWordId===null&&fragment.audioStart===null));
  }
});

test("generated layout is explicit and cannot be mistaken for spoken evidence",()=>{
  const generated=build().pages.flatMap(page=>page.lines).flatMap(line=>line.fragments??[]).filter(fragment=>fragment.kind==="generated");
  assert.ok(generated.length);
  assert.ok(generated.every(fragment=>fragment.sourceWordId===null||fragment.sourceWordId===undefined));
  assert.ok(generated.some(fragment=>fragment.role==="layout"));
});

test("shared paginator is deterministic, pure, and preserves current Preview content",()=>{
  const document=build(),snapshot=JSON.stringify(document.sections);
  const again=paginateSharedDocument({sections:document.sections},{profile:TRANSCRIPT_BODY_LAYOUT_PROFILE,findings:[]});
  assert.deepEqual(again,document.pages);
  assert.equal(JSON.stringify(document.sections),snapshot);
  const preview=buildTranscriptPrintModel({rendered,reviewStateHash:"review-state",deposition:{id:"DEP"}});
  assert.deepEqual(preview.pages,document.pages);
});

test("large synthetic pagination remains practical and reports a measurement",t=>{
  const paragraphs=Array.from({length:1200},(_,paragraphIndex)=>{
    const words=Array.from({length:24},(_,wordIndex)=>{const id=`job-large:word:${paragraphIndex*24+wordIndex+1}`;return{id,tokenId:id,tokenKind:"evidence",sourceWordId:id,text:`word${wordIndex}`,display:`word${wordIndex}`,start:paragraphIndex,end:paragraphIndex+0.5,confidence:0.99}});
    return{id:`paragraph:${words[0].id}`,elementType:"question",label:"Q.",byLine:null,layout:{tokenCol:0,textCol:5,wrapCol:5,centered:false},text:words.map(word=>word.text).join(" "),words,segmentIds:[`job-large:segment:${paragraphIndex+1}`],asrWordIds:words.map(word=>word.id),sourceJobIdentity:"job-large",start:paragraphIndex,end:paragraphIndex+0.5};
  });
  const synthetic={schemaVersion:"1",recordType:"RENDERED_TRANSCRIPT",transcriptContentHash:"large",renderedContentHash:"large-render",paragraphs};
  const started=performance.now(),document=buildSharedDocumentModel({rendered:synthetic,profile:TRANSCRIPT_BODY_LAYOUT_PROFILE}),elapsedMs=performance.now()-started;
  t.diagnostic(`shared paginator: ${paragraphs.length} paragraphs / ${paragraphs.length*24} tokens / ${document.pages.length} pages in ${elapsedMs.toFixed(1)} ms`);
  assert.ok(document.pages.length>100);
  assert.ok(elapsedMs<5000,`pagination took ${elapsedMs.toFixed(1)} ms`);
});
