import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { assembleInsertionInput } from "../server/insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet } from "../server/insertion-pages/build-pages.mjs";
import { loadTemplateVariant } from "../server/insertion-pages/templates.mjs";
import { validateInsertionInput } from "../server/insertion-pages/validate.mjs";

// The appearance page used to print `FOR ` plus whatever was in `represents`, verbatim. So
// "FOR THE PLAINTIFF:" on a certified page only ever appeared because somebody typed a side into a
// field holding party names. It now prints the phrase the record was asked for.
//
// These generate the page and read the produced line, rather than calling appearancePhrase. A test
// of the helper would pass with the print site still joining party names.
async function generated(attorneys) {
  const record = createCanonicalDepositionRecord({
    court: "45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS", causeNumber: "2026-CI-10001",
    witness: "Jordan Example", depositionDate: "2026-08-01", remote: true, remotePlatform: "Zoom",
    parties: [{ name: "Alex Plaintiff", role: "Plaintiff" }, { name: "Delta Company", role: "Defendant" }],
    attorneys,
    reporterProfile: { name: "Riley Reporter", licenseNumber: "1234", csrExpiration: "2027-12-31", company: "Reporter Firm", firmRegistrationNumber: "5678", address: "300 Main, San Antonio, Texas", phone: "210-555-0103" },
  });
  const template = await loadTemplateVariant("TEXAS_STATE_SIGNATURE_WAIVED");
  const appearances = record.counsel.map(attorney => ({ ...attorney, participation: { method: { value: "zoom" }, detail: { value: "Zoom" } } }));
  const input = assembleInsertionInput({
    record, template, intake: { counselOfRecord: attorneys.map(a => a.name) },
    operator: {
      jurisdiction: "texas-state", signatureDisposition: "waived", signatureDispositionBasis: "Stated on the record", appearances,
      courtHeadingLine: "IN THE DISTRICT COURT OF", countyCourtLine: "BEXAR COUNTY, TEXAS", judicialDistrictLine: "45TH JUDICIAL DISTRICT",
      proceedingHeading: "ORAL DEPOSITION OF", witnessLocation: { physicalAddress: "San Antonio, Texas" },
      titleNarrative: ["Jordan Example, produced as a witness and duly sworn,"],
      certification: { custodialAttorney: "Pat Counsel", charges: "500.00", chargesResponsibleParty: "Plaintiff", serviceDate: "August 14, 2026", certificationDate: "August 14, 2026" },
      timeUsed: { totalOnRecordMinutes: 60, parties: [{ name: "Pat Counsel", minutes: 60 }] },
    },
    pagination: { index: { appearances: { startPage: 2 }, examinations: [{ examiner: "Pat Counsel", startPage: 3, endPage: 40 }], reportersCertification: { startPage: 41 } } },
  });
  const blockers = validateInsertionInput(input).filter(finding => finding.severity === "blocking");
  return { input, blockers, pages: blockers.length ? null : buildTexasInsertionPageSet(input, { setId:"s", depositionId:"DEP-20260827-SIDE1", generatedAt:"2026-08-27T00:00:00.000Z" }) };
}

const PAT = { name:"Pat Counsel", firm:"Plaintiff Firm", address:"100 Main, San Antonio, Texas", phone:"210-555-0101", represents:["Alex Plaintiff"] };
const textOf = pages => pages.pages.flatMap(page => page.lines).map(line => line.text);

test("a named side prints its phrase on the appearance page", async () => {
  const { blockers, pages } = await generated([{ ...PAT, side:"AD_LITEM" }]);
  assert.deepEqual(blockers, []);
  const lines = textOf(pages);
  assert.ok(lines.includes("FOR THE GUARDIAN AD LITEM:"), `no phrase line; got ${lines.filter(l => l.startsWith("FOR ")).join(" | ")}`);
  // The party name it used to print must not appear as the side.
  assert.ok(!lines.includes("FOR Alex Plaintiff:"), "the appearance page still prints the party name");
});

test("an Other side prints its reporter-authored wording", async () => {
  const { blockers, pages } = await generated([{ ...PAT, side:"OTHER", sideOther:"AMERIGROUP TEXAS, INC." }]);
  assert.deepEqual(blockers, []);
  // No article inserted for the reporter: the wording is the complete phrase after FOR.
  assert.ok(textOf(pages).includes("FOR AMERIGROUP TEXAS, INC.:"));
});

test("counsel with a missing side refuses generation, naming the counsel", async () => {
  const { blockers, pages } = await generated([{ ...PAT, side:"PLAINTIFF" }, { name:"Dana Counsel", firm:"Defense Firm", represents:["Delta Company"] }]);
  assert.equal(pages, null, "the page generated with a side nobody recorded");
  const finding = blockers.find(item => item.code === "APPEARANCE_SIDE_MISSING");
  assert.ok(finding, `no refusal; got ${blockers.map(b => b.code).join(", ")}`);
  assert.match(finding.message, /Dana Counsel/, "the refusal does not say which counsel needs a side");
  assert.ok(!finding.message.includes("Pat Counsel"), "the refusal names counsel that already has a side");
});

test("the certificate's counsel lines use the same phrase as the appearance page", async () => {
  const { pages } = await generated([{ ...PAT, side:"PLAINTIFF" }]);
  assert.ok(textOf(pages).includes("FOR THE PLAINTIFF:"));
  // The certificate names the same phrase, on the rendered page rather than in a field value:
  // two notions of what counsel represents in one document is the divergence this removes.
  assert.ok(textOf(pages).includes("Pat Counsel, Attorney for THE PLAINTIFF"),
    `certificate counsel line is: ${textOf(pages).filter(line => line.includes("Attorney for")).join(" | ")}`);
});

test("the print site refuses a side nobody recorded, even unvalidated", async () => {
  // validateInsertionInput already blocks this, and both production callers throw on blocking
  // findings before building. But they are the only two. A third caller that built without
  // validating would render `FOR null:` onto a certified page -- a defect no reader would
  // recognise as one -- so the print site refuses rather than trusting that it was checked.
  const { input } = await generated([
    { ...PAT, side:"PLAINTIFF" },
    { name:"Dana Counsel", firm:"Defense Firm", represents:["Delta Company"] },
  ]);
  assert.throws(
    () => buildTexasInsertionPageSet(input, { setId:"s", depositionId:"DEP-20260827-SIDE1", generatedAt:"2026-08-27T00:00:00.000Z" }),
    /APPEARANCE_SIDE_MISSING: Dana Counsel has no side recorded/,
  );
});
