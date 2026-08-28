import assert from "node:assert/strict";
import test from "node:test";
import { appendOperations, emptyOverlay } from "../server/reporter-overlay.mjs";
import { buildTranscriptPrintModel } from "../server/transcript-print-model.mjs";
import { renderTranscript } from "../server/transcript-render.mjs";
import { EVIDENCE, WORKING } from "./fixtures/etminan-evidence.mjs";

const candidates=[
  {id:"counsel-bentley",label:"Dennis J. Bentley",honorific:"MS.",defaultRole:"QUESTIONING_ATTORNEY"},
  {id:"counsel-ramon",label:"Christian R. Ramon",honorific:"MR.",defaultRole:"DEFENDING_ATTORNEY"},
  {id:"witness",label:"Dr. Synthetic Witness",defaultRole:"WITNESS"},
  {id:"reporter",label:"Riley Reporter",defaultRole:"COURT_REPORTER"},
  {id:"videographer",label:"Synthetic Videographer",defaultRole:"VIDEOGRAPHER"},
];
const doctor=EVIDENCE.words.find(word=>word.punctuatedWord==="Doctor."),can=EVIDENCE.words.find((word,index)=>word.punctuatedWord==="Can"&&EVIDENCE.words[index-1]?.id===doctor?.id);

test("resolved participant honorifics flow into colloquy and BY-lines without modifying evidence",()=>{
  const rendered=renderTranscript({working:WORKING,evidence:[EVIDENCE],speakerCandidates:candidates,overlay:emptyOverlay("DEP-TEST")});
  assert.ok(rendered.paragraphs.some(paragraph=>paragraph.label==="MR. RAMON:"));
  assert.ok(rendered.paragraphs.some(paragraph=>paragraph.byLine==="(BY MS. BENTLEY)"));
  assert.equal(EVIDENCE.words.find(word=>word.id===doctor.id).punctuatedWord,"Doctor.");
});

test("Doctor/can reporter correction survives shared pagination while evidence remains original",()=>{
  const overlay=appendOperations(emptyOverlay("DEP-TEST"),[{op:"replace",wordId:doctor.id,text:"Doctor,"},{op:"replace",wordId:can.id,text:"can"}]);
  const rendered=renderTranscript({working:WORKING,evidence:[EVIDENCE],speakerCandidates:candidates,overlay});
  const paragraph=rendered.paragraphs.find(item=>item.asrWordIds.includes(doctor.id));
  assert.match(paragraph.text,/Good afternoon, Doctor, can you please state your name/);
  assert.equal(paragraph.words.find(word=>word.id===doctor.id).originalText,"Doctor.");
  assert.equal(paragraph.words.find(word=>word.id===can.id).originalText,"Can");
  const printed=buildTranscriptPrintModel({rendered,reviewStateHash:"human-gate-review",deposition:{id:"DEP-TEST"}});
  const physical=printed.pages.flatMap(page=>page.lines).filter(line=>line.paragraphId===paragraph.id).map(line=>line.content.trim()).join(" ");
  assert.match(physical,/Good afternoon, Doctor, can you please state your name/);
  const ids=printed.pages.flatMap(page=>page.lines).flatMap(line=>line.fragments).filter(fragment=>fragment.sourceWordId).map(fragment=>fragment.sourceWordId);
  assert.equal(ids.filter(id=>id===doctor.id).length,1);assert.equal(ids.filter(id=>id===can.id).length,1);
});
