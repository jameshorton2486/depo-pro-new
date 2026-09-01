// A Texas CSR who certifies under an individual licence has no firm registration number, and the
// certificate requirement is satisfied by saying so rather than by leaving a field empty.
//
// The library settles it: three certified transcripts -- Etminan (state), Heath Thomas (federal),
// Jennifer Baier (state) -- carry six signature blocks between them, all byte-identical, and not
// one prints a firm registration number:
//
//   MIAH BARDOT / TEXAS CSR 12129 / EXPIRES 6-30-2026 / 7234 HOVINGHAM / SAN ANTONIO, TEXAS 78257
//
// So the waiver is the branch this reporter needs, and the validator already accepted it -- nothing
// could reach it. There is deliberately no firmRegistrationNumber store field: no certified
// document justifies one, and the validator's number branch stays intact for a firm-employed
// reporter who does not exist here yet.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createReporter, listReporters } from "../server/reporter-store.mjs";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { assembleInsertionInput } from "../server/insertion-pages/assemble.mjs";
import { validateInsertionInput } from "../server/insertion-pages/validate.mjs";

const WAIVER = "Certifies under an individual Texas CSR; no firm registration applies.";
const profile = extra => ({ name:"Miah Bardot", licenseNumber:"12129", csrExpiration:"2027-06-30", address:"7234 Hovingham, San Antonio, Texas 78257", phone:"469 740-9603", ...extra });
const assemble = reporterProfile => assembleInsertionInput({
  record: createCanonicalDepositionRecord({ witness:"Mohammad Etminan, M.D.", reporterProfile }),
  intake:{}, operator:{}, pagination:{}, template:{},
});
const firmFindings = input => validateInsertionInput(input).filter(finding => finding.code === "CERT_FIRM_REGISTRATION_UNRESOLVED");

test("the store keeps the waiver reason on the reporter", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-reporters-"));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  createReporter(root, profile({ id:crypto.randomUUID(), firmRegistrationWaiver:WAIVER }));
  const [stored] = listReporters(root);
  assert.equal(stored.firmRegistrationWaiver, WAIVER);
  // The number field exists now -- the Etminan Notice showed a firm-reported job whose certificate
  // printed no number, so its absence was never evidence that none applied. What matters to THIS
  // test is that recording a waiver does not quietly put something in the number's place.
  assert.equal(stored.firmRegistrationNumber, "", "a waived reporter records no number, rather than a blank-looking one");
});

test("a recorded waiver clears the blocking finding", () => {
  assert.deepEqual(firmFindings(assemble(profile({ firmRegistrationWaiver:WAIVER }))), []);
});

test("no waiver and no number still blocks", () => {
  // The requirement does not disappear; it is answered or it is not.
  const [finding] = firmFindings(assemble(profile()));
  assert.ok(finding);
  assert.equal(finding.severity, "blocking");
  assert.equal(finding.target, "reporter.firmRegistrationNumber");
});

test("an empty or blank waiver is not a waiver", () => {
  // "Not applicable" with nothing to say why is a state a certificate could not defend, so the
  // reason IS the waiver rather than a companion to a flag.
  for (const blank of ["", "   ", null, undefined]) {
    assert.equal(firmFindings(assemble(profile({ firmRegistrationWaiver:blank }))).length, 1, `${JSON.stringify(blank)} must not waive`);
  }
});

test("the reason travels to the certificate input, not just a boolean", () => {
  const input = assemble(profile({ firmRegistrationWaiver:WAIVER }));
  assert.equal(input.reporter.firmRegistration.applicable, false);
  assert.equal(input.reporter.firmRegistration.reason, WAIVER);
});

test("a firm-employed reporter is still satisfied by a number", () => {
  // The branch the library has no example of. It must keep working without a store field.
  assert.deepEqual(firmFindings(assemble(profile({ firmRegistrationNumber:"7788" }))), []);
});

test("the waiver is a fact about the reporter, so it needs no per-deposition entry", () => {
  const record = createCanonicalDepositionRecord({ witness:"Heath Thomas", reporterProfile:profile({ firmRegistrationWaiver:WAIVER }) });
  assert.equal(record.reporter.firmRegistrationWaiver.value, WAIVER);
  assert.equal(record.reporter.firmRegistrationWaiver.source, "REPORTER_PROFILE");
});
