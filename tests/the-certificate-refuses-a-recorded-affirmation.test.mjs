// The certification page states, as a literal in both Texas templates, that the witness "was duly
// sworn by the officer". If the reporter recorded an affirmation, that sentence is false and goes
// out under their CSR number. It refuses instead.
//
// Only AFFIRMATION refuses. UNRESOLVED and an absent value generate, deliberately -- see
// docs/opening-procedures/authorization-o10-certificate-refusal.md section 2 and the F-20
// amendment. Those rows are asserted here so that narrowing is a tested decision rather than an
// untested assumption: if someone later makes absence refuse, these fail and they have to read why.
import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { assembleInsertionInput } from "../server/insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet } from "../server/insertion-pages/build-pages.mjs";
import { loadTemplateVariant } from "../server/insertion-pages/templates.mjs";
import { validateInsertionInput } from "../server/insertion-pages/validate.mjs";

async function assembled(operatorExtra) {
  const record = createCanonicalDepositionRecord({
    court: "45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS", causeNumber: "2026-CI-10001",
    witness: "Jordan Example", depositionDate: "2026-08-01",
    parties: [{ name: "Alex Plaintiff", role: "Plaintiff" }, { name: "Delta Company", role: "Defendant" }],
    attorneys: [
      { name: "Pat Counsel", firm: "Plaintiff Firm", address: "100 Main, San Antonio, Texas", phone: "210-555-0101", represents: ["Alex Plaintiff"], side: "PLAINTIFF" },
      { name: "Dana Counsel", firm: "Defense Firm", address: "200 Main, San Antonio, Texas", phone: "210-555-0102", represents: ["Delta Company"], side: "DEFENDANT" },
    ],
    reporterProfile: { name: "Riley Reporter", licenseNumber: "1234", csrExpiration: "2027-12-31", company: "Reporter Firm", firmRegistrationNumber: "5678", address: "300 Main, San Antonio, Texas", phone: "210-555-0103" },
  });
  const template = await loadTemplateVariant("TEXAS_STATE_SIGNATURE_WAIVED");
  const appearances = record.counsel.map((a) => ({ ...a, participation: { method: { value: "zoom" }, detail: { value: "Zoom" } } }));
  return assembleInsertionInput({
    record, template, intake: { counselOfRecord: ["Pat Counsel", "Dana Counsel"] },
    operator: {
      jurisdiction: "texas-state", signatureDisposition: "waived", signatureDispositionBasis: "Stated on the record", appearances,
      courtHeadingLine: "IN THE DISTRICT COURT OF", countyCourtLine: "BEXAR COUNTY, TEXAS", judicialDistrictLine: "45TH JUDICIAL DISTRICT",
      proceedingHeading: "ORAL DEPOSITION OF", witnessLocation: { physicalAddress: "San Antonio, Texas" },
      titleNarrative: ["Jordan Example, produced as a witness and duly sworn,", "was taken remotely by Zoom before Riley Reporter,", "Certified Shorthand Reporter in and for Texas."],
      certification: { custodialAttorney: "Pat Counsel", charges: "500.00", chargesResponsibleParty: "Plaintiff", serviceDate: "August 14, 2026", certificationDate: "August 14, 2026", furtherCertificationDate: "August 30, 2026" },
      timeUsed: { totalOnRecordMinutes: 120, parties: [{ name: "Pat Counsel", minutes: 60 }, { name: "Dana Counsel", minutes: 60 }] },
      ...operatorExtra,
    },
    pagination: { index: { appearances: { startPage: 2 }, examinations: [{ examiner: "Pat Counsel", startPage: 5, endPage: 40 }], changesAndSignature: { startPage: 41 }, reportersCertification: { startPage: 41 }, entries: [], actualSectionPages: {}, declaredSectionPages: {} } },
  });
}

const oathFindings = (input) =>
  validateInsertionInput(input).filter((f) => f.code === "CERT_OATH_BASIS_AFFIRMATION");

test("a recorded affirmation blocks the certification page", async () => {
  const input = await assembled({ witnessOathSelection: "AFFIRMATION" });
  const findings = oathFindings(input);
  assert.equal(findings.length, 1, "the affirmation must raise exactly one oath-basis finding");
  assert.equal(findings[0].severity, "blocking");
  assert.equal(findings[0].target, "deposition.witnessOathSelection");

  // Both production call sites refuse on any blocking finding before building a page, so the page
  // set must never be reached. Assert the gate the callers actually apply, not a thrown error.
  const blockers = validateInsertionInput(input).filter((f) => f.severity === "blocking");
  assert.ok(blockers.length > 0, "a blocking finding is what complete-transcript-model.mjs and word-service.mjs gate on");
});

test("an oath, an unresolved selection, and an absent selection all still generate", async () => {
  for (const selection of ["OATH", "UNRESOLVED", undefined]) {
    const input = await assembled(selection === undefined ? {} : { witnessOathSelection: selection });
    assert.equal(oathFindings(input).length, 0, `selection ${String(selection)} must not raise the oath-basis finding`);
    const set = buildTexasInsertionPageSet(input, { setId: "s", depositionId: "DEP", generatedAt: "2026-08-29T12:00:00.000Z" });
    const text = set.pages.filter((p) => p.role.startsWith("certification")).flatMap((p) => p.lines.map((l) => l.text)).join("\n");
    assert.match(text, /was duly sworn/, `selection ${String(selection)} still produces the sworn certificate today`);
  }
});

// Positive control. Without this, a future change that made every case return the same result --
// including a validator that silently stopped running -- would look like a passing suite.
test("the harness detects a difference when one exists", async () => {
  const a = await assembled({ witnessOathSelection: "OATH" });
  const b = await assembled({ witnessOathSelection: "OATH", proceedingHeading: "ORAL AND VIDEOTAPED DEPOSITION OF" });
  const pages = (input) => buildTexasInsertionPageSet(input, { setId: "s", depositionId: "DEP", generatedAt: "2026-08-29T12:00:00.000Z" }).sha256;
  assert.notEqual(pages(a), pages(b), "changing a field the renderer reads must change the page set");
});
