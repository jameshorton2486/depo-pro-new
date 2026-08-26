import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { depositionDirectory } from "./deposition-store.mjs";
import { assembleInsertionInput } from "./insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet } from "./insertion-pages/build-pages.mjs";
import { loadTemplateVariant } from "./insertion-pages/templates.mjs";
import { validateInsertionInput } from "./insertion-pages/validate.mjs";
import { selectInsertionVariant } from "./insertion-pages/variants.mjs";
import { getTranscriptPrintModel } from "./transcript-print-model.mjs";

export const COMPLETE_TRANSCRIPT_MODEL_VERSION="1.0.0";
const FRONT_ROLES=new Set(["title","appearances","index"]);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const value=field=>field&&typeof field==="object"&&"value" in field?field.value:field;

function normalizeAdministrativePage(page,pageNumber){
  return {id:`admin-${page.role}-${pageNumber}`,pageNumber,role:page.role,sectionKind:"administrative",editable:false,
    lines:page.lines.map((line,index)=>({position:index+1,content:String(line.text??""),occupied:Boolean(line.text),paragraphId:null,fragments:[],fields:[...(line.fields??[])]}))};
}

function shiftTestimonyPage(page,pageNumber){
  return {...page,id:`testimony-${pageNumber}`,pageNumber,role:"testimony",sectionKind:"testimony",editable:true,
    lines:page.lines.map(line=>({...line,modelTestimonyPage:page.pageNumber}))};
}

export function completePagination({testimonyPages,signatureDisposition,examinations=[]}){
  const testimonyStart=4,testimonyEnd=testimonyStart+testimonyPages-1;
  const requested=signatureDisposition==="requested",changesStart=requested?testimonyEnd+1:null,certificateStart=testimonyEnd+1+(requested?2:0);
  return {index:{appearances:{startPage:2},examinations:examinations.length?examinations:[{examiner:"EXAMINING ATTORNEY",startPage:testimonyStart,endPage:testimonyEnd}],
    changesAndSignature:requested?{startPage:changesStart,endPage:changesStart+1}:null,
    reportersCertification:{startPage:certificateStart,endPage:certificateStart+(requested?2:1)},entries:[],actualSectionPages:{},declaredSectionPages:{}}};
}

export async function buildCompleteTranscriptModel({depositionId,printModel,record,intake={},operator={},generatedAt="1970-01-01T00:00:00.000Z"}={}){
  if(!printModel?.pages?.length)throw new Error("COMPLETE_TRANSCRIPT_TESTIMONY_REQUIRED");
  const signatureDisposition=operator.signatureDisposition??value(record?.signature?.status);
  const jurisdiction=operator.jurisdiction??value(record?.case?.jurisdictionType);
  const normalizedOperator={...operator,jurisdiction,signatureDisposition};
  const variant=selectInsertionVariant(normalizedOperator);
  if(!variant)throw new Error("COMPLETE_TRANSCRIPT_VARIANT_REQUIRED");
  const template=await loadTemplateVariant(variant);
  if(!template.available)throw new Error(`COMPLETE_TRANSCRIPT_TEMPLATE_UNAVAILABLE:${variant}`);
  const pagination=completePagination({testimonyPages:printModel.pages.length,signatureDisposition,examinations:operator.examinations??[]});
  const input=assembleInsertionInput({record,intake,operator:normalizedOperator,pagination,template});
  const findings=validateInsertionInput(input),blockers=findings.filter(finding=>finding.severity==="blocking");
  if(blockers.length)throw new Error(`COMPLETE_TRANSCRIPT_VALIDATION_BLOCKED:${blockers.map(item=>`${item.code}:${item.target}`).join(",")}`);
  const insertion=buildTexasInsertionPageSet(input,{setId:`complete-${depositionId}`,depositionId,generatedAt});
  const front=insertion.pages.filter(page=>FRONT_ROLES.has(page.role));
  const back=insertion.pages.filter(page=>!FRONT_ROLES.has(page.role));
  const pages=[];
  for(const page of front)pages.push(normalizeAdministrativePage(page,pages.length+1));
  for(const page of printModel.pages)pages.push(shiftTestimonyPage(page,pages.length+1));
  for(const page of back)pages.push(normalizeAdministrativePage(page,pages.length+1));
  const sections=[
    {id:"front-matter",kind:"administrative",roles:front.map(page=>page.role),startPage:1,endPage:front.length},
    {id:"testimony",kind:"testimony",roles:["testimony"],startPage:front.length+1,endPage:front.length+printModel.pages.length,sourceModelHash:printModel.modelHash},
    {id:"back-matter",kind:"administrative",roles:back.map(page=>page.role),startPage:front.length+printModel.pages.length+1,endPage:pages.length},
  ];
  const unsigned={schemaVersion:COMPLETE_TRANSCRIPT_MODEL_VERSION,recordType:"COMPLETE_TRANSCRIPT_DOCUMENT_MODEL",deposition:printModel.deposition,layoutProfile:printModel.layoutProfile,
    source:{testimonyModelHash:printModel.modelHash,reviewStateHash:printModel.source.reviewStateHash,insertionPageSetHash:insertion.sha256,canonicalRecordVersion:record.schemaVersion},
    variant,signatureDisposition,pagination,sections,paragraphs:printModel.paragraphs,pages,findings:{transcript:printModel.findings,assembly:findings}};
  return {...unsigned,modelHash:hash(unsigned)};
}

export async function getCompleteTranscriptModel(root,{depositionId,storageRoot,examinerIdentity=null}={}){
  const directory=depositionDirectory(root,depositionId,{storageRoot}),assemblyFile=path.join(directory,"intake","complete-transcript-assembly.json");
  if(!fs.existsSync(assemblyFile))throw new Error("COMPLETE_TRANSCRIPT_ASSEMBLY_REQUIRED");
  const request=JSON.parse(fs.readFileSync(assemblyFile,"utf8"));
  const record=JSON.parse(fs.readFileSync(path.join(directory,"intake","canonical-deposition-record.json"),"utf8"));
  const intakeFile=path.join(directory,"intake","intake.json"),intake=fs.existsSync(intakeFile)?JSON.parse(fs.readFileSync(intakeFile,"utf8")):{};
  const printModel=getTranscriptPrintModel(root,{depositionId,storageRoot,examinerIdentity});
  return buildCompleteTranscriptModel({depositionId,printModel,record,intake:{...intake,...request.intake},operator:request.operator,generatedAt:request.generatedAt??new Date().toISOString()});
}
