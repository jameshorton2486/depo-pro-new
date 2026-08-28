// "Marguerite Okonkwo-Vance, Texas CSR CSR 9174" reached a certified page.
//
// certification-2.tmpl writes the label itself -- "^reporter.name^, Texas CSR ^reporter.csrNumber^"
// -- and the reporter modal calls the field "CSR number", so "CSR 9174" is the natural thing to
// enter. Same defect as the doubled dollar sign, one token over, and found the same way: by reading
// a generated certificate rather than by any test.
//
// Enumerated rather than patched twice. Every template token was checked against the last word of
// the literal preceding it: two double in practice (cert.charges, reporter.csrNumber), two could if
// a reporter typed the label (caption.causeNumber "NO.:", reporter.firmRegistrationNumber "No."),
// and the rest are prose prepositions -- "charges to the ___" reads correctly with a value starting
// "the", so stripping there would corrupt a legitimate entry. The two latent ones are left alone
// deliberately; a strip nobody needs is a way to damage a value nobody typed wrong.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { stripLeadingCsrLabel as strip } from "../server/insertion-pages/assemble.mjs";

const TEMPLATE = fs.readFileSync(new URL("../templates/insertion-pages/TEXAS_STATE_SIGNATURE_WAIVED/certification-2.tmpl", import.meta.url), "utf8");
const SOURCE = fs.readFileSync(new URL("../server/insertion-pages/assemble.mjs", import.meta.url), "utf8");

test("the label the template writes does not survive in the value", () => {
  assert.equal(strip("CSR 9174"), "9174");
  assert.equal(strip("CSR: 9174"), "9174");
  assert.equal(strip("CSR-9174"), "9174");
  assert.equal(strip("csr no. 9174"), "9174", "case and the 'no.' form both count as the label");
  assert.equal(strip("9174"), "9174", "a bare number is untouched");
});

test("only the first label is taken, so a doubled entry stays visibly odd", () => {
  // Same rule as the currency strip: a reporter who typed it twice meant something this cannot
  // guess at, and a certified page must not invent the answer.
  assert.equal(strip("CSR CSR 9174"), "CSR 9174");
});

test("a number that merely begins with those letters is not a label", () => {
  // The word boundary is the whole guard here. Without it "CSRX 9174" loses three characters from
  // a credential number, which is worse than the defect being fixed.
  assert.equal(strip("CSRX 9174"), "CSRX 9174");
  assert.equal(strip("CSR9174"), "CSR9174", "no separator means it is part of the number");
});

test("an unrecorded credential stays unrecorded", () => {
  assert.equal(strip(null), null);
  assert.equal(strip(undefined), undefined);
  assert.equal(strip(""), "");
});

test("the print site strips, and the template still writes the label", () => {
  assert.match(SOURCE, /csrNumber: stripLeadingCsrLabel\(/, "the credential must be stripped where it is printed");
  assert.match(TEMPLATE, /Texas CSR \^reporter\.csrNumber\^/, "the template owns the label; if it stops, the strip becomes wrong");
});
