import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { writeDepositionAttorneyTime, writeDepositionCertificateWorkflow, writeDepositionCertification } from "../server/deposition-store.mjs";
import { prepareInsertionRenderingArtifact } from "../server/insertion-pages/word-service.mjs";

// A fixture that renders a certificate has to carry what the certificate asserts. The caption
// parties were already here for that reason; the oath is the same class of fact. Attesting it is
// not scaffolding to get past validation -- an unattested record now refuses, correctly, because
// the page states the witness was duly sworn.
const attested = (input) => {
  const rec = createCanonicalDepositionRecord(input);
  rec.deposition.witnessSworn = { value: true, source: "REPORTER_ENTERED", state: "REPORTER_ADDED", confidence: null, citations: [] };
  return rec;
};


// The test that was missing.
//
// Fixtures reached the certificate values through operator.certification, which no caller
// constructs -- InsertionPagesScreen sends { depositionId, mode, operator: { jurisdiction,
// signatureDisposition, signatureDispositionBasis } } and nothing else. So every existing render
// test passed on a path the application does not have, and nothing asserted that the payload the
// screen actually sends produces a certificate at all.
//
// This drives that payload exactly: the form saves to the canonical record, and the render request
// carries no certification key. If assemble ever stops reading the record, this fails and the
// operator-shaped fixtures do not.
const CERTIFICATE = {
  custodialAttorney: "Pat Counsel",
  officerCharges: "500.00",
  chargesResponsibleParty: "Plaintiff",
  certificationDate: "August 14, 2026",
  returnedDate: "August 28, 2026",
  furtherCertificationDate: "August 30, 2026",
};

let counter = 0;

function scratch(t) {
  const depositionId = `DEP-20260824-CF${String(++counter).padStart(3, "0")}`;
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-certform-"));
  t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  const folder = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(path.join(folder, "intake"), { recursive: true });
  fs.writeFileSync(path.join(folder, "deposition.json"), JSON.stringify({ id: depositionId }));
  fs.writeFileSync(path.join(folder, "intake", "canonical-deposition-record.json"), JSON.stringify(
    attested({
      court: "In the 285th Judicial District Court", causeNumber: "2024-CI-11223",
      caseStyle: "Vasquez v. Central Texas Logistics", witness: "Dr. Priya Ramanathan",
      depositionDate: "2026-09-18", location: "San Antonio", remote: true, remotePlatform: "Zoom",
      // caption.plaintiffs and caption.defendants are guarded now, so a record with no parties
      // in either role cannot render a caption at all.
      parties: [{ name: "Maria Vasquez", role: "Plaintiff" }, { name: "Delta LLC", role: "Defendant" }],
      attorneys: [{ name: "Pat Counsel", firm: "Moreno Trial Law PLLC", represents: "Plaintiff", side: "PLAINTIFF", appeared: true, participation: { method: "remote-video" } }],
      reporterProfile: {
        name: "Miah Bardot", licenseNumber: "12129", csrState: "Texas", csrExpiration: "2027-06-30",
        address: "7234 Hovingham, San Antonio, Texas 78257", phone: "469 740-9603",
        firmRegistrationWaiver: "Certifies under an individual Texas CSR; no firm registration applies.",
      },
    }), null, 2));
  // Through the writer, not into the seeded JSON. The operator payload here is exactly what the
  // screen sends and must stay that way, so the time-used clause has to be answered where a real
  // deposition answers it -- on the canonical record.
  writeDepositionAttorneyTime(null, { depositionId, storageRoot, attorneyTime: [{ name: "Pat Counsel", minutes: 60 }] });
  return { depositionId, storageRoot };
}

// Exactly what InsertionPagesScreen.request() builds. No certification key, deliberately.
const renderAsTheScreenDoes = (s, signatureDisposition = "waived") =>
  prepareInsertionRenderingArtifact(null, s.depositionId, {
    mode: "standalone",
    operator: { jurisdiction: "texas-state", signatureDisposition, signatureDispositionBasis: "Stated on the record." },
    pagination: { index: { entries: [], actualSectionPages: {}, declaredSectionPages: {}, examinations: [{ label: "Examination by Ms. Counsel", startPage: 4 }], changesAndSignature: { startPage: 60 }, reportersCertification: { startPage: 62 } } },
  }, { storageRoot: s.storageRoot });

const blockedBy = async (s, disposition) => {
  try {
    await renderAsTheScreenDoes(s, disposition);
    return [];
  } catch (error) {
    const match = /INSERTION_VALIDATION_BLOCKED: (.*)$/.exec(error.message);
    if (!match) throw error;
    return match[1].split(", ");
  }
};

test("without the form the certificate is refused, not rendered short", async (t) => {
  const s = scratch(t);
  const blockers = await blockedBy(s, "waived");
  for (const target of ["cert.custodialAttorney", "cert.charges", "cert.chargesResponsibleParty", "cert.certificationDate"]) {
    assert.ok(blockers.includes(`UNEXPECTED_BLANK:${target}`), `${target} must block; got ${JSON.stringify(blockers)}`);
  }
});

test("the form's values reach the page through the record, not the render request", async (t) => {
  const s = scratch(t);
  writeDepositionCertification(null, { depositionId: s.depositionId, certification: CERTIFICATE, storageRoot: s.storageRoot });
  writeDepositionCertificateWorkflow(null, { depositionId: s.depositionId, storageRoot: s.storageRoot,
    workflow: { serviceDate: "2026-08-14" } });

  const rendered = await renderAsTheScreenDoes(s, "waived");
  assert.deepEqual(rendered.findings.filter((finding) => finding.severity === "blocking"), [],
    "a reporter who answered every certificate field must not be blocked");

  const blob = JSON.stringify(rendered.pageSet);
  assert.match(blob, /delivered to/);
  assert.ok(blob.includes("Pat Counsel"), "the custodial attorney prints");
  assert.ok(blob.includes("500.00"), "the charges print");
  assert.ok(!/\^[a-z][a-zA-Z0-9_.-]*\^/.test(blob), "no placeholder survives onto the page");
});

test("the requested variant's two extra dates are collected and print separately", async (t) => {
  const s = scratch(t);
  writeDepositionCertification(null, { depositionId: s.depositionId, certification: CERTIFICATE, storageRoot: s.storageRoot });
  writeDepositionCertificateWorkflow(null, { depositionId: s.depositionId, storageRoot: s.storageRoot,
    workflow: { submissionDate: "2026-08-14", returnDeadline: "2026-08-28", serviceDate: "2026-08-30" } });
  const rendered = await renderAsTheScreenDoes(s, "requested");
  const blob = JSON.stringify(rendered.pageSet);
  assert.ok(blob.includes("August 14, 2026"), "the certificate date prints");
  assert.ok(blob.includes("August 30, 2026"), "and the further certification date prints as its own value");
  assert.ok(blob.includes("August 28, 2026"), "and the return date prints where cert.returnStatus sits");
});

test("a field left alone is MISSING, not an empty answer", (t) => {
  const s = scratch(t);
  const written = writeDepositionCertification(null, {
    depositionId: s.depositionId, storageRoot: s.storageRoot,
    certification: { ...CERTIFICATE, custodialAttorney: "", furtherCertificationDate: "   " },
  });
  assert.deepEqual(written.certification.custodialAttorney, { value: null, source: "REPORTER_ENTERED", state: "MISSING", confidence: null, citations: [] });
  assert.deepEqual(written.certification.furtherCertificationDate.state, "MISSING", "whitespace is not an answer either");
  assert.equal(written.certification.officerCharges.state, "REPORTER_ADDED");
  assert.equal(written.certification.officerCharges.source, "REPORTER_ENTERED");
  assert.equal(written.signature.returnedDate.source, "REPORTER_ENTERED");
});

test("the store refuses a field it does not name", (t) => {
  const s = scratch(t);
  // serviceDate is WORKFLOW_DERIVED. A caller reaching for it is trying to have a reporter answer
  // for a workflow, and the record would then claim the workflow derived what a person typed.
  assert.throws(() => writeDepositionCertification(null, {
    depositionId: s.depositionId, storageRoot: s.storageRoot, certification: { serviceDate: "August 14, 2026" },
  }), /Unsupported certification field: serviceDate/);
});
