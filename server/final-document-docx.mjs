import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { depositionDirectory } from "./deposition-store.mjs";

const renderer=fileURLToPath(new URL("./fixed-page-docx-renderer.py",import.meta.url));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const sha=value=>crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

export function createFixedPageDocxSpec(printModel){
  if(printModel?.layoutProfile?.id!=="TEXAS_FREELANCE_DEPOSITION_V1")throw new Error("FIXED_DOCX_PROFILE_REQUIRED");
  const pages=(printModel.pages??[]).map(page=>({id:page.id,pageNumber:page.pageNumber,role:page.role??"testimony",sectionKind:page.sectionKind??"testimony",editable:page.editable!==false,lines:page.lines.map(line=>({position:line.position,text:line.content,occupied:line.occupied,paragraphId:line.paragraphId,fragmentIds:(line.fragments??[]).map(fragment=>fragment.id),sourceWordIds:(line.fragments??[]).map(fragment=>fragment.sourceWordId).filter(Boolean),fields:line.fields??[]}))}));
  if(!pages.length||pages.some(page=>page.lines.length!==printModel.layoutProfile.linesPerPage))throw new Error("FIXED_DOCX_25_LINE_PAGES_REQUIRED");
  const overflow=pages.flatMap(page=>page.lines.filter(line=>String(line.text??"").length>printModel.layoutProfile.charactersPerLine));
  if(overflow.length)throw new Error("FIXED_DOCX_HORIZONTAL_OVERFLOW");
  const unsigned={schemaVersion:"1.1.0",recordType:"FIXED_PAGE_DOCX_RENDERING_SPEC",documentRecordType:printModel.recordType??"TRANSCRIPT_PRINT_MODEL",renderer:"DEPO_PRO_INTERNAL_FIXED_PAGE_OOXML_V1",modelHash:printModel.modelHash,source:printModel.source,profile:printModel.layoutProfile,pages};
  return{...unsigned,sha256:sha(unsigned)};
}

function writeAtomic(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temporary=`${file}.${crypto.randomUUID()}.tmp`;fs.writeFileSync(temporary,JSON.stringify(value,null,2),"utf8");fs.renameSync(temporary,file)}

export function createTranscriptDocxArtifact(root,{depositionId,printModel,storageRoot,outputDirectory=null}={}){
  const directory=outputDirectory?path.resolve(outputDirectory):path.join(depositionDirectory(root,depositionId,{storageRoot}),"transcript");
  const complete=printModel?.recordType==="COMPLETE_TRANSCRIPT_DOCUMENT_MODEL",stem=complete?"complete-transcript":"professional-testimony";
  const spec=createFixedPageDocxSpec(printModel),specPath=path.join(directory,`${stem}-rendering-spec.json`),outputPath=path.join(directory,`${stem}.docx`),mappingPath=path.join(directory,`${stem}-line-map.json`);
  writeAtomic(specPath,spec);
  const python=process.env.DEPO_PRO_PYTHON??"python";
  const result=spawnSync(python,[renderer,"--spec",specPath,"--output",outputPath,"--mapping",mappingPath],{encoding:"utf8",windowsHide:true});
  if(result.status!==0)throw new Error(`FIXED_PAGE_DOCX_RENDER_FAILED: ${(result.stderr||result.stdout||"unknown renderer error").trim()}`);
  return{outputPath,specPath,mappingPath,bytes:fs.statSync(outputPath).size,specSha256:spec.sha256,renderer:JSON.parse(result.stdout.trim())};
}
