import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { EVIDENCE, SPEAKER_CANDIDATES, WORKING } from "./fixtures/etminan-evidence.mjs";
import { appendOperations, emptyOverlay, undoLast } from "../server/reporter-overlay.mjs";
import { computeReviewStateHash } from "../server/review-state-hash.mjs";
import { buildTranscriptPrintModel } from "../server/transcript-print-model.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";

const DEPOSITION={id:"DEP-PHASE4"},render=overlay=>renderTranscript({working:WORKING,evidence:[EVIDENCE],speakerCandidates:SPEAKER_CANDIDATES,examinerIdentity:"counsel-bentley",overlay});
const model=overlay=>buildTranscriptPrintModel({rendered:render(overlay),reviewStateHash:computeReviewStateHash({transcript:WORKING,overlay}),deposition:DEPOSITION});
const contents=value=>value.pages.map(page=>page.lines.map(line=>line.content));

test("Workspace renders the shared modeled pages instead of paginating in React",()=>{
  const workspace=fs.readFileSync(new URL("../app/WorkspaceScreen.tsx",import.meta.url),"utf8"),pages=fs.readFileSync(new URL("../app/WorkspaceDocumentPages.tsx",import.meta.url),"utf8");
  assert.match(workspace,/api\/transcript\/print-model/);
  assert.match(workspace,/WorkspaceDocumentPages pages=\{printModel\.pages\}/);
  assert.match(pages,/page\.lines\.map/);
  assert.doesNotMatch(pages,/wrapText|paginateSharedDocument|charactersPerLine|slice\([^)]*25/);
});

test("Phase 5 uses a controlled one-paragraph editor and the stale-state transaction boundary",()=>{
  const workspace=fs.readFileSync(new URL("../app/WorkspaceScreen.tsx",import.meta.url),"utf8"),pages=fs.readFileSync(new URL("../app/WorkspaceDocumentPages.tsx",import.meta.url),"utf8");
  assert.match(pages,/workspace-direct-editor/);
  assert.match(pages,/onSaveParagraph/);
  assert.doesNotMatch(pages,/contentEditable/);
  assert.match(workspace,/paragraphEditTransaction/);
  // The hash is no longer spelled at each call site. Every overlay mutation is built by
  // overlayMutationRequest / overlayHistoryRequest, which THROW when the hash is missing rather than
  // sending a request the server is certain to refuse -- the defect that made six reporter actions
  // fail silently. Pinning the builder rather than the literal is the stronger check: a new call
  // site that spells its own payload no longer satisfies this.
  assert.match(workspace,/overlayMutationRequest\(\{depositionId,operations,reviewStateHash:printModel\.source\.reviewStateHash\}\)/);
  assert.doesNotMatch(workspace,/expectedReviewStateHash/,"no Workspace call site may assemble the hash by hand");
  assert.match(workspace,/overlayHistoryRequest\(\{ depositionId, reviewStateHash:printModel\?\.source\.reviewStateHash \}\)/);
  assert.match(workspace,/api\/transcript\/overlay\/redo/);
});

test("a continuation-page word opens its canonical paragraph editor immediately",()=>{
  const pages=fs.readFileSync(new URL("../app/WorkspaceDocumentPages.tsx",import.meta.url),"utf8");
  assert.match(pages,/onActivate\(line\.paragraphId,fragment\.id,event\.shiftKey,lineKey,fragment\.sourceStart\?\?0,event\.altKey\)/);
  assert.match(pages,/if\(!\(await save\(\)\)\)return;/);
  assert.match(pages,/onSelect\(paragraphId,wordId,shiftKey\)/);
  assert.match(pages,/if\(!shiftKey&&!paragraphRangeMode\)openEdit\(paragraphId,lineKey,offset\)/);
  // The on-screen instructions, which used to promise that Enter split a paragraph. It stopped
  // doing so when a structural change to a court record stopped being something a reflex during
  // typing could cause, and the help text outlived the behaviour by a whole browser gate.
  assert.match(pages,/Use Split here in the transcript tools/);
  assert.match(pages,/Ctrl\+S saves; Escape cancels/);
});

test("reporters can select a complete paragraph range across transcript pages",()=>{
  const workspace=fs.readFileSync(new URL("../app/WorkspaceScreen.tsx",import.meta.url),"utf8"),pages=fs.readFileSync(new URL("../app/WorkspaceDocumentPages.tsx",import.meta.url),"utf8");
  assert.match(workspace,/Select a range of complete paragraphs/);
  assert.match(workspace,/Select the first paragraph/);
  assert.match(workspace,/Select the last paragraph/);
  assert.match(workspace,/selectedParagraphIds=\{selectedParagraphIds\}/);
  assert.match(pages,/selectedParagraphIds\.has\(line\.paragraphId\)/);
  assert.match(pages,/range-selected/);
});

test("the designation selects its own paragraph, and a blank line is never selected",()=>{
  // Both found by a reporter on the real record, reported as "the WHO SPOKE? buttons are disabled".
  //
  // They had clicked SPEAKER 4: -- which is exactly where you aim when you want to change who spoke
  // -- and it was generated text with no handler. The click did nothing, and dragging across it
  // left a grey browser text-selection that reads as a selection. Nothing was wrong with the
  // controls; nothing had been selected.
  const pages=fs.readFileSync(new URL("../app/WorkspaceDocumentPages.tsx",import.meta.url),"utf8");
  assert.match(pages,/workspace-page-label/,"the designation is a control");
  assert.match(pages,/title="Select this paragraph"/);
  assert.match(pages,/fragment\.text\.trim\(\)/,"and only the fragment carrying it -- a button per space is a hazard, not a target");

  // 21 blank lines on the last page rendered as selected at the same time. A page holding neither
  // the old nor the new selection is held back by pageRenderEqual, so it keeps selectedParagraphId
  // as null -- and a blank line's own paragraphId is null, so null matched null.
  assert.match(pages,/line\.paragraphId&&line\.paragraphId===selectedParagraphId\?"selected":""/,
    "a line with no paragraph cannot be the selected paragraph");
});

test("modeled line timestamps are visible playback controls",()=>{
  const pages=fs.readFileSync(new URL("../app/WorkspaceDocumentPages.tsx",import.meta.url),"utf8");
  assert.match(pages,/workspace-line-time/);
  assert.match(pages,/Save the open paragraph and play audio from/);
  assert.match(pages,/async function playAt\(seconds:number\)\{if\(!\(await save\(\)\)\)return;setActiveEdit\(null\);onPlayAt\(seconds\)\}/);
});

test("every Workspace page receives exactly 25 numbered physical positions including blanks",()=>{
  const pages=model(emptyOverlay("DEP-PHASE4")).pages;
  assert.ok(pages.length);
  for(const page of pages){assert.equal(page.lines.length,25);assert.deepEqual(page.lines.map(line=>line.position),Array.from({length:25},(_,index)=>index+1));}
  assert.ok(pages.flatMap(page=>page.lines).some(line=>!line.occupied&&line.content===""));
});

test("Q/A, wrapped content, and generated designations are the shared-model output",()=>{
  const printed=model(emptyOverlay("DEP-PHASE4")),lines=printed.pages.flatMap(page=>page.lines).filter(line=>line.occupied);
  assert.ok(lines.some(line=>line.content.includes("Q.")));
  assert.ok(lines.some(line=>line.content.includes("A.")));
  assert.ok(lines.some(line=>line.fragments.some(fragment=>fragment.role==="layout"&&fragment.kind==="generated"&&fragment.sourceWordId===null)));
  assert.ok(lines.every(line=>line.content===line.fragments.map(fragment=>fragment.text).join("")));
});

test("page projection retains stable paragraph identity through repagination",()=>{
  const empty=emptyOverlay("DEP-PHASE4"),before=model(empty),selected=before.paragraphs.at(-1).id;
  const anchor=WORKING.segments[0].asrWordIds[1],long=Array.from({length:100},(_,index)=>`correction${index}`).join(" "),after=model(appendOperations(empty,{op:"replace",wordId:anchor,text:long}));
  assert.ok(before.pages.some(page=>page.lines.some(line=>line.paragraphId===selected)));
  assert.ok(after.pages.some(page=>page.lines.some(line=>line.paragraphId===selected)));
  assert.notDeepEqual(contents(after),contents(before));
});

test("existing correction, split, label, and Undo operations drive the paginated projection",()=>{
  const empty=emptyOverlay("DEP-PHASE4"),segment=WORKING.segments.find(item=>item.asrWordIds.length>2),anchor=segment.asrWordIds[1];
  const edited=appendOperations(empty,[{op:"split",beforeWordId:anchor},{op:"label",wordId:anchor,speakerIdentity:"counsel-ramon",transcriptRole:"DEFENDING_ATTORNEY"},{op:"replace",wordId:anchor,text:"Corrected"}]);
  const changed=model(edited);
  assert.ok(changed.pages.flatMap(page=>page.lines).some(line=>line.paragraphId===`paragraph:${anchor}`&&line.content.includes("Corrected")));
  const restored=model(undoLast(undoLast(undoLast(edited).overlay).overlay).overlay);
  assert.deepEqual(contents(restored),contents(model(empty)));
});

test("evidence timing/confidence survives while authored and generated content gains none",()=>{
  const anchor=WORKING.segments[0].asrWordIds[0],overlay=appendOperations(emptyOverlay("DEP-PHASE4"),{op:"insert",afterWordId:anchor,text:"reporter-authored"}),rendered=render(overlay),printed=model(overlay);
  const evidence=rendered.paragraphs.flatMap(paragraph=>paragraph.words).find(word=>word.id===anchor),authored=rendered.paragraphs.flatMap(paragraph=>paragraph.words).find(word=>word.authored),fragments=printed.pages.flatMap(page=>page.lines).flatMap(line=>line.fragments);
  assert.ok(evidence.start!==null&&evidence.end!==null&&evidence.confidence!==null);
  assert.equal(authored.start,null);assert.equal(authored.end,null);assert.equal(authored.confidence,null);
  assert.ok(fragments.filter(fragment=>fragment.id===authored.id).every(fragment=>fragment.sourceWordId===null&&fragment.audioStart===null));
  assert.ok(fragments.filter(fragment=>fragment.kind==="generated").every(fragment=>fragment.sourceWordId===null||fragment.sourceWordId===undefined));
});
