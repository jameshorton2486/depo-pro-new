import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDeposition } from "../server/deposition-store.mjs";
import { recordReviewElection,recordReviewNotification,recordReviewCompletion,recordReviewCorrection,recordReviewOverride,resolveReviewLifecycle } from "../server/canonical-review-election.mjs";

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-rule30e-life-")),storageRoot=path.join(root,"depositions");
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const deposition=createDeposition(root,{deposition:{id:`DEP-20260902-${crypto.randomUUID().replaceAll("-","").slice(0,5).toUpperCase()}`,caseStyle:"A v. B",witness:"Jordan Example",courtReporterName:"Riley Reporter",causeNumber:"1:26-cv-42",depositionDate:"2026-09-02",jurisdiction:"federal"}},{storageRoot});
  const file=path.join(storageRoot,...deposition.storagePath.split("/"),"intake","canonical-deposition-record.json"), read=()=>JSON.parse(fs.readFileSync(file,"utf8"));
  return {root,storageRoot,deposition,file,read,actor:"Riley Reporter"};
}
const base={sourceAnchor:"transcript:52:18"};

test("Rule 30(e) requested lifecycle derives its deadline and remains blocked until terminal",t=>{
  const f=fixture(t), election=recordReviewElection(f.root,{...f, depositionId:f.deposition.id,input:{...base,status:"REQUESTED",requestedBy:"Jordan Example",requestedAt:"2026-09-02T16:00:00Z"}});
  assert.equal(resolveReviewLifecycle(f.read()).status,"AWAITING_NOTIFICATION");
  const notice=recordReviewNotification(f.root,{...f,depositionId:f.deposition.id,input:{sourceAnchor:"email:notice-1",notifiedAt:"2026-09-03T15:00:00Z",officerIdentity:"Riley Reporter",recipient:"Jordan Example",method:"email"}});
  let state=resolveReviewLifecycle(f.read(),{asOf:"2026-09-04T00:00:00Z"});
  assert.equal(state.status,"OPEN"); assert.equal(state.terminal,false); assert.equal(state.deadline,"2026-10-03T15:00:00.000Z");
  const corrected=recordReviewNotification(f.root,{...f,depositionId:f.deposition.id,input:{sourceAnchor:"email:notice-2",notifiedAt:"2026-09-04T15:00:00Z",officerIdentity:"Riley Reporter",recipient:"Jordan Example",method:"email",correctionReason:"Corrected sent timestamp."}});
  state=resolveReviewLifecycle(f.read(),{asOf:"2026-09-05T00:00:00Z"}); assert.equal(state.notification.id,corrected.id); assert.equal(state.deadline,"2026-10-04T15:00:00.000Z"); assert.equal(state.history.notifications.length,2); assert.equal(corrected.supersedesEventId,notice.id); assert.equal(state.election.id,election.id);
  recordReviewCompletion(f.root,{...f,depositionId:f.deposition.id,input:{sourceAnchor:"review:completion",completedAt:"2026-09-20T16:00:00Z",disposition:"COMPLETED"}});
  state=resolveReviewLifecycle(f.read(),{asOf:"2026-09-21T00:00:00Z"}); assert.equal(state.status,"COMPLETED"); assert.equal(state.terminal,true);
});

test("timely corrections qualify, superseded text cannot leak, and late changes require authority",t=>{
  const f=fixture(t); recordReviewElection(f.root,{...f,depositionId:f.deposition.id,input:{...base,status:"REQUESTED",requestedBy:"Jordan Example",requestedAt:"2026-09-02T16:00:00Z"}});
  recordReviewNotification(f.root,{...f,depositionId:f.deposition.id,input:{sourceAnchor:"email:notice",notifiedAt:"2026-09-03T15:00:00Z",officerIdentity:"Riley Reporter",recipient:"Jordan Example"}});
  const first=recordReviewCorrection(f.root,{...f,depositionId:f.deposition.id,input:{sourceAnchor:"errata:1",target:"12:4",originalText:"red",proposedChange:"blue",reason:"Correction of color",submittedAt:"2026-09-10T12:00:00Z"}});
  const revised=recordReviewCorrection(f.root,{...f,depositionId:f.deposition.id,input:{sourceAnchor:"errata:2",target:"12:4",originalText:"red",proposedChange:"green",reason:"Corrected color",submittedAt:"2026-09-11T12:00:00Z",supersedesEventId:first.id,correctionReason:"The proposed word was entered incorrectly."}});
  const late=recordReviewCorrection(f.root,{...f,depositionId:f.deposition.id,input:{sourceAnchor:"errata:late",target:"20:8",originalText:"one",proposedChange:"two",reason:"Correct number",submittedAt:"2026-10-10T12:00:00Z"}});
  let state=resolveReviewLifecycle(f.read(),{asOf:"2026-10-11T00:00:00Z"}); assert.deepEqual(state.qualifyingCorrections.map(x=>x.id),[revised.id]); assert.equal(state.lateCorrections[0].id,late.id); assert.equal(state.history.corrections.length,3);
  assert.throws(()=>recordReviewOverride(f.root,{...f,depositionId:f.deposition.id,input:{effect:"ACCEPT_LATE_CORRECTION",authorityType:"RULE_29_STIPULATION",affectedCorrectionId:late.id,effectiveAt:"2026-10-11T12:00:00Z",affectedRule:"late correction",participantsOrAuthority:"Counsel",governingTextOrReference:"Exact recorded stipulation text",sourceAnchor:""}}),/anchor/);
  recordReviewOverride(f.root,{...f,depositionId:f.deposition.id,input:{effect:"ACCEPT_LATE_CORRECTION",authorityType:"RULE_29_STIPULATION",affectedCorrectionId:late.id,effectiveAt:"2026-10-11T12:00:00Z",affectedRule:"late correction",participantsOrAuthority:"Counsel for all parties",governingTextOrReference:"Exact recorded stipulation text",sourceAnchor:"transcript:90:1"}});
  state=resolveReviewLifecycle(f.read(),{asOf:"2026-10-12T00:00:00Z"}); assert.deepEqual(state.qualifyingCorrections.map(x=>x.id),[revised.id,late.id]);
});

test("not requested is terminal without a fictitious period; requested review expires deterministically",t=>{
  const a=fixture(t); recordReviewElection(a.root,{...a,depositionId:a.deposition.id,input:{...base,status:"NOT_REQUESTED"}}); let state=resolveReviewLifecycle(a.read()); assert.equal(state.status,"NOT_REQUESTED"); assert.equal(state.terminal,true); assert.equal(state.deadline,null);
  const b=fixture(t); recordReviewElection(b.root,{...b,depositionId:b.deposition.id,input:{...base,status:"REQUESTED",requestedBy:"Jordan Example",requestedAt:"2026-01-01T00:00:00Z"}}); recordReviewNotification(b.root,{...b,depositionId:b.deposition.id,input:{sourceAnchor:"email:notice",notifiedAt:"2026-01-02T00:00:00Z",officerIdentity:"Riley Reporter",recipient:"Jordan Example"}}); state=resolveReviewLifecycle(b.read(),{asOf:"2026-02-02T00:00:01Z"}); assert.equal(state.status,"EXPIRED"); assert.equal(state.terminal,true);
});
