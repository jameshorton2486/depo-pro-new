import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { addCanonicalOath } from "./canonical-oath-fixture.mjs";
import { buildCompleteTranscriptModel } from "../server/complete-transcript-model.mjs";
import { TEXAS_FREELANCE_DEPOSITION_V1 } from "../server/texas-freelance-deposition-profile.mjs";

// A fixture that renders a certificate has to carry what the certificate asserts. The caption
// parties were already here for that reason; the oath is the same class of fact. Attesting it is
// not scaffolding to get past validation -- an unattested record now refuses, correctly, because
// the page states the witness was duly sworn.
const attested = (input) => {
  const rec = createCanonicalDepositionRecord(input);
  rec.deposition.witnessSworn = { value: true, source: "REPORTER_ENTERED", state: "REPORTER_ADDED", confidence: null, citations: [] };
  addCanonicalOath(rec);
  return rec;
};


// completePagination used to emit { examiner: "EXAMINING ATTORNEY" } whenever no examination data
// was supplied, and the index printed it. Nothing supplied that data: operator.examinations only
// ever arrived from the fixture generator, so every reporter-created complete transcript would have
// carried a placeholder onto a certified page -- confident prose no reader would question, and no
// test asserted on it.
//
// The examiner is now resolved from operator.examiningCounselId, which is the canonical id the
// preparation panel stores, and generation refuses when there is nobody to name.
const lines = page => Array.from({ length:25 }, (_, index) => ({
  position:index + 1, content:index === 0 ? `    Q.    Synthetic testimony page ${page}.` : "",
  occupied:index === 0, paragraphId:null, fragments:[], fields:[],
}));
const printModel = {
  recordType:"TRANSCRIPT_PRINT_MODEL", modelHash:"testimony-hash", source:{ reviewStateHash:"review-hash" },
  deposition:{ id:"DEP-20260828-EXAM1", caseStyle:"Whitaker v. Brazos Ridge Logistics, LLC", witness:"Dana Ellsworth Whitaker", causeNumber:"2026-CI-90210", depositionDate:"2026-08-28" },
  layoutProfile:TEXAS_FREELANCE_DEPOSITION_V1,
  pages:[{ pageNumber:1, lines:lines(1) }, { pageNumber:2, lines:lines(2) }], findings:{},
};
const record = () => attested({
  jurisdictionType:"texas-state", court:"45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS",
  causeNumber:"2026-CI-90210", caseStyle:"Whitaker v. Brazos Ridge Logistics, LLC",
  witness:"Dana Ellsworth Whitaker", depositionDate:"2026-08-28", remote:true, remotePlatform:"Zoom",
  parties:[{ name:"Dana Ellsworth Whitaker", role:"Plaintiff" }, { name:"Brazos Ridge Logistics, LLC", role:"Defendant" }],
  attorneys:[
    { name:"Marisol Vantongeren-Okafor", firm:"Vantongeren & Okafor LLP", address:"1 Riverwalk Plaza, San Antonio, Texas", phone:"210-555-0101", represents:["Dana Ellsworth Whitaker"], side:"PLAINTIFF", actualAppearance:true },
    { name:"Rufus Q. Pemberton-Stack", firm:"Brazos Ridge Defense Group", address:"2 Commerce Street, San Antonio, Texas", phone:"210-555-0102", represents:["Brazos Ridge Logistics, LLC"], side:"DEFENDANT", actualAppearance:true },
  ],
  reporterProfile:{ name:"Marguerite Okonkwo-Vance", licenseNumber:"CSR 9174", csrExpiration:"2027-12-31", company:"Okonkwo-Vance Reporting", firmRegistrationNumber:"5678", address:"1 Riverwalk Plaza, San Antonio, Texas", phone:"210-555-0143" },
});
const operator = {
  jurisdiction:"texas-state", signatureDisposition:"waived", signatureDispositionBasis:"Waived on the record",
  courtHeadingLine:"IN THE DISTRICT COURT OF", countyCourtLine:"BEXAR COUNTY, TEXAS", judicialDistrictLine:"45TH JUDICIAL DISTRICT",
  proceedingHeading:"ORAL DEPOSITION OF", witnessLocation:{ physicalAddress:"San Antonio, Texas" },
  titleNarrative:["Dana Ellsworth Whitaker, produced as a witness and duly sworn,"],
  certification:{ custodialAttorney:"Marisol Vantongeren-Okafor", charges:"500.00", chargesResponsibleParty:"Plaintiff", serviceDate:"August 28, 2026", certificationDate:"August 28, 2026" },
  timeUsed:{ totalOnRecordMinutes:60, parties:[{ name:"Marisol Vantongeren-Okafor", minutes:60 }] },
};
const build = extra => buildCompleteTranscriptModel({
  depositionId:"DEP-20260828-EXAM1", printModel, record:record(),
  intake:{ counselOfRecord:["Marisol Vantongeren-Okafor", "Rufus Q. Pemberton-Stack"] },
  operator:{ ...operator, ...extra }, generatedAt:"2026-08-28T00:00:00.000Z",
});

test("the index names the examiner the assembly chose", async () => {
  const model = await build({ examiningCounselId:"attorney-1" });
  assert.deepEqual(model.pagination.index.examinations.map(entry => entry.examiner), ["Marisol Vantongeren-Okafor"]);
  // And the placeholder is nowhere on the rendered pages.
  const text = model.pages.flatMap(page => page.lines).map(line => line.content).join("\n");
  assert.doesNotMatch(text, /EXAMINING ATTORNEY/, "the placeholder still reaches the page");
  assert.match(text, /Marisol Vantongeren-Okafor/);
});

test("choosing the other attorney changes who the index names", async () => {
  // Guards against a resolver that returns the first counsel whatever it was asked for.
  const model = await build({ examiningCounselId:"attorney-2" });
  assert.deepEqual(model.pagination.index.examinations.map(entry => entry.examiner), ["Rufus Q. Pemberton-Stack"]);
});

test("the reporter never supplies the examination page range", async () => {
  // Derived from the paginator, which knows where testimony begins and ends. Nothing in the
  // preparation panel collects a page number.
  const model = await build({ examiningCounselId:"attorney-1" });
  const [examination] = model.pagination.index.examinations;
  const testimony = model.pages.filter(page => page.role === "testimony").map(page => page.pageNumber);
  assert.equal(examination.startPage, Math.min(...testimony));
  assert.equal(examination.endPage, Math.max(...testimony));
});

test("generation refuses when no examiner was chosen", async () => {
  await assert.rejects(() => build({}), /COMPLETE_TRANSCRIPT_EXAMINER_REQUIRED/);
});

test("an examiner id that names nobody is refused, and the refusal says why", async () => {
  // This is the removal case. A reporter deletes an attorney in the counsel editor and the
  // preparation still names them, so the refusal has to point at the deletion rather than read as a
  // generic missing examiner -- the two screens are far apart, and the cause is not near the effect.
  await assert.rejects(() => build({ examiningCounselId:"attorney-9" }), error => {
    assert.match(error.message, /COMPLETE_TRANSCRIPT_EXAMINER_UNRESOLVED:attorney-9/);
    assert.match(error.message, /no longer has/, "the refusal does not say the counsel record is gone");
    assert.match(error.message, /removed/, "the refusal does not tell the reporter a removal caused it");
    return true;
  });
});
