import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { getSpeakerCandidates } from "../server/transcription-jobs.mjs";
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
  assert.match(intake,/parties\s*:\s*string\[\][\s\S]*?attorneys\s*:\s*IntakeAttorney\[\]/,"IntakeDraft must declare both");
  assert.match(intake,/parties\s*:\s*analysis\.parties\s*\|\|\s*\[\][\s\S]*?attorneys\s*:\s*analysis\.attorneys\s*\|\|\s*\[\]/,"onContinue must carry both");
  assert.match(page,/parties: intakeDraft\?\.parties \?\? \[\]/);
  assert.match(page,/attorneys: intakeDraft\?\.attorneys \?\? \[\]/);
});

import os from "node:os";
import path from "node:path";
import { counselEntry } from "../server/canonical-deposition-record.mjs";
import { writeDepositionCounsel } from "../server/deposition-store.mjs";

function depositionFixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"depo-counsel-")),storageRoot=path.join(root,"depos");
  const directory=path.join(storageRoot,"reporter","cause","deposition");
  fs.mkdirSync(path.join(directory,"intake"),{recursive:true});
  fs.writeFileSync(path.join(directory,"deposition.json"),JSON.stringify({id:"DEP-20260814-ABCDE"}));
  fs.writeFileSync(path.join(directory,"intake","canonical-deposition-record.json"),
    JSON.stringify(createCanonicalDepositionRecord({ witness:"Heath Thomas", attorneys:[], parties:[] })));
  return { root, storageRoot, directory };
}
const written = value => JSON.parse(fs.readFileSync(path.join(value.directory,"intake","canonical-deposition-record.json"),"utf8"));

test("reporter-typed counsel is never recorded as having come off the Notice",()=>{
  // The requirement this endpoint exists to satisfy. createCanonicalDepositionRecord stamps every
  // counsel field NOD_EXTRACTED, so routing typed names through it unchanged would assert the
  // Notice said something it never said -- worse than the hand-edit it replaces, because a
  // hand-edit at least leaves a modification time. Asserted on every field, not just the name.
  const value=depositionFixture();
  try{
    writeDepositionCounsel(null,{ depositionId:"DEP-20260814-ABCDE", storageRoot:value.storageRoot,
      counsel:[{ name:"Dennis J. Bentley", firm:"Marco Crawford Law, PLLC", represents:"Plaintiff", appearanceRole:"QUESTIONING_ATTORNEY" }] });
    const [entry]=written(value).counsel;
    for(const [key,field] of Object.entries(entry)){
      if(key==="id") continue;
      assert.equal(field.source,"REPORTER_ENTERED",`${key} must be REPORTER_ENTERED, not ${field.source}`);
      assert.ok(["REPORTER_ADDED","MISSING"].includes(field.state),`${key} state was ${field.state}`);
    }
    assert.equal(entry.fullName.state,"REPORTER_ADDED");
    assert.equal(entry.honorific.state,"MISSING","an absent field is missing, not added");
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});

test("counsel that did come off the Notice still says so",()=>{
  // The other half: narrowing the typed path must not relabel extraction.
  const record=createCanonicalDepositionRecord({ attorneys:[{ name:"Dennis J. Bentley", firm:"F", represents:"Plaintiff" }] });
  assert.equal(record.counsel[0].fullName.source,"NOD_EXTRACTED");
  assert.equal(record.counsel[0].fullName.state,"EXTRACTED");
  assert.equal(counselEntry({ name:"X" },0).fullName.source,"NOD_EXTRACTED");
});

test("the counsel write touches counsel and nothing else",()=>{
  // Narrowness is the safety property. A counsel entry must not be able to disturb a witness, a
  // reporter profile, or anything else a certified record is built from.
  const value=depositionFixture();
  try{
    const before=written(value);
    writeDepositionCounsel(null,{ depositionId:"DEP-20260814-ABCDE", storageRoot:value.storageRoot, counsel:[{ name:"Dennis J. Bentley" }] });
    const after=written(value);
    for(const key of Object.keys(before)){
      if(key==="counsel") continue;
      assert.deepEqual(after[key],before[key],`${key} must be untouched`);
    }
    assert.equal(after.counsel.length,1);
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});

test("a nameless entry and an unsupported role are both refused",()=>{
  const value=depositionFixture();
  try{
    const call=counsel=>()=>writeDepositionCounsel(null,{ depositionId:"DEP-20260814-ABCDE", storageRoot:value.storageRoot, counsel });
    assert.throws(call([{ firm:"F" }]),/requires a name/);
    assert.throws(call([{ name:"X", appearanceRole:"EXAMINER" }]),/Unsupported appearance role/);
    // Refused means nothing was written, not partly written.
    assert.equal(written(value).counsel.length,0);
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});

test("typed counsel reaches the speaker candidates",()=>{
  // The reason the endpoint exists: without counsel the Label panel offers only the witness and
  // the reporter, and no attorney line can be assigned.
  const value=depositionFixture();
  try{
    writeDepositionCounsel(null,{ depositionId:"DEP-20260814-ABCDE", storageRoot:value.storageRoot,
      counsel:[{ name:"Dennis J. Bentley", appearanceRole:"QUESTIONING_ATTORNEY" },{ name:"Christian R. Ramon", appearanceRole:"DEFENDING_ATTORNEY" }] });
    const { candidates }=getSpeakerCandidates(null,{ depositionId:"DEP-20260814-ABCDE", storageRoot:value.storageRoot });
    assert.deepEqual(candidates.map(item=>item.id),["witness","reporter","attorney-1","attorney-2"]);
    assert.equal(candidates.find(item=>item.id==="attorney-2").defaultRole,"DEFENDING_ATTORNEY");
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});

test("counsel of record and counsel who appeared are both kept, and only one can speak",()=>{
  // The Heath Thomas case. The Notice named Karen M. Alvarado for Home Depot; Lucia D. Zhan
  // appeared in her place and stated her appearance on the record. Writing the Notice's roster
  // alone would have put an attorney who was not there into the speaker list and left out the
  // one who defended the deposition. Both belong in counsel[]; only one is a candidate.
  const value=depositionFixture();
  try{
    writeDepositionCounsel(null,{ depositionId:"DEP-20260814-ABCDE", storageRoot:value.storageRoot, counsel:[
      { name:"Steven A. Nunez", appearanceRole:"QUESTIONING_ATTORNEY", actualAppearance:true },
      { name:"Lucia D. Zhan", appearanceRole:"DEFENDING_ATTORNEY", actualAppearance:true },
      { name:"Karen M. Alvarado", appearanceRole:null, actualAppearance:false },
    ]});
    const written=JSON.parse(fs.readFileSync(path.join(value.directory,"intake","canonical-deposition-record.json"),"utf8"));
    assert.equal(written.counsel.length,3,"all three stay in the record for the appearance page");
    assert.equal(written.counsel[2].actualAppearance.value,false);

    const { candidates }=getSpeakerCandidates(null,{ depositionId:"DEP-20260814-ABCDE", storageRoot:value.storageRoot });
    assert.deepEqual(candidates.map(item=>item.label),["Heath Thomas","Court Reporter","Steven A. Nunez","Lucia D. Zhan"],
      "the attorney of record who did not appear is not offered as a speaker");
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});

test("a party is never a speaker candidate, whoever they are",()=>{
  // Speaker eligibility is a fact about the recording, not about the case. Parties are who the
  // case is between; nothing about being named in a caption puts a person in the room. Asserted
  // for a party who shares a surname with counsel and for one who does not, because the risk is
  // a future change sourcing candidates from the caption for convenience.
  const value=depositionFixture();
  try{
    const file=path.join(value.directory,"intake","canonical-deposition-record.json");
    const record=JSON.parse(fs.readFileSync(file,"utf8"));
    record.parties=[
      { id:"party-1", name:{ value:"Delia Garza", source:"NOD_EXTRACTED", state:"EXTRACTED" } },
      { id:"party-2", name:{ value:"Home Depot U.S.A., Inc.", source:"NOD_EXTRACTED", state:"EXTRACTED" } },
      { id:"party-3", name:{ value:"Shawn Herber", source:"NOD_EXTRACTED", state:"EXTRACTED" } },
    ];
    fs.writeFileSync(file,JSON.stringify(record));
    writeDepositionCounsel(null,{ depositionId:"DEP-20260814-ABCDE", storageRoot:value.storageRoot,
      counsel:[{ name:"Steven A. Nunez", appearanceRole:"QUESTIONING_ATTORNEY", actualAppearance:true }] });

    const { candidates }=getSpeakerCandidates(null,{ depositionId:"DEP-20260814-ABCDE", storageRoot:value.storageRoot });
    const labels=candidates.map(item=>item.label);
    for (const party of ["Delia Garza","Home Depot U.S.A., Inc.","Shawn Herber"]) {
      assert.equal(labels.includes(party),false,`${party} is a party and must not be offered as a speaker`);
    }
    assert.deepEqual(labels,["Heath Thomas","Court Reporter","Steven A. Nunez"]);
    // And the parties survive the counsel write, because counsel[] is the only key it touches.
    assert.equal(JSON.parse(fs.readFileSync(file,"utf8")).parties.length,3);
  }finally{fs.rmSync(value.root,{recursive:true,force:true})}
});
