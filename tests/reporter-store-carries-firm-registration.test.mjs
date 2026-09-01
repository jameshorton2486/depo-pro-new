import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createReporter, importReporters, listReporters } from "../server/reporter-store.mjs";

// This file used to assert the opposite, and the reversal is the point.
//
// REPORTER_FIELDS is a whitelist, firmRegistrationNumber was not on it, and one unguarded line
// therefore stood between a stored profile and a number on a certified page. That was pinned
// deliberately, on the reasoning that no certified document in the library carried such a number, so
// no reporter here needed the field.
//
// The Etminan Notice of Deposition, served 17 April 2026, names "REPORTER & VIDEO: SA Legal
// Solutions". That deposition's certificate prints no registration number -- so the silence the
// whitelist was built on was a certificate omitting a fact, not a certificate denying one.
//
// The reviewed Texas templates carry "Firm Registration No. ^reporter.firmRegistrationNumber^" and
// the reviewed field inventory enumerates it, so the renderer was always right to print a number
// when the record has one. Now a stored profile can carry it there.
//
// Not covered, and deliberately: assembleInsertionInput takes an operator.reporter override that
// bypasses the store entirely. The app never populates it; it is noted so a future caller that does
// finds this comment rather than nothing.
const profile = (extra) => ({
  id: crypto.randomUUID(), name: "Miah Bardot", licenseNumber: "12129",
  address: "7234 Hovingham, San Antonio, Texas 78257", phone: "469 740-9603", ...extra,
});

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-reporters-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("a profile written through the store carries its firm registration number", (t) => {
  const root = scratch(t);
  createReporter(root, profile({ firmRegistrationNumber: "2486", company: "SA Legal Solutions" }));
  const [stored] = listReporters(root);
  assert.equal(stored.firmRegistrationNumber, "2486");
  assert.equal(stored.company, "SA Legal Solutions");
});

test("the same holds through the legacy import path", (t) => {
  // Two ways in. A field that survives only one of them reaches a certificate only sometimes.
  const root = scratch(t);
  importReporters(root, [profile({ firmRegistrationNumber: "2486" })]);
  const [stored] = listReporters(root);
  assert.equal(stored.firmRegistrationNumber, "2486");
});

test("a number is stored as the text the certificate prints", (t) => {
  const root = scratch(t);
  createReporter(root, profile({ firmRegistrationNumber: 2486 }));
  assert.equal(listReporters(root)[0].firmRegistrationNumber, "2486");
});

test("an unrecorded number is empty, not absent, so nothing downstream has two ways to be missing", (t) => {
  const root = scratch(t);
  createReporter(root, profile());
  const [stored] = listReporters(root);
  assert.ok("firmRegistrationNumber" in stored);
  assert.equal(stored.firmRegistrationNumber, "");
});

test("a value that is not text is refused rather than stringified onto a certificate", (t) => {
  // The risk this field brings that the others do not make obvious. text() is String(value), so a
  // JSON body sending { firmRegistrationNumber: { value: "2486" } } -- the canonical envelope shape,
  // which is exactly what a caller reading the record would send back -- would store the literal
  // "[object Object]" and print it in the signature block of a certified transcript.
  //
  // Refused for every field on the whitelist, not just this one: a name or an address mangled the
  // same way is the same defect on the same page.
  const root = scratch(t);
  for (const shape of [{ value: "2486" }, ["2486"], { toString: () => "2486" }]) {
    assert.throws(() => createReporter(root, profile({ firmRegistrationNumber: shape })), /must be text/i,
      `${JSON.stringify(shape)} must be refused`);
  }
  assert.throws(() => createReporter(root, profile({ name: { value: "Miah Bardot" } })), /must be text/i,
    "and the same guard covers the other fields");
  assert.throws(() => importReporters(root, [profile({ firmRegistrationNumber: { value: "2486" } })]), /must be text/i,
    "on both paths in");
  assert.deepEqual(listReporters(root), [], "a refused write stores nothing");
});

test("a number and a waiver can both be recorded, and the store does not adjudicate between them", (t) => {
  // Which one answers the certificate is validateCredentials' question, not the store's. The store
  // refusing the combination would decide a certified page's content from a directory screen.
  const root = scratch(t);
  createReporter(root, profile({ firmRegistrationNumber: "2486", firmRegistrationWaiver: "Individual CSR." }));
  const [stored] = listReporters(root);
  assert.equal(stored.firmRegistrationNumber, "2486");
  assert.equal(stored.firmRegistrationWaiver, "Individual CSR.");
});

test("the rest of the whitelist is unchanged, so this is not asserting nothing", (t) => {
  const root = scratch(t);
  createReporter(root, profile({ company: "SA Legal Solutions", csrExpiration: "2026-06-30", email: "m@example.com", taxId: "x" }));
  const [stored] = listReporters(root);
  assert.equal(stored.name, "Miah Bardot");
  assert.equal(stored.licenseNumber, "12129");
  assert.equal(stored.company, "SA Legal Solutions");
  assert.equal(stored.csrExpiration, "2026-06-30");
  assert.equal(stored.address, "7234 Hovingham, San Antonio, Texas 78257");
  assert.equal(stored.phone, "469 740-9603");
});
