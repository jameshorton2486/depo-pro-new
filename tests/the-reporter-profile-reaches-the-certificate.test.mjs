import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createReporter, listReporters } from "../server/reporter-store.mjs";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { assembleInsertionInput } from "../server/insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet } from "../server/insertion-pages/build-pages.mjs";
import { loadTemplateVariant } from "../server/insertion-pages/templates.mjs";
import { validateInsertionInput } from "../server/insertion-pages/validate.mjs";

// Two fields a certified page requires that the reporter had no way to supply.
//
// The waiver: validateFields has honoured a recorded waiver since the fix this evening, but the
// Add Court Reporter form had no input for one, so every profile stored "" -- and an empty waiver
// is not a waiver. The fix was correct and dead.
//
// The CSR expiration: six byte-identical signature blocks across three certified transcripts all
// carry "EXPIRES 6-30-2026", the reviewed template prints ^reporter.csrExpirationDate^, and
// validateInsertionInput blocks without it. It was on neither the form nor the store whitelist, so
// a certification page could not be produced at all.
//
// This drives the store rather than a hand-built profile, because the store is what the form writes
// through and the whitelist is what silently dropped the values.
const template = await loadTemplateVariant("TEXAS_STATE_SIGNATURE_REQUESTED");
const WAIVER = "Certifies under an individual Texas CSR; no firm registration applies.";

const profile = extra => ({
  id: crypto.randomUUID(), name: "Miah Bardot", licenseNumber: "12129",
  address: "7234 Hovingham, San Antonio, Texas 78257", phone: "469 740-9603", ...extra,
});

function stored(t, extra) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-reporter-cert-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createReporter(root, profile(extra));
  const [saved] = listReporters(root);
  return saved;
}

function render(reporterProfile) {
  const record = createCanonicalDepositionRecord({
    court: "In the 285th Judicial District Court", causeNumber: "2024-CI-11223",
    caseStyle: "Vasquez v. Central Texas Logistics", witness: "Dr. Priya Ramanathan",
    parties: [{ name: "Ruben Vasquez", role: "Plaintiff" }, { name: "Central Texas Logistics, LLC", role: "Defendant" }],
    depositionDate: "2026-09-18", location: "San Antonio", remote: true, remotePlatform: "Zoom",
    attorneys: [{ name: "Alicia Moreno", firm: "Moreno Trial Law PLLC", represents: "Plaintiff", side: "PLAINTIFF", appeared: true, participation: { method: "remote-video" } }],
    reporterProfile,
  });
  const assembled = assembleInsertionInput({
    record, intake: {},
    // certification is supplied for the same reason pagination is: cert.chargesResponsibleParty and
    // cert.furtherCertificationDate now reach the guard and nothing collects them yet.
    operator: { jurisdiction: "texas-state", signatureDisposition: "requested", signatureDispositionBasis: "Requested on the record.",
      certification: { custodialAttorney: "Pat Counsel", charges: "500.00", chargesResponsibleParty: "Plaintiff",
          certificationDate: "August 14, 2026", returnStatus: "August 28, 2026", furtherCertificationDate: "August 30, 2026" } },
    pagination: { index: { entries: [], actualSectionPages: {}, declaredSectionPages: {},
      examinations: [{ examiner: "Ms. Moreno", startPage: 4, endPage: 58 }],
      changesAndSignature: { startPage: 61 }, reportersCertification: { startPage: 63 } } },
    template,
  });
  const blocking = validateInsertionInput(assembled).filter(finding => finding.severity === "blocking");
  return { assembled, blocking, pages: buildTexasInsertionPageSet(assembled, { setId: "s", depositionId: "DEP-20260824-CRT01", generatedAt: "2026-08-24T00:00:00.000Z", certificateOnly: true }) };
}

test("the store keeps both fields now, and still drops a firm registration number", t => {
  const saved = stored(t, { csrExpiration: "2027-06-30", firmRegistrationWaiver: WAIVER, firmRegistrationNumber: "7788" });
  assert.equal(saved.csrExpiration, "2027-06-30");
  assert.equal(saved.firmRegistrationWaiver, WAIVER);
  assert.ok(!("firmRegistrationNumber" in saved),
    "the number is still not storable; no certified specimen justifies one");
});

test("a solo reporter created through the store renders a certification page", t => {
  // The whole path, end to end: no firm, a recorded waiver, an expiration -- the reporter this
  // application is for. Before today this produced two firm blockers and a missing expiration.
  const { blocking, pages } = render(stored(t, { csrExpiration: "2027-06-30", firmRegistrationWaiver: WAIVER }));
  assert.deepEqual(blocking, [], "nothing may block a reporter who has answered every requirement");
  const blob = JSON.stringify(pages);
  assert.ok(blob.includes("Expiration Date: 2027-06-30"), "the expiration prints, as every specimen does");
  assert.ok(!blob.includes("Firm Registration"), "and the firm line is omitted, not blanked");
  assert.ok(!/\^[a-z][a-zA-Z0-9_.-]*\^/.test(blob), "no placeholder survives onto the page");
});

test("an empty expiration is not an expiration", t => {
  // Same rule as the waiver. A field the form left blank is unanswered, and a certificate cannot
  // state an expiry nobody supplied.
  for (const blank of ["", "   "]) {
    const { blocking } = render(stored(t, { csrExpiration: blank, firmRegistrationWaiver: WAIVER }));
    assert.ok(blocking.some(finding => finding.target === "reporter.csrExpirationDate"),
      `${JSON.stringify(blank)} must not satisfy the expiration`);
  }
});

test("an empty waiver is not a waiver, through the store", t => {
  const { blocking } = render(stored(t, { csrExpiration: "2027-06-30", firmRegistrationWaiver: "" }));
  assert.ok(blocking.some(finding => /firm/i.test(finding.target)),
    "an unexplained absence of firm registration still blocks");
});

test("supplying neither leaves both requirements unanswered", t => {
  // The state a reporter was stuck in before this: the form could collect neither field.
  const { blocking } = render(stored(t, {}));
  const targets = blocking.map(finding => finding.target);
  assert.ok(targets.includes("reporter.csrExpirationDate"));
  assert.ok(targets.some(target => /firm/i.test(target)));
});
