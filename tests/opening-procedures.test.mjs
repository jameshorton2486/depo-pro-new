import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDeposition } from "../server/deposition-store.mjs";
import { getOpeningProjection, readOpeningState, saveOpeningState } from "../server/opening-procedures.mjs";

function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-opening-")),storageRoot=path.join(root,"depos");
  const deposition=createDeposition(root,{deposition:{id:"DEP-20260821-OPEN1",caseStyle:"Smith v. Jones",causeNumber:"2026-CV-1",witness:"Alex Smith",depositionDate:"2026-08-21",courtReporterName:"Miah Bardot",canonicalSeed:{court:"District Court",county:"Travis",scheduledStart:"09:00",location:"Austin",attorneys:[{name:"Dennis Bentley",firm:"Bentley Law",represents:["Plaintiff"],appearanceRole:"QUESTIONING_ATTORNEY",actualAppearance:true}]}},artifacts:{notice:{name:"notice.pdf",base64:Buffer.from("notice").toString("base64")}}},{storageRoot});
  return{root,storageRoot,deposition};
}

test("canonical values hydrate without becoming verified",t=>{
  const value=fixture();t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));
  const projection=getOpeningProjection(value.root,{depositionId:value.deposition.id,storageRoot:value.storageRoot});
  const caseStyle=projection.fields.find(item=>item.path==="case.caseStyle");
  assert.equal(caseStyle.value,"Smith v. Jones");assert.equal(caseStyle.source,"NOD_EXTRACTED");assert.equal(caseStyle.verified,false);
  assert.equal(projection.state.recordType,"DEPOSITION_OPENING_WORKFLOW");
});

test("verification, applicability, oath selection and completed-on-record survive reopen",t=>{
  const value=fixture();t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));
  const original=readOpeningState(value.root,{depositionId:value.deposition.id,storageRoot:value.storageRoot});
  saveOpeningState(value.root,{depositionId:value.deposition.id,storageRoot:value.storageRoot,state:{...original,verifiedFields:{"case.caseStyle":true},verifiedParticipants:{"attorney-1":true},interpreterDisposition:"NOT_APPLICABLE",witnessOathSelection:"AFFIRMATION",examiningAttorneyId:"attorney-1",scripts:{...original.scripts,opening:{completedOnRecord:true,note:"Read after recording began."}}}});
  const reopened=getOpeningProjection(value.root,{depositionId:value.deposition.id,storageRoot:value.storageRoot});
  assert.equal(reopened.fields.find(item=>item.path==="case.caseStyle").verified,true);
  assert.equal(reopened.participants[0].verified,true);assert.equal(reopened.state.interpreterDisposition,"NOT_APPLICABLE");assert.equal(reopened.state.witnessOathSelection,"AFFIRMATION");
  assert.equal(reopened.scripts.find(item=>item.id==="opening").completedOnRecord,true);
  assert.equal(reopened.scripts.find(item=>item.id==="interpreterOath").applicable,false);
  assert.equal(reopened.readiness.interpreterOath,true);
  // Superseded by ruling: an unapproved script cannot report ready. The selection survives the
  // reopen, which is what this test is about; readiness does not follow from it while the oath text
  // is still a source-required stub. See tests/unapproved-script-cannot-report-ready.test.mjs.
  assert.equal(reopened.state.witnessOathSelection,"AFFIRMATION");
  assert.equal(reopened.readiness.witnessOath,false);
  assert.equal(reopened.readiness.examination,true);
});

test("script rendering warns on missing tokens and never mutates canonical evidence",t=>{
  const value=fixture();t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));
  const canonicalFile=path.join(value.storageRoot,...value.deposition.storagePath.split("/"),"intake","canonical-deposition-record.json"),before=fs.readFileSync(canonicalFile,"utf8");
  const projection=getOpeningProjection(value.root,{depositionId:value.deposition.id,storageRoot:value.storageRoot}),opening=projection.scripts.find(item=>item.id==="opening");
  assert.ok(opening.missing.includes("ACTUAL TIME"));assert.match(opening.text,/\[ACTUAL TIME\]/);
  saveOpeningState(value.root,{depositionId:value.deposition.id,storageRoot:value.storageRoot,state:{...projection.state,witnessOathSelection:"OATH"}});
  assert.equal(fs.readFileSync(canonicalFile,"utf8"),before);
  assert.equal(fs.existsSync(path.join(value.storageRoot,...value.deposition.storagePath.split("/"),"transcript","working.json")),false);
});

test("Not Applicable is not Missing and readiness never becomes a recording gate",t=>{
  const value=fixture();t.after(()=>fs.rmSync(value.root,{recursive:true,force:true}));
  const state=readOpeningState(value.root,{depositionId:value.deposition.id,storageRoot:value.storageRoot});
  saveOpeningState(value.root,{depositionId:value.deposition.id,storageRoot:value.storageRoot,state:{...state,interpreterDisposition:"NOT_APPLICABLE"}});
  const projection=getOpeningProjection(value.root,{depositionId:value.deposition.id,storageRoot:value.storageRoot});
  assert.equal(projection.readiness.interpreterOath,true);assert.ok(projection.completeCount<projection.totalCount);
  assert.equal("recordingBlocked" in projection,false);
});
