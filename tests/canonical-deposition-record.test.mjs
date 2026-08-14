import assert from "node:assert/strict";
import test from "node:test";
import { CANONICAL_RECORD_VERSION, FIELD_SOURCES, createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";

test("canonical record represents every UFM placeholder family without conflating workflow stages",()=>{
  const record=createCanonicalDepositionRecord({caseStyle:"Garza v. Home Depot",causeNumber:"25-cv-00598-OLG",witness:"Heath Thomas",parties:[{name:"Home Depot U.S.A., Inc.",role:"Defendant",aliases:[{qualifier:"a/k/a",name:"The Home Depot"}]}],attorneys:[{name:"Karen M. Alvarado",represents:["party-1"]}],remote:true,remotePlatform:"Zoom"});
  assert.equal(record.schemaVersion,CANONICAL_RECORD_VERSION);
  for(const path of ["case","parties","deposition","counsel","reporter","participants","transcript","exhibits","signature","certification","nonappearance"])assert.ok(path in record,path);
  assert.ok(Array.isArray(record.transcript.examinations));assert.ok(Array.isArray(record.transcript.certifiedQuestions));assert.ok(Array.isArray(record.signature.errata));assert.ok(Array.isArray(record.certification.attorneyTime));
  assert.equal(record.parties[0].aliases[0].qualifier.value,"a/k/a");assert.equal(record.deposition.actualStart.source,"TRANSCRIPT_DERIVED");assert.equal(record.reporter.csrNumber.source,"REPORTER_PROFILE");
  assert.deepEqual(new Set(FIELD_SOURCES),new Set(["NOD_EXTRACTED","REPORTER_PROFILE","REPORTER_ENTERED","TRANSCRIPT_DERIVED","WORKFLOW_DERIVED","SYSTEM_GENERATED"]));
});
