import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { buildCompleteTranscriptModel } from "../server/complete-transcript-model.mjs";
import { createFixedPageDocxSpec } from "../server/final-document-docx.mjs";
import { TEXAS_FREELANCE_DEPOSITION_V1 } from "../server/texas-freelance-deposition-profile.mjs";

const lines=(page)=>Array.from({length:25},(_,index)=>({position:index+1,content:index===0?`    Q.    Synthetic testimony page ${page}.`:"",occupied:index===0,paragraphId:index===0?`p${page}`:null,fragments:index===0?[{id:`f${page}`,kind:"evidence",role:"word",text:`Synthetic testimony page ${page}.`,sourceWordId:`w${page}`}]:[]}));
const printModel={recordType:"TRANSCRIPT_PRINT_MODEL",modelHash:"testimony-hash",source:{reviewStateHash:"review-hash"},deposition:{id:"DEP-20260826-M2FIX",caseStyle:"Alex Plaintiff v. Delta Company",witness:"Jordan Example",causeNumber:"2026-CI-10001",depositionDate:"2026-08-01"},layoutProfile:TEXAS_FREELANCE_DEPOSITION_V1,paragraphs:[{id:"p1",text:"Synthetic testimony"}],pages:[{id:"body-1",pageNumber:1,lines:lines(1)},{id:"body-2",pageNumber:2,lines:lines(2)}],findings:{transcript:[],print:[]}};

function canonicalRecord(){return createCanonicalDepositionRecord({jurisdictionType:"texas-state",court:"45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS",causeNumber:"2026-CI-10001",caseStyle:"Alex Plaintiff v. Delta Company",witness:"Jordan Example",depositionDate:"2026-08-01",remote:false,location:"San Antonio, Texas",parties:[{name:"Alex Plaintiff",role:"Plaintiff"},{name:"Delta Company",role:"Defendant"}],attorneys:[{name:"Pat Counsel",firm:"Plaintiff Firm",address:"100 Main, San Antonio, Texas",phone:"210-555-0101",represents:["Alex Plaintiff"],actualAppearance:true},{name:"Dana Counsel",firm:"Defense Firm",address:"200 Main, San Antonio, Texas",phone:"210-555-0102",represents:["Delta Company"],actualAppearance:true}],reporterProfile:{name:"Riley Reporter",licenseNumber:"1234",csrExpiration:"2027-12-31",company:"Reporter Firm",firmRegistrationNumber:"5678",address:"300 Main, San Antonio, Texas",phone:"210-555-0103"}})}

const operator={jurisdiction:"texas-state",signatureDisposition:"requested",signatureDispositionBasis:"Stated on the record",courtHeadingLine:"IN THE DISTRICT COURT OF",countyCourtLine:"BEXAR COUNTY, TEXAS",judicialDistrictLine:"45TH JUDICIAL DISTRICT",proceedingHeading:"ORAL DEPOSITION OF",titleNarrative:["Jordan Example, produced as a witness and duly sworn,","was taken remotely before Riley Reporter,","Certified Shorthand Reporter in and for Texas."],certification:{custodialAttorney:"Pat Counsel",charges:"500.00",chargesResponsibleParty:"Plaintiff",serviceDate:"August 14, 2026",certificationDate:"August 14, 2026",furtherCertificationDate:"August 30, 2026",returnStatus:"Returned August 28, 2026"},timeUsed:{totalOnRecordMinutes:120,parties:[{name:"Pat Counsel",minutes:60},{name:"Dana Counsel",minutes:60}]},examinations:[{examiner:"Pat Counsel",startPage:4,endPage:5}]};

test("complete model assembles approved front matter, unchanged testimony, and conditional back matter",async()=>{
  const model=await buildCompleteTranscriptModel({depositionId:"DEP-20260826-M2FIX",printModel,record:canonicalRecord(),intake:{counselOfRecord:["Pat Counsel","Dana Counsel"]},operator,generatedAt:"2026-08-26T12:00:00.000Z"});
  assert.equal(model.recordType,"COMPLETE_TRANSCRIPT_DOCUMENT_MODEL");
  assert.deepEqual(model.pages.map(page=>page.role),["title","appearances","index","testimony","testimony","changes","signature","certification1","certification2","certification3"]);
  assert.equal(model.pages.every(page=>page.lines.length===25),true);
  assert.deepEqual(model.pages.slice(3,5).map(page=>page.lines),printModel.pages.map((page,pageIndex)=>page.lines.map(line=>({...line,modelTestimonyPage:pageIndex+1}))));
  assert.equal(model.pagination.index.reportersCertification.startPage,8);
  assert.match(model.pages[2].lines.map(line=>line.content).join("\n"),/Pat Counsel.*4-5/);
  assert.doesNotMatch(model.pages[1].lines.map(line=>line.content).join("\n"),/Via null|Via undefined/);
  const spec=createFixedPageDocxSpec(model);
  assert.equal(spec.documentRecordType,"COMPLETE_TRANSCRIPT_DOCUMENT_MODEL");
  assert.deepEqual(spec.pages.map(page=>page.sectionKind),["administrative","administrative","administrative","testimony","testimony","administrative","administrative","administrative","administrative","administrative"]);
  assert.deepEqual(spec.pages[3].lines[0].sourceWordIds,["w1"]);
});

test("waived signature omits changes and signature pages",async()=>{
  const model=await buildCompleteTranscriptModel({depositionId:"DEP-20260826-M2FIX",printModel:{...printModel,pages:[printModel.pages[0]]},record:canonicalRecord(),operator:{...operator,signatureDisposition:"waived",examinations:[]},generatedAt:"2026-08-26T12:00:00.000Z"});
  assert.deepEqual(model.pages.map(page=>page.role),["title","appearances","index","testimony","certification1","certification2"]);
  assert.equal(model.pagination.index.reportersCertification.startPage,5);
});
