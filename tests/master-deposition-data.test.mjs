import assert from "node:assert/strict";
import test from "node:test";
import { canonicalInputFromMaster, masterDataFromExtraction, projectDeepgramKeyterms, projectTexasFreelanceUfm } from "../server/master-deposition-data.mjs";
import { reviewedMasterData } from "../app/master-data-review.mjs";

const extracted=()=>masterDataFromExtraction({setup:{caseStyle:"Rivera v. Northgate",causeNumber:"2026-CV-1",witness:"Jordan Rivera",depositionDate:"2026-09-01",parties:["Jordan Rivera"],attorneys:[],confidence:"high"},caption:{court:"District Court",county:"Bexar"},logistics:{remote:false,start_time:"9:30 a.m."},deepgram_keyterms:{terms:[{term:"Jordan Rivera",tier:1},{term:"Northgate",tier:2}]},ufm_registry:{entries:[{canonical:"Jordan Rivera",category:"person",in_keyterms:true}]},speaker_map:[]},{sourceDocument:"notice.pdf"});

test("one extraction record drives setup, Deepgram, and Texas UFM projections",()=>{const master=extracted(),canonical=canonicalInputFromMaster(master),deepgram=projectDeepgramKeyterms(master),ufm=projectTexasFreelanceUfm(master);assert.equal(master.recordType,"MASTER_DEPOSITION_DATA_RECORD");assert.equal(canonical.caseStyle,"Rivera v. Northgate");assert.deepEqual(deepgram.wire,["Jordan Rivera","Northgate"]);assert.equal(ufm.fields.cause_number,"2026-CV-1");assert.equal(ufm.fields.witness_name,"Jordan Rivera")});

test("missing fields do not claim Notice provenance and explicit false survives",()=>{const canonical=canonicalInputFromMaster(extracted());assert.equal(canonical.remote,false);assert.ok(canonical.extractedFields.includes("remote"));assert.ok(!canonical.extractedFields.includes("district"));assert.equal(canonical.district,null)});

// The rules below moved here from app/extracted-fields.mjs, which decided the same question against
// the old `ufmData` copy of the extraction and is now deleted. The question has not changed -- which
// keys may name the document as their source -- only what answers it.

const submit=fields=>{const data=new FormData();for(const [key,value] of Object.entries(fields))data.set(key,String(value??""));return data};
const reviewed=(master,fields)=>canonicalInputFromMaster(reviewedMasterData(master,submit(fields)));

test("an extraction value the reporter edited becomes the reporter's answer",()=>{
  // The review step exists so the reporter can disagree with the extraction. A record that goes on
  // calling the result NOD_EXTRACTED erases that they did.
  const master=()=>masterDataFromExtraction({setup:{caseStyle:"Vasquez v. Central Texas Logistics",causeNumber:"2024-CI-88214",witness:"Dr. Priya Ramanathan"},caption:{court:"DISTRICT COURT",county:"BEXAR COUNTY"}},{sourceDocument:"notice.pdf"});
  const untouched=reviewed(master(),{caseStyle:"Vasquez v. Central Texas Logistics",causeNumber:"2024-CI-88214",witness:"Dr. Priya Ramanathan",canonicalCourt:"DISTRICT COURT",canonicalCounty:"BEXAR COUNTY"});
  assert.ok(untouched.extractedFields.includes("caseStyle")&&untouched.extractedFields.includes("witness")&&untouched.extractedFields.includes("court"));

  const edited=reviewed(master(),{caseStyle:"Vasquez v. Central Texas Logistics, LLC",causeNumber:"2024-CI-88214",witness:"Dr. Priya Ramanathan",canonicalCourt:"DISTRICT COURT",canonicalCounty:"BEXAR COUNTY"});
  assert.ok(!edited.extractedFields.includes("caseStyle"),"the reporter changed it, so it is their answer now");
  assert.equal(edited.caseStyle,"Vasquez v. Central Texas Logistics, LLC","and their answer is the one carried");
  assert.ok(edited.extractedFields.includes("causeNumber"),"the ones they left alone still belong to the Notice");
});

test("a field the extraction never produced is never declared extracted",()=>{
  // However the form is filled in. A value the reporter typed into a blank is theirs by definition.
  const silent=masterDataFromExtraction({setup:{},caption:{},logistics:{}},{sourceDocument:"notice.pdf"});
  const typed=reviewed(silent,{caseStyle:"Typed by the reporter",causeNumber:"Typed too",canonicalCourt:"And this",canonicalRemote:"true",canonicalVideotaped:"false"});
  assert.deepEqual(typed.extractedFields,[],"nothing was extracted, so nothing may claim to have been");
  assert.equal(typed.remote,true,"the reporter's own answers are still carried");
  assert.equal(typed.videotaped,false,"including the ones that are false");
});

test("a deponent type the reporter chose is not one the Notice stated",()=>{
  const stated=masterDataFromExtraction({setup:{deponentType:"Expert witness"}},{sourceDocument:"notice.pdf"});
  assert.ok(reviewed(stated,{deponentType:"Expert witness"}).extractedFields.includes("representativeCapacity"));

  const chosen=masterDataFromExtraction({setup:{}},{sourceDocument:"notice.pdf"});
  assert.ok(!reviewed(chosen,{deponentType:"Party"}).extractedFields.includes("representativeCapacity"),
    "the reporter chose it from the select; the Notice did not");

  // A note is not a field. "Expert witness; deponent" is prose that no option matches, so the
  // reporter's selection replaces it and belongs to them.
  const prose=masterDataFromExtraction({setup:{deponentType:"Expert witness; deponent"}},{sourceDocument:"notice.pdf"});
  assert.ok(!reviewed(prose,{deponentType:"Expert witness"}).extractedFields.includes("representativeCapacity"));
});
