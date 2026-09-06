import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { filingIdentifier, reconcileFilingIdentifier } from "../server/filing-identifier.mjs";
import { certificationRoute } from "../server/insertion-pages/certification-route.mjs";
import { currentCanonicalOpeningFacts } from "../server/canonical-opening-events.mjs";
import { recordReviewElection, currentReviewElection } from "../server/canonical-review-election.mjs";
import { createDeposition } from "../server/deposition-store.mjs";

test("one canonical filing identifier receives a jurisdiction-specific label", () => {
  const record={case:{causeNumber:{value:"1:26-cv-42"},jurisdictionType:{value:"federal"}}};
  assert.deepEqual(filingIdentifier(record), {value:"1:26-cv-42",semantic:"CIVIL_ACTION_NUMBER",displayLabel:"Civil Action No.",legacyPath:"case.causeNumber"});
  assert.equal(filingIdentifier(record,"texas-state").displayLabel,"Cause Number");
  assert.equal(reconcileFilingIdentifier({causeNumber:"1:26-cv-42",filingNumber:"1:26-cv-42"}),"1:26-cv-42");
  assert.throws(()=>reconcileFilingIdentifier({causeNumber:"A",caseNumber:"B"}),/CONFLICTING_FILING_IDENTIFIERS/);
});

test("jurisdiction changes the label but never rewrites a source-established filing identifier", () => {
  const fixtures = [
    ["texas-state", "2025CI06119", "Cause Number"],
    ["texas-state", "2020-CI-12345", "Cause Number"],
    ["federal", "3:08-CV-0001-N", "Civil Action No."],
    ["federal", "3:08-cv-1-n", "Civil Action No."],
  ];
  for (const [jurisdiction, source, displayLabel] of fixtures) {
    const projection = filingIdentifier({case:{causeNumber:{value:source},jurisdictionType:{value:jurisdiction}}});
    assert.equal(projection.value, source);
    assert.equal(projection.displayLabel, displayLabel);
  }
});

test("certification routing preserves oath form and selects approved component combinations", () => {
  assert.deepEqual(certificationRoute({jurisdiction:"texas-state",signatureDisposition:"waived",oathAdministration:{selection:"OATH"}}), {key:"TEXAS_STATE_SIGNATURE_WAIVED",available:true,reason:null});
  assert.deepEqual(certificationRoute({jurisdiction:"texas-state",signatureDisposition:"waived",oathAdministration:{selection:"AFFIRMATION"}}), {key:"TEXAS_STATE_AFFIRMATION_SIGNATURE_WAIVED",available:true,reason:null});
  const federal=certificationRoute({jurisdiction:"federal",oathAdministration:{selection:"AFFIRMATION"},reviewElection:{status:"REQUESTED"}});
  assert.deepEqual(federal,{key:"FEDERAL_AFFIRMATION_REVIEW_REQUESTED",available:true,reason:null});
  assert.equal(certificationRoute({jurisdiction:"federal",oathAdministration:{selection:"OATH"},reviewElection:null}).reason,"CERTIFICATION_FACTS_INCOMPLETE");
});

test("opening corrections retain history and expose the latest effective event", () => {
  const first={id:"one",selection:"OATH"}, second={id:"two",selection:"AFFIRMATION",supersedesEventId:"one"};
  const facts=currentCanonicalOpeningFacts({openingRecord:{oathAdministrations:[first,second]}});
  assert.equal(facts.oathAdministration.id,"two");
  assert.deepEqual(facts.history.oathAdministrations,[first,second]);
});

test("Rule 30(e) election is separately attributable, evidence-backed, and append-only", t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-rule30e-")), storageRoot=path.join(root,"depositions");
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const deposition=createDeposition(root,{deposition:{id:"DEP-20260902-R30E1",caseStyle:"A v. B",witness:"Witness",courtReporterName:"Reporter",causeNumber:"1:26-cv-42",depositionDate:"2026-09-02",jurisdiction:"federal"}},{storageRoot});
  const first=recordReviewElection(root,{depositionId:deposition.id,storageRoot,actor:"LOCAL_API_UNAUTHENTICATED",input:{status:"REQUESTED",requestedBy:"Witness",requestedAt:"2026-09-02T20:00:00Z",sourceAnchor:"transcript:10:2"}});
  assert.equal(first.status,"REQUESTED");
  assert.throws(()=>recordReviewElection(root,{depositionId:deposition.id,storageRoot,actor:"LOCAL_API_UNAUTHENTICATED",input:{status:"NOT_REQUESTED",sourceAnchor:"transcript:11:1"}}),/Explain why/);
  const second=recordReviewElection(root,{depositionId:deposition.id,storageRoot,actor:"LOCAL_API_UNAUTHENTICATED",input:{status:"NOT_REQUESTED",sourceAnchor:"transcript:11:1",correctionReason:"Reporter corrected the selection."}});
  const record=JSON.parse(fs.readFileSync(path.join(storageRoot,...deposition.storagePath.split("/"),"intake","canonical-deposition-record.json"),"utf8"));
  assert.equal(record.reviewElection.events.length,2);
  assert.equal(second.supersedesEventId,first.id);
  assert.equal(currentReviewElection(record).id,second.id);
  assert.equal(record.signature.status.value,null,"Texas signature disposition remains independent");
});
