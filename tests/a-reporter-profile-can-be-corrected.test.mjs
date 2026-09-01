// A saved reporter profile could not be changed. At all.
//
// Found in Production Trial #1, at the first screen: the deposition could not be created because the
// only reporter in the store carried a mistyped CSR licence number, and there was no way to fix it.
// Measured before writing this:
//
//   createReporter refuses: Court reporter already exists.
//   after import, licenseNumber = "11111"   (unchanged)
//
// createReporter rejects an id it already holds, and importReporters deliberately skips one -- that
// skip is right, because a legacy import must not clobber a profile someone has since corrected. So
// between them there was no path that could change a stored value.
//
// A CSR licence number, an expiration date, an address and a firm registration number all print in
// the signature block of every certificate that reporter signs. A typo in any of them was permanent.
// It is also the most likely reason this store holds two profiles for one reporter: someone hit this
// wall and made a second one.
//
// GENERIC: every reporter, every field, every deposition. Nothing about it is specific to the
// deposition that surfaced it.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createReporter, importReporters, listReporters, updateReporter } from "../server/reporter-store.mjs";

const ID = "11111111-1111-1111-1111-111111111111";
const PROFILE = Object.freeze({
  id: ID, name: "Miah Bardot", licenseNumber: "12121", company: "SA Legal",
  address: "7234 Hovingham, San Antonio, Texas 78257", phone: "469 740-9603",
});

function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-reporter-update-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  createReporter(root, PROFILE);
  return root;
}
const only = root => listReporters(root)[0];

// --- correcting a profile -----------------------------------------------------------------------

test("a mistyped licence number can be corrected", (t) => {
  const root = scratch(t);
  assert.equal(only(root).licenseNumber, "12121");
  const updated = updateReporter(root, { ...PROFILE, licenseNumber: "12129" });
  assert.equal(updated.licenseNumber, "12129");
  assert.equal(only(root).licenseNumber, "12129", "and it is what the store returns afterwards");
});

test("correcting one field leaves the rest of the profile alone", (t) => {
  // The caller sends the whole profile back, the way the counsel and parties editors do. What this
  // pins is that nothing is invented or dropped in the round trip.
  const root = scratch(t);
  updateReporter(root, { ...PROFILE, licenseNumber: "12129" });
  const stored = only(root);
  assert.equal(stored.name, "Miah Bardot");
  assert.equal(stored.company, "SA Legal");
  assert.equal(stored.address, "7234 Hovingham, San Antonio, Texas 78257");
  assert.equal(stored.phone, "469 740-9603");
});

test("the id never moves", (t) => {
  // Depositions reference the reporter by id. A correction that renumbered the profile would leave
  // every deposition pointing at a reporter that no longer exists -- and Etminan already carries a
  // courtReporterId matching no profile in the store, which is what that looks like afterwards.
  const root = scratch(t);
  updateReporter(root, { ...PROFILE, name: "Miah A. Bardot", licenseNumber: "12129" });
  assert.equal(only(root).id, ID);
  assert.equal(listReporters(root).length, 1, "correcting a profile must not leave two");
});

test("every field the signature block prints can be corrected", (t) => {
  const root = scratch(t);
  updateReporter(root, {
    ...PROFILE, licenseNumber: "12129", csrExpiration: "2026-06-30",
    firmRegistrationNumber: "2486", company: "SA Legal Solutions",
    address: "7234 Hovingham, San Antonio, Texas 78257", phone: "469 740-9603",
    email: "miah@example.com",
  });
  const stored = only(root);
  assert.equal(stored.licenseNumber, "12129");
  assert.equal(stored.csrExpiration, "2026-06-30");
  assert.equal(stored.firmRegistrationNumber, "2486");
  assert.equal(stored.company, "SA Legal Solutions");
  assert.equal(stored.email, "miah@example.com");
});

test("a field can be cleared, and reads as unrecorded rather than as a stated blank", (t) => {
  const root = scratch(t);
  updateReporter(root, { ...PROFILE, company: "" });
  assert.equal(only(root).company, "");
});

// --- what it refuses ----------------------------------------------------------------------------

test("updating a reporter who is not there is refused, not quietly created", (t) => {
  // The dangerous direction. An update that fell back to insert would answer "this profile does not
  // exist" by manufacturing one, and the caller would never learn it had the wrong id.
  const root = scratch(t);
  assert.throws(() => updateReporter(root, { ...PROFILE, id: crypto.randomUUID() }), /not found/i);
  assert.equal(listReporters(root).length, 1);
  assert.equal(only(root).licenseNumber, "12121", "a refused update changes nothing");
});

test("an update must name a reporter", (t) => {
  const root = scratch(t);
  assert.throws(() => updateReporter(root, { ...PROFILE, id: "" }), /ID/i);
  assert.throws(() => updateReporter(root, { ...PROFILE, name: "" }), /name is required/i);
  assert.equal(only(root).licenseNumber, "12121");
});

test("an update is validated exactly as a creation is", (t) => {
  // Same normaliser, so the envelope shape that would print "[object Object]" in a signature block is
  // refused here too rather than only on the way in.
  const root = scratch(t);
  assert.throws(() => updateReporter(root, { ...PROFILE, licenseNumber: { value: "12129" } }), /must be text/i);
  assert.equal(only(root).licenseNumber, "12121");
});

// --- what is deliberately unchanged ---------------------------------------------------------------

test("creating still refuses an existing reporter", (t) => {
  // Update is a separate verb. Making create fall through to update would mean a caller that meant to
  // add someone silently overwrote somebody else.
  const root = scratch(t);
  assert.throws(() => createReporter(root, { ...PROFILE, licenseNumber: "99999" }), /already exists/i);
  assert.equal(only(root).licenseNumber, "12121");
});

test("importing still skips a reporter the store already holds", (t) => {
  // Also deliberate, and the reason update had to be its own verb: a legacy import must never clobber
  // a profile that has since been corrected.
  const root = scratch(t);
  updateReporter(root, { ...PROFILE, licenseNumber: "12129" });
  importReporters(root, [{ ...PROFILE, licenseNumber: "12121" }]);
  assert.equal(only(root).licenseNumber, "12129", "the correction survives a later import");
});

test("two reporters remain two reporters", (t) => {
  const root = scratch(t);
  const second = crypto.randomUUID();
  createReporter(root, { id: second, name: "Other Reporter", licenseNumber: "55555" });
  updateReporter(root, { ...PROFILE, licenseNumber: "12129" });
  const stored = listReporters(root);
  assert.equal(stored.length, 2);
  assert.equal(stored.find(r => r.id === ID).licenseNumber, "12129");
  assert.equal(stored.find(r => r.id === second).licenseNumber, "55555", "the other profile is untouched");
});
