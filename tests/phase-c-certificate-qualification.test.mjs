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
  record.reviewElection={schemaVersion:"1.0.0",events:[{
    id:`review-${review}`,kind:"RULE_30E_REVIEW_ELECTION",jurisdiction:"federal",status:review,
    requestedBy:review === "REQUESTED" ? "Jordan Example" : null,
    requestedAt:review === "REQUESTED" ? "2026-09-02T16:00:00.000Z" : null,
    sourceAnchor:"transcript:52:18",recordedBy:"Riley Reporter",recordedAt:"2026-09-02T16:01:00.000Z",
  }]};
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
