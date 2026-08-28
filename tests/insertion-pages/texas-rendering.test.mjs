import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../../server/canonical-deposition-record.mjs";
import { assembleInsertionInput } from "../../server/insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet } from "../../server/insertion-pages/build-pages.mjs";
import { renderInsertionPdf } from "../../server/insertion-pages/render-pdf.mjs";
import { loadTemplateVariant } from "../../server/insertion-pages/templates.mjs";

const TEST_GEOMETRY = Object.freeze({ lineNumberLeft: 36, textLeft: 72, firstLineY: 744, lineHeight: 27 });

async function validInput(signatureDisposition) {
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
  const variant = `TEXAS_STATE_SIGNATURE_${signatureDisposition.toUpperCase()}`;
  const template = await loadTemplateVariant(variant);
  const appearances = record.counsel.map((attorney) => ({ ...attorney, participation: { method: { value: "zoom" }, detail: { value: "Zoom" } } }));
  return assembleInsertionInput({
    record, template, intake: { counselOfRecord: ["Pat Counsel", "Dana Counsel"] },
    operator: {
      jurisdiction: "texas-state", signatureDisposition, signatureDispositionBasis: "Stated on the record", appearances,
      courtHeadingLine: "IN THE DISTRICT COURT OF", countyCourtLine: "BEXAR COUNTY, TEXAS", judicialDistrictLine: "45TH JUDICIAL DISTRICT",
      proceedingHeading: "ORAL AND VIDEOTAPED DEPOSITION OF", witnessLocation: { physicalAddress: "San Antonio, Texas" },
      titleNarrative: ["Jordan Example, produced as a witness and duly sworn,", "was taken remotely by Zoom before Riley Reporter,", "Certified Shorthand Reporter in and for Texas."],
      certification: { custodialAttorney: "Pat Counsel", charges: "500.00", chargesResponsibleParty: "Plaintiff", serviceDate: "August 14, 2026", certificationDate: "August 14, 2026", furtherCertificationDate: "August 30, 2026" },
      timeUsed: { totalOnRecordMinutes: 120, parties: [{ name: "Pat Counsel", minutes: 60 }, { name: "Dana Counsel", minutes: 60 }] },
    },
    pagination: { index: { appearances: { startPage: 2 }, examinations: [{ examiner: "Pat Counsel", startPage: 5, endPage: 40 }], changesAndSignature: { startPage: 41 }, reportersCertification: { startPage: signatureDisposition === "requested" ? 43 : 41 }, entries: [], actualSectionPages: {}, declaredSectionPages: {} } },
  });
}

for (const [disposition, expectedRoles] of [
  ["requested", ["title", "appearances", "index", "changes", "signature", "certification1", "certification2", "certification3"]],
  ["waived", ["title", "appearances", "index", "certification1", "certification2"]],
]) test(`Texas ${disposition} variant follows the reviewed UFM figure structure`, async () => {
  const input = await validInput(disposition);
  const options = { setId: `set-${disposition}`, depositionId: "DEP-20260814-TEXAS", generatedAt: "2026-08-14T12:00:00.000Z" };
  const first = buildTexasInsertionPageSet(input, options);
  const second = buildTexasInsertionPageSet(input, options);
  assert.deepEqual(first.pages.map(({ role }) => role), expectedRoles);
  assert.ok(first.pages.every(({ lines }) => lines.length === 25));
  assert.ok(first.pages.flatMap(({ lines }) => lines).every(({ text }) => !/\^[a-z]/.test(text)));
  assert.equal(first.sha256, second.sha256);
  const firstPdf = renderInsertionPdf(first, { geometry: TEST_GEOMETRY });
  const secondPdf = renderInsertionPdf(second, { geometry: TEST_GEOMETRY });
  assert.deepEqual(firstPdf, secondPdf);
  assert.match(firstPdf.subarray(0, 8).toString("ascii"), /%PDF-1\.4/);
  if (process.env.DEPO_PRO_PDF_PREVIEW_DIR) {
    fs.mkdirSync(process.env.DEPO_PRO_PDF_PREVIEW_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.DEPO_PRO_PDF_PREVIEW_DIR, `texas-${disposition}-preview.pdf`), firstPdf);
  }
});

test("PDF rendering refuses to guess unknown UFM geometry", async () => {
  const input = await validInput("waived");
  const set = buildTexasInsertionPageSet(input, { setId: "set", depositionId: "DEP-20260814-TEXAS", generatedAt: "2026-08-14T12:00:00.000Z" });
  assert.throws(() => renderInsertionPdf(set), /PDF_GEOMETRY_UNVERIFIED/);
});
