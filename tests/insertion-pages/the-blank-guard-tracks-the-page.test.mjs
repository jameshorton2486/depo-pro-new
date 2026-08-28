// The blank guard refuses a render over a field that is missing. It is only worth refusing over a
// field that would have reached the page, and the two lists had come apart in both directions.
//
// Blocked but never printed: caption.caseStyle, deposition.proceedingLocation,
// cert.signatureDispositionBasis and reporter.firmName were all in the inventory, so a blank one
// raised UNEXPECTED_BLANK -- yet no caret in any reviewed template names them, so supplying them
// changed nothing on the document. Two already had a specific gate that says more than a blank
// does: validateDepositionMethod knows whether a platform or an address is the one required, and
// validateVariant blocks on the disposition basis by name.
//
// Printed but never checked: caption.plaintiffs and caption.defendants print in the caption block
// of title.tmpl and certification-1.tmpl, in both variants, and were in neither inventory. The
// party names on a certified caption were the part nothing checked.
//
// This file is the outside signal for that: it reads the reviewed templates and the manifests, not
// validate.mjs, so it cannot agree with the validator by construction.
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../../server/canonical-deposition-record.mjs";
import { assembleInsertionInput } from "../../server/insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet } from "../../server/insertion-pages/build-pages.mjs";
import { DEFAULT_TEMPLATE_ROOT, canonicalTemplateBody, extractCaretInventory, loadTemplateVariant } from "../../server/insertion-pages/templates.mjs";
import { validateInsertionInput } from "../../server/insertion-pages/validate.mjs";

const VARIANTS = ["TEXAS_STATE_SIGNATURE_REQUESTED", "TEXAS_STATE_SIGNATURE_WAIVED"];

// Guarded without a caret of its own, and legitimately: each is composed into a line that does
// print, so a blank one would reach the page as a missing entry rather than as a missing field.
const COMPOSED = new Map([
  ["appearances.counsel", "appearances.lines"],
  ["index.examinations", "index.lines"],
  ["index.changesAndSignature", "index.lines"],
  ["index.reportersCertification", "index.lines"],
]);

async function caretsByRole(variant) {
  const directory = path.resolve(DEFAULT_TEMPLATE_ROOT, variant);
  const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
  const carets = new Map();
  for (const [role, specification] of Object.entries(manifest.templates)) {
    if (role === "fieldInventory") continue;
    const body = canonicalTemplateBody(await readFile(path.join(directory, specification.file), "utf8"));
    for (const field of extractCaretInventory(body)) carets.set(field, [...(carets.get(field) ?? []), role]);
  }
  return carets;
}

for (const variant of VARIANTS) test(`${variant}: nothing is guarded that cannot reach a page`, async () => {
  const { templates } = await loadTemplateVariant(variant);
  const carets = await caretsByRole(variant);
  const unreachable = templates.fieldInventory.fields
    .filter((field) => !carets.has(field) && !COMPOSED.has(field));
  assert.deepEqual(unreachable, [],
    `these block a render but no reviewed ${variant} template prints them, and none is composed into a line that does`);
});

test("the caption's party names are guarded in both variants", async () => {
  for (const variant of VARIANTS) {
    const { templates } = await loadTemplateVariant(variant);
    const carets = await caretsByRole(variant);
    for (const field of ["caption.plaintiffs", "caption.defendants"]) {
      assert.ok(carets.get(field)?.length, `${variant} prints ${field}`);
      assert.ok(templates.fieldInventory.fields.includes(field),
        `${variant} prints ${field} on ${carets.get(field).join(" and ")} and must not print it unchecked`);
    }
  }
});

const PARTIES = [{ name: "Ruben Vasquez", role: "Plaintiff" }, { name: "Central Texas Logistics, LLC", role: "Defendant" }];

async function assembled(parties) {
  const record = createCanonicalDepositionRecord({
    court: "In the 285th Judicial District Court", causeNumber: "2024-CI-11223",
    caseStyle: "Vasquez v. Central Texas Logistics", witness: "Dr. Priya Ramanathan",
    depositionDate: "2026-09-18", location: "San Antonio", remote: true, remotePlatform: "Zoom",
    parties,
    attorneys: [{ name: "Alicia Moreno", firm: "Moreno Trial Law PLLC", represents: "Plaintiff", side: "PLAINTIFF", appeared: true, participation: { method: "remote-video" } }],
    reporterProfile: {
      name: "Miah Bardot", licenseNumber: "12129", csrExpiration: "2027-06-30",
      address: "7234 Hovingham, San Antonio, Texas 78257", phone: "469 740-9603",
      firmRegistrationWaiver: "Certifies under an individual Texas CSR; no firm registration applies.",
    },
  });
  return assembleInsertionInput({
    record, intake: {}, template: await loadTemplateVariant("TEXAS_STATE_SIGNATURE_REQUESTED"),
    // The certificate fields are supplied because they block now -- the certificate form
    // collects them and they came off INTENTIONAL_BLANKS. Without them this file would be
    // asserting about the certificate, and it is about the caption.
    operator: { jurisdiction: "texas-state", signatureDisposition: "requested", signatureDispositionBasis: "Requested on the record.",
      certification: { custodialAttorney: "Alicia Moreno", charges: "500.00", chargesResponsibleParty: "Plaintiff",
        certificationDate: "August 14, 2026", returnStatus: "August 28, 2026", furtherCertificationDate: "August 30, 2026" } },
    pagination: { index: { entries: [], actualSectionPages: {}, declaredSectionPages: {},
      examinations: [{ examiner: "Ms. Moreno", startPage: 4, endPage: 58 }],
      changesAndSignature: { startPage: 61 }, reportersCertification: { startPage: 63 } } },
  });
}

const blockers = (input) => validateInsertionInput(input)
  .filter((finding) => finding.severity === "blocking").map(({ code, target }) => `${code}:${target}`).sort();

test("a caption with no party in either role is refused, not printed empty", async () => {
  // The whole record, minus the parties. Everything else the certificate needs is supplied above,
  // so the only thing left that can block is the caption.
  assert.deepEqual(blockers(await assembled([])),
    ["UNEXPECTED_BLANK:caption.defendants", "UNEXPECTED_BLANK:caption.plaintiffs"]);
  // A party with no role recorded is the shape the intake path actually produces today: parties
  // arrive as bare strings and createCanonicalDepositionRecord gives a string party no role. It
  // fills neither caption line, and saying so is the point.
  assert.deepEqual(blockers(await assembled(["Ruben Vasquez", "Central Texas Logistics, LLC"])),
    ["UNEXPECTED_BLANK:caption.defendants", "UNEXPECTED_BLANK:caption.plaintiffs"]);
});

test("with the parties recorded the render clears and their names are on the page", async () => {
  const input = await assembled(PARTIES);
  assert.deepEqual(blockers(input), []);
  // Across the boundary: the guard cleared, so the names have to actually be there.
  const pages = buildTexasInsertionPageSet(input, { setId: "s", depositionId: "DEP-20260824-CAP01", generatedAt: "2026-08-24T00:00:00.000Z" });
  const caption = pages.pages.filter(({ role }) => ["title", "certification1"].includes(role));
  assert.equal(caption.length, 2);
  for (const page of caption) {
    const text = page.lines.map(({ text: line }) => line).join("\n");
    assert.match(text, /RUBEN VASQUEZ/, `${page.role} prints the plaintiff`);
    assert.match(text, /CENTRAL TEXAS LOGISTICS, LLC/, `${page.role} prints the defendant`);
  }
});

test("the guard reads the same two lists the caption prints", async () => {
  // One producer. If the caption line and the guarded value were derived separately they could
  // disagree about who the parties are, and the guard would be clearing a line it had not seen.
  const input = await assembled(PARTIES);
  assert.deepEqual(input.fieldValues["caption.plaintiffs"], ["Ruben Vasquez"]);
  assert.deepEqual(input.fieldValues["caption.defendants"], ["Central Texas Logistics, LLC"]);
  // Absent is null, not "". An empty join would say this case has no plaintiffs; the record only
  // says that no party carries the role.
  const none = await assembled([]);
  assert.equal(none.fieldValues["caption.plaintiffs"], null);
  assert.equal(none.fieldValues["caption.defendants"], null);
});
