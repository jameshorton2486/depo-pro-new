import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { extractionTool } from "../server/extraction-schema.mjs";
import { buildSpeakerLabels } from "../server/transcript-labels.mjs";

const APP = new URL("../app/", import.meta.url);
const read = name => fs.readFileSync(new URL(name, APP), "utf8");

// Exactly what the Notice supplies for this deposition, including the two bar numbers.
const ATTORNEYS = [
  { name:"Dennis J. Bentley", firm:"Marco Crawford Law, PLLC", represents:"Plaintiff", email:"dbentley@marcocrawfordlaw.com", phone:"(210) 756-5400", barNumber:"24079654", address:"8200 IH-10 West, Suite 103, San Antonio, TX 78230", appearanceRole:"QUESTIONING_ATTORNEY" },
  { name:"Marco A. Crawford", firm:"Marco Crawford Law, PLLC", represents:"Plaintiff", email:"marco@marcocrawfordlaw.com", phone:"(210) 756-5400", barNumber:"24068756" },
  { name:"Christian R. Ramon", firm:"Vidaurri, Rodriguez & Reyna, LLC", represents:"Defendants Koepke and Standing Seam", email:"cramon@vrrtxlaw.com", phone:"956-381-6602", address:"202 N. 10th Avenue, Edinburg, Texas 78541", appearanceRole:"DEFENDING_ATTORNEY" },
];
const PARTIES = ["Rocio Laura Elizondo Vargas","Leonardo Isaias Rodriguez","Sandy Dean Koepke","Standing Seam & Specialty Company, Inc."];

test("the extraction schema asks for bar number, address, appearance role and honorific",()=>{
  const attorney = extractionTool.input_schema.properties.setup.properties.attorneys.items;
  for (const field of ["name","firm","represents","email","phone","barNumber","address","appearanceRole","honorific"]) {
    assert.ok(field in attorney.properties,`setup.attorneys must offer ${field}`);
  }
});

test("none of the new attorney fields are required, so nothing is invented to fill them",()=>{
  // A required bar number invites a value where the document supplies none, and a hallucinated
  // bar number on a court record is worse than a blank one the reporter fills in.
  const attorney = extractionTool.input_schema.properties.setup.properties.attorneys.items;
  for (const field of ["barNumber","address","appearanceRole","honorific"]) {
    assert.equal(attorney.required.includes(field),false,`${field} must stay optional`);
  }
});

test("attorneys and parties reach counsel[] and parties[] in the canonical record",()=>{
  const record = createCanonicalDepositionRecord({ attorneys:ATTORNEYS, parties:PARTIES, witness:"Mohammad Etminan, M.D." });
  assert.equal(record.counsel.length,3);
  assert.equal(record.parties.length,4);
  const names = record.counsel.map(item => item.fullName.value);
  for (const expected of ["Dennis J. Bentley","Marco A. Crawford","Christian R. Ramon"]) assert.ok(names.includes(expected),`${expected} must reach counsel[]`);
});

test("bar numbers survive to the canonical record",()=>{
  const record = createCanonicalDepositionRecord({ attorneys:ATTORNEYS, parties:PARTIES });
  const bentley = record.counsel.find(item => item.fullName.value === "Dennis J. Bentley");
  const crawford = record.counsel.find(item => item.fullName.value === "Marco A. Crawford");
  assert.equal(bentley.barNumber.value,"24079654");
  assert.equal(crawford.barNumber.value,"24068756");
  assert.equal(bentley.address.value,"8200 IH-10 West, Suite 103, San Antonio, TX 78230");
  assert.equal(bentley.appearanceRole.value,"QUESTIONING_ATTORNEY");
});

test("an absent bar number is recorded as missing, never guessed",()=>{
  const record = createCanonicalDepositionRecord({ attorneys:[{ name:"Christian R. Ramon" }] });
  assert.equal(record.counsel[0].barNumber.value,null);
});

test("honorific is carried when supplied and null when not",()=>{
  const record = createCanonicalDepositionRecord({ attorneys:[{ name:"Dennis J. Bentley", honorific:"MR." },{ name:"Christian R. Ramon" }] });
  assert.equal(record.counsel[0].honorific.value,"MR.");
  assert.equal(record.counsel[1].honorific.value,null);
});

test("a counsel record with no honorific still raises HONORIFIC_MISSING downstream",()=>{
  // The Step 2 path must keep working now that the field exists. A present-but-null honorific
  // must behave exactly like an absent one -- otherwise adding the field silently disables the
  // finding that stops a wrong title reaching a court record.
  const record = createCanonicalDepositionRecord({ attorneys:[{ name:"Christian R. Ramon" }] });
  const candidate = { id:record.counsel[0].id, label:record.counsel[0].fullName.value, defaultRole:"DEFENDING_ATTORNEY", honorific:record.counsel[0].honorific.value };
  const { labels, findings } = buildSpeakerLabels([candidate]);
  assert.equal(labels[candidate.id],"RAMON");
  assert.deepEqual(findings.map(finding => finding.code),["HONORIFIC_MISSING"]);
});

test("a supplied honorific produces the transcript label and no finding",()=>{
  const record = createCanonicalDepositionRecord({ attorneys:[{ name:"Dennis J. Bentley", honorific:"MR." }] });
  const candidate = { id:record.counsel[0].id, label:record.counsel[0].fullName.value, defaultRole:"QUESTIONING_ATTORNEY", honorific:record.counsel[0].honorific.value };
  const { labels, findings } = buildSpeakerLabels([candidate]);
  assert.equal(labels[candidate.id],"MR. BENTLEY");
  assert.deepEqual(findings,[]);
});

test("the intake draft and the deposition payload both carry parties and attorneys",()=>{
  // The single point of loss in the previous code: the draft listed its fields one by one and
  // omitted both, so counsel[] arrived empty however good the extraction was. Read from source
  // because nothing about the omission looked wrong at the call site.
  const intake = read("IntakeScreen.tsx"), page = read("page.tsx");
  assert.match(intake,/parties:string\[\];attorneys:IntakeAttorney\[\]/,"IntakeDraft must declare both");
  assert.match(intake,/parties:analysis\.parties\|\|\[\],attorneys:analysis\.attorneys\|\|\[\]/,"onContinue must carry both");
  assert.match(page,/parties: intakeDraft\?\.parties \?\? \[\]/);
  assert.match(page,/attorneys: intakeDraft\?\.attorneys \?\? \[\]/);
});
