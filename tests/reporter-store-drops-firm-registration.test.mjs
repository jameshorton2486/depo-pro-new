import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createReporter, importReporters, listReporters } from "../server/reporter-store.mjs";

// One line in reporter-store.mjs decides this, and nothing asserted it.
//
// The reviewed Texas templates carry "Firm Registration No. ^reporter.firmRegistrationNumber^" in
// the signature block, and the reviewed field inventory enumerates the field, so the renderer is
// right to print a number when the record has one. What keeps this reporter's certificates silent
// is that the store never accepts the field in the first place: REPORTER_FIELDS is a whitelist and
// firmRegistrationNumber is not on it, so a profile cannot carry one to the canonical record.
//
// That was a single unguarded line standing between a stored profile and a number on a certified
// page. This makes it load-bearing on purpose. It does not change the whitelist -- it holds it.
//
// Not covered, and deliberately: assembleInsertionInput takes an operator.reporter override that
// bypasses the store entirely. The app never populates it, so it is not a live path; it is noted
// here so a future caller that does populate it finds this comment rather than nothing.
const profile = (extra) => ({
  id: crypto.randomUUID(), name: "Miah Bardot", licenseNumber: "12129",
  address: "7234 Hovingham, San Antonio, Texas 78257", phone: "469 740-9603", ...extra,
});

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-reporters-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

// Every shape a caller might plausibly send it in, including the ones a JSON body produces.
const SHAPES = [
  ["a plain string", { firmRegistrationNumber: "7788" }],
  ["a number", { firmRegistrationNumber: 7788 }],
  ["an empty string", { firmRegistrationNumber: "" }],
  ["a nested object", { firmRegistrationNumber: { value: "7788" } }],
  ["alongside a waiver", { firmRegistrationNumber: "7788", firmRegistrationWaiver: "Individual CSR." }],
  ["with a firm name", { firmRegistrationNumber: "7788", company: "Reporter Firm" }],
];

test("a profile written through the store never carries a firm registration number", (t) => {
  const root = scratch(t);
  for (const [, extra] of SHAPES) createReporter(root, profile(extra));
  const stored = listReporters(root);
  assert.equal(stored.length, SHAPES.length, "every profile was written");
  for (const [index, reporter] of stored.entries()) {
    assert.ok(!("firmRegistrationNumber" in reporter),
      `${SHAPES[index]?.[0] ?? index}: the field must not survive the whitelist`);
  }
});

test("the same holds through the legacy import path", (t) => {
  // Two ways in. A whitelist that only guards one of them guards nothing.
  const root = scratch(t);
  importReporters(root, [profile({ firmRegistrationNumber: "7788" })]);
  const [stored] = listReporters(root);
  assert.ok(stored, "the import wrote a profile");
  assert.ok(!("firmRegistrationNumber" in stored));
});

test("the fields that are on the whitelist do survive, so this is not asserting nothing", (t) => {
  // The positive control. If the store dropped everything, the assertions above would pass while
  // meaning nothing at all.
  const root = scratch(t);
  createReporter(root, profile({ company: "Reporter Firm", firmRegistrationWaiver: "Individual CSR.", firmRegistrationNumber: "7788" }));
  const [stored] = listReporters(root);
  assert.equal(stored.name, "Miah Bardot");
  assert.equal(stored.licenseNumber, "12129");
  assert.equal(stored.company, "Reporter Firm");
  assert.equal(stored.firmRegistrationWaiver, "Individual CSR.", "the waiver is the answer the store does accept");
  assert.ok(!("firmRegistrationNumber" in stored), "and the number is still not, beside it");
});
