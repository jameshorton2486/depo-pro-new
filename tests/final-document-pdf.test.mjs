import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createTranscriptPdfArtifact, renderFixedPagePdf } from "../server/final-document-pdf.mjs";
import { createFixedPageDocxSpec } from "../server/final-document-docx.mjs";
import { TEXAS_FREELANCE_DEPOSITION_V1 } from "../server/texas-freelance-deposition-profile.mjs";

const lines=Array.from({length:25},(_,index)=>({position:index+1,content:index===0?"    Q.    Searchable transcript text?":"",occupied:index===0,paragraphId:index===0?"p1":null,fragments:[]}));
const model={recordType:"COMPLETE_TRANSCRIPT_DOCUMENT_MODEL",modelHash:"pdf-model",source:{reviewStateHash:"review"},layoutProfile:TEXAS_FREELANCE_DEPOSITION_V1,pages:[{id:"page-1",pageNumber:1,role:"title",sectionKind:"administrative",editable:false,lines}]};

test("complete PDF renders the same fixed-page spec used by Word",()=>{
  const spec=createFixedPageDocxSpec(model),pdf=renderFixedPagePdf(spec),text=pdf.toString("ascii");
  assert.match(text,/Depo-Pro fixed-page transcript/);
  assert.match(text,/Searchable transcript text/);
  assert.match(text,/ re S/,"the measured format box is drawn");
  assert.match(text,/\(25\) Tj/,"all 25 physical line numbers are present");
});

test("complete PDF artifact is written beside the Word artifact",t=>{
  const outputDirectory=fs.mkdtempSync(path.join(os.tmpdir(),"depo-pdf-"));t.after(()=>fs.rmSync(outputDirectory,{recursive:true,force:true}));
  const artifact=createTranscriptPdfArtifact(null,{depositionId:"SYNTHETIC",printModel:model,outputDirectory});
  assert.equal(path.basename(artifact.outputPath),"complete-transcript.pdf");
  assert.equal(artifact.searchable,true);assert.equal(artifact.pages,1);assert.equal(artifact.profile,"TEXAS_FREELANCE_DEPOSITION_V1");
  assert.ok(fs.statSync(artifact.outputPath).size>0);
});
