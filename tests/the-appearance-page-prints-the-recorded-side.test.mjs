import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { assembleInsertionInput, captionParties } from "../server/insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet } from "../server/insertion-pages/build-pages.mjs";
import { loadTemplateVariant } from "../server/insertion-pages/templates.mjs";
import { validateInsertionInput } from "../server/insertion-pages/validate.mjs";

// A fixture that renders a certificate has to carry what the certificate asserts. The caption
// parties were already here for that reason; the oath is the same class of fact. Attesting it is
// not scaffolding to get past validation -- an unattested record now refuses, correctly, because
// the page states the witness was duly sworn.
const attested = (input) => {
  const rec = createCanonicalDepositionRecord(input);
  rec.deposition.witnessSworn = { value: true, source: "REPORTER_ENTERED", state: "REPORTER_ADDED", confidence: null, citations: [] };
  return rec;
};


// The appearance page used to print `FOR ` plus whatever was in `represents`, verbatim. So
// "FOR THE PLAINTIFF:" on a certified page only ever appeared because somebody typed a side into a
// field holding party names. It now prints the phrase the record was asked for.
//
// These generate the page and read the produced line, rather than calling appearancePhrase. A test
// of the helper would pass with the print site still joining party names.
async function generated(attorneys, parties = [{ name: "Alex Plaintiff", role: "Plaintiff" }, { name: "Delta Company", role: "Defendant" }]) {
  const record = attested({
    court: "45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS", causeNumber: "2026-CI-10001",
    witness: "Jordan Example", depositionDate: "2026-08-01", remote: true, remotePlatform: "Zoom",
    parties,
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
  const sideMissing = blockers.some(finding => finding.code === "APPEARANCE_SIDE_MISSING");
  return { input, blockers, pages: sideMissing ? null : buildTexasInsertionPageSet(input, { setId:"s", depositionId:"DEP-20260827-SIDE1", generatedAt:"2026-08-27T00:00:00.000Z" }) };
}

const PAT = { name:"Pat Counsel", firm:"Plaintiff Firm", address:"100 Main, San Antonio, Texas", phone:"210-555-0101", represents:["Alex Plaintiff"] };
const textOf = pages => pages.pages.flatMap(page => page.lines).map(line => line.text);
// A long designation wraps across physical lines -- the page is fixed-width -- so assertions about
// the joined text read the page flattened rather than any single line.
const flatText = pages => textOf(pages).join(" ").replace(/\s+/g, " ");

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

// The certified transcripts carry three shapes for this line, all accepted:
//
//   FOR THE PLAINTIFF, DEAVEN BABERS:      Chun Yean    -- designation inside the heading
//   FOR THE PLAINTIFF:   DELIA GARZA       Heath Thomas -- designation after the colon
//   FOR THE PLAINTIFFS:                    Goodwin      -- heading alone
//
// Thomas was chosen deliberately. These pin that choice so a later session does not reconcile it
// back toward Chun Yean on the grounds that a specimen shows it.
test("the appearance line puts the designation after the colon, not inside the heading", async () => {
  const { pages } = await generated([{ ...PAT, side:"PLAINTIFF" }]);
  const forLines = textOf(pages).filter(line => line.startsWith("FOR "));
  assert.ok(forLines.includes("FOR THE PLAINTIFF: ALEX PLAINTIFF"), `got ${forLines.join(" | ")}`);
  assert.ok(!forLines.some(line => /^FOR THE PLAINTIFF, /.test(line)), "the designation moved inside the heading");
});

test("a side with no specimen support prints its heading alone", async () => {
  // Nine of the eleven values appear in no certified transcript on hand, so nothing composes a
  // designation for them. The heading comes from the phrase map; after the colon is nothing.
  const { pages } = await generated([{ ...PAT, side:"INTERVENOR" }]);
  const forLines = textOf(pages).filter(line => line.startsWith("FOR "));
  assert.deepEqual(forLines, ["FOR THE INTERVENOR:"]);
});
test("multiple parties join with a serial comma and AND", async () => {
  // Specimen-derived from both unambiguous two-party appearance lines --
  //   FOR THE DEFENDANTS, SK ELECTRIC, INC., AND CHUN YEAN:
  //   FOR THE DEFENDANTS, HMK MORTGAGE, LLC, AND HMK LTD.:
  // -- and from Filpi's three plaintiffs. A plain " AND " on two matches no appearance line.
  const two = await generated([{ ...PAT, side:"PLAINTIFF" }],
    [{ name:"Alex Plaintiff", role:"Plaintiff" }, { name:"Marisol Vantongeren", role:"Plaintiff" }, { name:"Delta Company", role:"Defendant" }]);
  assert.ok(flatText(two.pages).includes("FOR THE PLAINTIFF: ALEX PLAINTIFF, AND MARISOL VANTONGEREN"), flatText(two.pages).slice(0, 400));

  const three = await generated([{ ...PAT, side:"PLAINTIFF" }],
    [{ name:"Alex Plaintiff", role:"Plaintiff" }, { name:"Marisol Vantongeren", role:"Plaintiff" }, { name:"Rufus Pemberton", role:"Plaintiff" }, { name:"Delta Company", role:"Defendant" }]);
  assert.ok(flatText(three.pages).includes("FOR THE PLAINTIFF: ALEX PLAINTIFF, MARISOL VANTONGEREN, AND RUFUS PEMBERTON"), flatText(three.pages).slice(0, 400));
});

test("party names print in capitals though the record keeps the reporter's spelling", async () => {
  // Stored as typed -- flattening O'Neill or DeLaGarza into the record destroys a spelling nothing
  // downstream can recover. The page is what conforms.
  const { input, pages } = await generated([{ ...PAT, side:"PLAINTIFF" }],
    [{ name:"Delia DeLaGarza", role:"Plaintiff" }, { name:"Delta Company", role:"Defendant" }]);
  assert.equal(captionParties(input.record).plaintiffs[0], "Delia DeLaGarza", "the record was flattened to capitals");
  assert.ok(textOf(pages).includes("FOR THE PLAINTIFF: DELIA DELAGARZA"));
});

test("the caption and the appearance page join the same parties differently, deliberately", async () => {
  // Not inconsistency. Filpi's caption reads HMK MORTGAGE, LLC AND HMK LTD. while its own
  // appearance page reads HMK MORTGAGE, LLC, AND HMK LTD. The caption mirrors the docket as filed;
  // the appearance page follows transcription grammar. Two authorities, so do not unify them.
  const { input, pages } = await generated([{ ...PAT, side:"PLAINTIFF" }],
    [{ name:"Alex Plaintiff", role:"Plaintiff" }, { name:"Marisol Vantongeren", role:"Plaintiff" }, { name:"Delta Company", role:"Defendant" }]);
  assert.equal(input.fieldValues["caption.plaintiffs"].join(", "), "Alex Plaintiff, Marisol Vantongeren", "the caption stopped using its own join");
  assert.match(flatText(pages), /ALEX PLAINTIFF, AND MARISOL VANTONGEREN/, "the appearance page stopped using the serial joiner");
});
