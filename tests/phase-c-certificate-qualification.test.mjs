import assert from "node:assert/strict";
import test from "node:test";

import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { assembleInsertionInput } from "../server/insertion-pages/assemble.mjs";
import { buildInsertionPageSet } from "../server/insertion-pages/build-pages.mjs";
import { renderInsertionPdf } from "../server/insertion-pages/render-pdf.mjs";
import { loadTemplateVariant } from "../server/insertion-pages/templates.mjs";
import { validateInsertionInput } from "../server/insertion-pages/validate.mjs";

const event = (selection, officerName = "Riley Reporter") => ({
  id:`admin-${selection}`, kind:"OATH_ADMINISTRATION", selection,
  spokenText:selection === "OATH" ? "Do you swear that your testimony will be truthful?" : "Do you affirm that your testimony will be truthful?",
  response:"Yes", officer:{name:officerName,role:"Federal deposition officer"},
  occurredAt:"2026-09-02T15:00:00.000Z", verificationSource:"RECORDED_MEDIA",
  sourceAnchor:"media:recording-1@00:00:24", recordedAt:"2026-09-02T15:01:00.000Z", recordedBy:"Riley Reporter",
});

function federalRecord(selection, review) {
  const record=createCanonicalDepositionRecord({
    court:"UNITED STATES DISTRICT COURT FOR THE WESTERN DISTRICT OF TEXAS",
    causeNumber:"1:26-cv-00042", witness:"Jordan Example", depositionDate:"2026-09-02",
    remote:true, remotePlatform:"Zoom", parties:[], attorneys:[],
    reporterProfile:{name:"Riley Reporter",licenseNumber:"1234",address:"300 Main Street",phone:"210-555-0103"},
  });
  record.case.jurisdictionType={value:"federal"};
  record.openingRecord={schemaVersion:"1.0.0",oathAdministrations:[event(selection)],interpreterAdministrations:[],stipulationEvents:[],closingAttestations:[],auditEvents:[]};
  const reviewId=`review-${review}`;
  record.reviewElection={schemaVersion:"2.0.0",events:[{
    id:reviewId,kind:"RULE_30E_REVIEW_ELECTION",jurisdiction:"federal",status:review,
    requestedBy:review === "REQUESTED" ? "Jordan Example" : null,
    requestedAt:review === "REQUESTED" ? "2026-09-02T16:00:00.000Z" : null,
    sourceAnchor:"transcript:52:18",recordedBy:"Riley Reporter",recordedAt:"2026-09-02T16:01:00.000Z",
  }],notifications:review === "REQUESTED" ? [{id:"notice-1",kind:"RULE_30E_OFFICER_NOTIFICATION",reviewElectionId:reviewId,notifiedAt:"2026-07-01T16:00:00.000Z",officerIdentity:"Riley Reporter",recipient:"Jordan Example",sourceAnchor:"notice:email-1",recordedBy:"Riley Reporter",recordedAt:"2026-07-01T16:01:00.000Z"}]:[],completions:review === "REQUESTED" ? [{id:"complete-1",kind:"RULE_30E_REVIEW_COMPLETION",reviewElectionId:reviewId,disposition:"COMPLETED",completedAt:"2026-07-20T16:00:00.000Z",sourceAnchor:"review:return-1",recordedBy:"Riley Reporter",recordedAt:"2026-07-20T16:01:00.000Z"}]:[],corrections:[],overrides:[]};
  record.certification.certificationDate={value:"2026-09-03"};
  return record;
}

async function federalInput(selection, review, mutate = () => {}) {
  const record=federalRecord(selection,review);
  mutate(record);
  const key=`FEDERAL_${selection}_REVIEW_${review}`;
  const template=await loadTemplateVariant(key);
  return assembleInsertionInput({record,template,operator:{jurisdiction:"federal",signatureDisposition:review === "REQUESTED" ? "requested" : "waived",signatureDispositionBasis:"Recorded at transcript:52:18"}});
}

const textOf = pages => pages.pages.flatMap(page=>page.lines.map(line=>line.text)).join("\n");
const blockers = input => validateInsertionInput(input).filter(item=>item.severity === "blocking");

for (const selection of ["OATH","AFFIRMATION"]) for (const review of ["REQUESTED","NOT_REQUESTED"]) {
  test(`Federal ${selection} plus ${review} selects approved bytes and renders deterministically`, async () => {
    const input=await federalInput(selection,review);
    assert.equal(input.variant,`FEDERAL_${selection}_REVIEW_${review}`);
    assert.equal(input.template.available,true);
    assert.deepEqual(blockers(input),[]);
    const pages=buildInsertionPageSet(input,{setId:"phase-c",depositionId:"DEP-PHASE-C",generatedAt:"2026-09-03T00:00:00.000Z"});
    const text=textOf(pages);
    assert.match(text,new RegExp(`was duly ${selection === "OATH" ? "sworn" : "affirmed"}`));
    assert.match(text,new RegExp(`Review of the transcript or recording was${review === "REQUESTED" ? "" : " not"} requested`));
    assert.match(text,/Certified on September 3, 2026\./);
    assert.doesNotMatch(text,/waiv|submitted.+return within 30 days/i);
    const pdf=renderInsertionPdf(pages,{geometry:{lineNumberLeft:36,textLeft:72,firstLineY:740,lineHeight:24}});
    assert.ok(pdf.length>500);
    assert.ok(pdf.toString("ascii").includes(selection === "OATH" ? "duly sworn" : "duly affirmed"));
  });
}

test("Federal certification fails closed for a different administering officer", async () => {
  const input=await federalInput("OATH","NOT_REQUESTED",record=>{record.openingRecord.oathAdministrations[0].officer.name="Morgan Notary";});
  assert.ok(blockers(input).some(item=>item.code === "FEDERAL_THIRD_PARTY_ADMINISTRATION_UNQUALIFIED"));
});

test("Federal certification fails closed without source evidence", async () => {
  const input=await federalInput("AFFIRMATION","REQUESTED",record=>{record.openingRecord.oathAdministrations[0].sourceAnchor=null;});
  assert.ok(blockers(input).some(item=>item.code === "FEDERAL_ADMINISTRATION_EVIDENCE_REQUIRED"));
});

test("requested review fails closed without notification and while the period is open",async()=>{
  const missing=await federalInput("OATH","REQUESTED",record=>{record.reviewElection.notifications=[];record.reviewElection.completions=[];});
  assert.ok(blockers(missing).some(item=>item.code==="FEDERAL_RULE_30E_NOTIFICATION_REQUIRED"));
  const open=await federalInput("OATH","REQUESTED",record=>{record.reviewElection.notifications[0].notifiedAt="2099-01-01T00:00:00.000Z";record.reviewElection.completions=[];});
  assert.ok(blockers(open).some(item=>item.code==="FEDERAL_RULE_30E_REVIEW_OPEN"));
});

test("only current-effective administration controls Federal wording and the legacy flag cannot override it",async()=>{
  for (const [first,second] of [["OATH","AFFIRMATION"],["AFFIRMATION","OATH"]]) {
    const input=await federalInput(second,"NOT_REQUESTED",record=>{
      const prior=event(first),current=event(second); prior.id=`old-${first}`; current.id=`new-${second}`; current.supersedesEventId=prior.id;
      record.openingRecord.oathAdministrations=[prior,current]; record.deposition.witnessSworn={value:first==="OATH"};
    });
    const text=textOf(buildInsertionPageSet(input,{setId:"supersession",depositionId:"DEP-SUPER",generatedAt:"2026-09-03T00:00:00.000Z"}));
    assert.match(text,new RegExp(`duly ${second==="OATH"?"sworn":"affirmed"}`));
    assert.doesNotMatch(text,new RegExp(`duly ${first==="OATH"?"sworn":"affirmed"}`));
  }
});

test("only current-effective timely Rule 30(e) changes accompany the Federal output",async()=>{
  const input=await federalInput("OATH","REQUESTED",record=>{
    const reviewId=record.reviewElection.events[0].id;
    record.reviewElection.corrections=[
      {id:"change-old",kind:"RULE_30E_CORRECTION",reviewElectionId:reviewId,target:"12:4",originalText:"red",proposedChange:"blue",reason:"First entry",submittedAt:"2026-07-10T00:00:00.000Z",sourceAnchor:"errata:old",recordedBy:"Riley Reporter",recordedAt:"2026-07-10T00:01:00.000Z"},
      {id:"change-current",kind:"RULE_30E_CORRECTION",reviewElectionId:reviewId,target:"12:4",originalText:"red",proposedChange:"green",reason:"Corrected entry",submittedAt:"2026-07-11T00:00:00.000Z",sourceAnchor:"errata:new",recordedBy:"Riley Reporter",recordedAt:"2026-07-11T00:01:00.000Z",supersedesEventId:"change-old"},
      {id:"change-late",kind:"RULE_30E_CORRECTION",reviewElectionId:reviewId,target:"20:8",originalText:"one",proposedChange:"two",reason:"Late entry",submittedAt:"2026-09-01T00:00:00.000Z",sourceAnchor:"errata:late",recordedBy:"Riley Reporter",recordedAt:"2026-09-01T00:01:00.000Z"},
    ];
  });
  assert.deepEqual(blockers(input),[]);
  const text=textOf(buildInsertionPageSet(input,{setId:"changes",depositionId:"DEP-CHANGES",generatedAt:"2026-09-03T00:00:00.000Z"}));
  assert.match(text,/RULE 30\(e\) CHANGES/); assert.match(text,/Change: green/); assert.match(text,/Reason: Corrected entry/);
  assert.doesNotMatch(text,/Change: blue|Change: two|First entry|Late entry/);
});

test("Texas affirmation routes to separate approved bytes while Texas oath remains unchanged", async () => {
  const oath=await loadTemplateVariant("TEXAS_STATE_SIGNATURE_WAIVED");
  const affirmation=await loadTemplateVariant("TEXAS_STATE_AFFIRMATION_SIGNATURE_WAIVED");
  assert.equal(oath.available,true);
  assert.equal(affirmation.available,true);
  assert.notEqual(oath.templates.certification1.sha256,affirmation.templates.certification1.sha256);
  assert.match(oath.templates.certification1.body,/was duly sworn/);
  assert.match(affirmation.templates.certification1.body,/was duly affirmed/);
  assert.doesNotMatch(affirmation.templates.certification1.body,/pains and penalties of perjury/i);
});
