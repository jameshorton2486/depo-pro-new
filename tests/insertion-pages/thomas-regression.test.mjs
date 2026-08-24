import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../../server/canonical-deposition-record.mjs";
import { assembleInsertionInput } from "../../server/insertion-pages/assemble.mjs";
import { loadTemplateVariant } from "../../server/insertion-pages/templates.mjs";
import { validateInsertionInput } from "../../server/insertion-pages/validate.mjs";

async function thomasFixture() {
  const record = createCanonicalDepositionRecord({
    jurisdictionType: "federal",
    court: "UNITED STATES DISTRICT COURT FOR THE WESTERN DISTRICT OF TEXAS",
    causeNumber: "25-CV-00598-OLG",
    caseStyle: "Garza v. Home Depot U.S.A., Inc., et al.",
    witness: "Heath Thomas",
    depositionDate: "2026-06-23",
    remote: true,
    remotePlatform: "Zoom",
    attorneys: [
      { name: "Mr. Nunez", firm: "Nunez Law", address: "San Antonio Texas", represents: ["Plaintiffs"] },
      { name: "Ms. Alvarado", firm: "Defense Firm", address: "San Antonio Texas", represents: ["Defendants"] },
    ],
    reporterProfile: {
      name: "Test Reporter", licenseNumber: "1234", csrExpiration: "2027-01-01", company: "Test Reporting",
      address: "100 Main Street, San Antonio, Texas", phone: "210-555-0100",
    },
  });
  const template = await loadTemplateVariant("TEXAS_STATE_SIGNATURE_REQUESTED");
  return assembleInsertionInput({
    record,
    intake: { counselOfRecord: ["Mr. Nunez", "Ms. Alvarado", "Mr. Missing Counsel"] },
    template,
    operator: {
      jurisdiction: "texas-state",
      signatureDisposition: "requested",
      signatureDispositionBasis: "Request stated on the record",
      volumeCount: 1,
      proceedingLocation: { platform: "Zoom", physicalAddress: "at the offices of Defense Firm" },
      reporterLocation: { physicalAddress: "San Antonio, Texas" },
      witnessLocation: { physicalAddress: null },
      presentation: {
        multipleDefendantsSingularLabel: true,
        causeNumberMissingSpace: true,
        addressMissingComma: true,
        videographerNoneBlock: true,
        locationPlatformConflated: true,
      },
    },
    pagination: {
      index: {
        examinations: [{ examiner: "Mr. Nunez", startPage: 5, endPage: 75 }],
        changesAndSignature: { startPage: 75 },
        reportersCertification: { startPage: 78 },
        entries: [
          { section: "examination", page: 5, endPage: 75 },
          { section: null, page: 75 },
          { section: "changesAndSignature", page: null },
          { section: "reportersCertification", page: 78 },
        ],
        declaredSectionPages: { changesAndSignature: 75 },
        actualSectionPages: { changesAndSignature: 76, reportersCertification: 78 },
        attributionRules: { changesAndSignature: "bare number following the labelled entry is attributed to that section" },
      },
    },
  });
}

test("Thomas regression fixture produces exactly the approved blocking defects and drafting warnings", async () => {
  const findings = validateInsertionInput(await thomasFixture());
  const pairs = (severity) => findings.filter((finding) => finding.severity === severity)
    .map(({ code, target }) => `${code}:${target}`).sort();
  // APPEARANCE_METHOD_MISSING is gone from this list, not silenced: the fixture sets
  // remote: true with remotePlatform "Zoom", so the deposition states its method and there is
  // nothing to block on. Per ADR-0020 the method is a fact about the deposition, and the
  // per-attorney requirement blocked counsel who had appeared on a field no certified page renders.
  assert.deepEqual(pairs("blocking"), [
    "CERT_COUNSEL_INCOMPLETE:cert.counselOfRecord",
    "CERT_FIRM_REGISTRATION_UNRESOLVED:reporter.firmRegistrationNumber",
    "CERT_JURISDICTION_MISMATCH:cert.jurisdiction",
    "INDEX_PAGE_MISMATCH:index.section.changesAndSignature",
    "INDEX_UNRESOLVED_ENTRY:index.page.75",
    "INDEX_UNRESOLVED_ENTRY:index.section.changesAndSignature",
    "UNEXPECTED_BLANK:cert.chargesResponsibleParty",
    "UNEXPECTED_BLANK:cert.furtherCertificationDate",
  ].sort());
  assert.deepEqual(pairs("warning"), [
    "ADDRESS_PUNCTUATION:appearances.address",
    "ALSO_PRESENT_AWKWARD:participants.videographer",
    "CAPTION_PLURALIZATION:caption.partyLabel",
    "CAPTION_PUNCTUATION:caption.causeNumber",
    "LAYOUT_PROFILE_UNVERIFIED:layoutProfile",
    "LOCATION_PLATFORM_CONFLATED:locations.proceeding",
    "WITNESS_LOCATION_UNSTATED:locations.witness.physicalAddress",
  ].sort());
  const mismatch = findings.find(({ code }) => code === "INDEX_PAGE_MISMATCH");
  assert.deepEqual(mismatch.details, {
    declaredPage: 75,
    actualPage: 76,
    attributionRule: "bare number following the labelled entry is attributed to that section",
  });
});

test("multi-volume input fails explicitly instead of printing a false volume label", async () => {
  const input = await thomasFixture();
  input.deposition.volumeCount = 3;
  assert.ok(validateInsertionInput(input).some(({ code }) => code === "MULTI_VOLUME_UNSUPPORTED"));
});
