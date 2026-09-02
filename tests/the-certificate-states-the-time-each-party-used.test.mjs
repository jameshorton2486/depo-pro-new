// Two clauses on the certified pages that only a fixture could fill.
//
// certification-1 states "That the amount of time used by each party at the deposition is as
// follows:" and then prints ^cert.timeUsedLines^. The only thing that could fill that line was
// operator.timeUsed -- a construction path for tests -- so on every real deposition the
// certificate made that statement over nothing, and no finding was raised. The blank guard could
// not see it: cert.timeUsedLines is composed in build-pages and never reaches fieldValues, so it
// is named in no inventory, and renderTemplatePage drops a line whose fields are all absent. The
// sentence introducing the list printed anyway.
//
// The caption's county and judicial-district lines had the same shape, on the title page and on
// certification-1 in both variants.
//
// These tests drive the store writer and read the produced page, rather than calling the composing
// helpers. A test of the helpers would pass with the print site still reading operator.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { addCanonicalOath } from "./canonical-oath-fixture.mjs";
import { readDepositionAttorneyTime, writeDepositionAttorneyTime } from "../server/deposition-store.mjs";
import { assembleInsertionInput } from "../server/insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet } from "../server/insertion-pages/build-pages.mjs";
import { DEFAULT_TEMPLATE_ROOT, canonicalTemplateBody, loadTemplateVariant } from "../server/insertion-pages/templates.mjs";
import { TIME_USED_CERTIFIED, validateInsertionInput } from "../server/insertion-pages/validate.mjs";

// A fixture that renders a certificate has to carry what the certificate asserts. The caption
// parties were already here for that reason; the oath is the same class of fact. Attesting it is
// not scaffolding to get past validation -- an unattested record now refuses, correctly, because
// the page states the witness was duly sworn.
const attested = (input) => {
  const rec = createCanonicalDepositionRecord(input);
  rec.deposition.witnessSworn = { value: true, source: "REPORTER_ENTERED", state: "REPORTER_ADDED", confidence: null, citations: [] };
  addCanonicalOath(rec);
  return rec;
};


const ID = "DEP-20260828-TIME1";
const REPORTER = { name: "Riley Reporter", licenseNumber: "1234", csrExpiration: "2027-12-31", company: "Reporter Firm", firmRegistrationNumber: "5678", address: "300 Main, San Antonio, Texas", phone: "210-555-0103" };
const ATTORNEYS = [{ name: "Pat Counsel", firm: "Plaintiff Firm", address: "100 Main, San Antonio, Texas", phone: "210-555-0101", represents: ["Alex Plaintiff"], side: "PLAINTIFF", appeared: true }];
const PARTIES = [{ name: "Alex Plaintiff", role: "Plaintiff" }, { name: "Delta Company", role: "Defendant" }];

// A throwaway record on disk, so the writer is exercised where it actually runs. The canonical
// record is the real one rather than a hand-built stub -- a stub would let the writer put
// attorneyTime somewhere createCanonicalDepositionRecord does not declare it.
function throwawayDeposition(caseFields = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-pro-attorney-time-"));
  const directory = path.join(root, "store", "reporter_x", "cause", "witness_2026-08-28");
  fs.mkdirSync(path.join(directory, "intake"), { recursive: true });
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ schemaVersion: "1.0.0", id: ID }));
  const record = attested({
    court: "45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS", causeNumber: "2026-CI-10001",
    witness: "Jordan Example", depositionDate: "2026-08-01", remote: true, remotePlatform: "Zoom",
    parties: PARTIES, attorneys: ATTORNEYS, reporterProfile: REPORTER, ...caseFields,
  });
  const file = path.join(directory, "intake", "canonical-deposition-record.json");
  fs.writeFileSync(file, JSON.stringify(record));
  return { root, storageRoot: path.join(root, "store"), file };
}

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

// Deliberately supplies no countyCourtLine, no judicialDistrictLine and no timeUsed. Those three
// are what the record is now expected to answer, and leaving them in the operator payload would
// mean these tests passed with the print sites unchanged.
async function generated(record, { variant = "TEXAS_STATE_SIGNATURE_WAIVED" } = {}) {
  const template = await loadTemplateVariant(variant);
  const appearances = record.counsel.map((attorney) => ({ ...attorney, participation: { method: { value: "zoom" }, detail: { value: "Zoom" } } }));
  const input = assembleInsertionInput({
    record, template, intake: { counselOfRecord: ATTORNEYS.map((a) => a.name) },
    operator: {
      jurisdiction: "texas-state", signatureDisposition: "waived", signatureDispositionBasis: "Stated on the record", appearances,
      courtHeadingLine: "IN THE DISTRICT COURT OF", proceedingHeading: "ORAL DEPOSITION OF",
      witnessLocation: { physicalAddress: "San Antonio, Texas" },
      titleNarrative: ["Jordan Example, produced as a witness and duly sworn,"],
      certification: { custodialAttorney: "Pat Counsel", charges: "500.00", chargesResponsibleParty: "Plaintiff", serviceDate: "August 14, 2026", certificationDate: "August 14, 2026" },
    },
    pagination: { index: { appearances: { startPage: 2 }, examinations: [{ examiner: "Pat Counsel", startPage: 3, endPage: 40 }], reportersCertification: { startPage: 41 } } },
  });
  const blockers = validateInsertionInput(input).filter((finding) => finding.severity === "blocking");
  return { input, blockers, pages: blockers.length ? null : buildTexasInsertionPageSet(input, { setId: "s", depositionId: ID, generatedAt: "2026-08-28T00:00:00.000Z" }) };
}

const textOf = (pages) => pages.pages.flatMap((page) => page.lines).map((line) => line.text);

// The outside signal for the variant list in validate.mjs. It reads the reviewed template bodies
// and the manifests, not the validator, so it cannot agree with the validator by construction --
// a new reviewed certificate that prints the clause and is left off the list fails here.
test("every reviewed certificate that states the clause is on the list that guards it", async () => {
  const variants = ["TEXAS_STATE_SIGNATURE_REQUESTED", "TEXAS_STATE_SIGNATURE_WAIVED", "FEDERAL_SIGNATURE_REQUESTED", "FEDERAL_SIGNATURE_WAIVED"];
  const stating = [];
  for (const variant of variants) {
    const directory = path.resolve(DEFAULT_TEMPLATE_ROOT, variant);
    const manifestPath = path.join(directory, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    for (const [role, specification] of Object.entries(manifest.templates)) {
      if (role === "fieldInventory") continue;
      const body = canonicalTemplateBody(await readFile(path.join(directory, specification.file), "utf8"));
      if (body.includes("^cert.timeUsedLines^")) { stating.push(variant); break; }
    }
  }
  assert.deepEqual([...TIME_USED_CERTIFIED].sort(), stating.sort(),
    "a reviewed certificate states the time each party used and is not on the list that refuses to state it over nothing");
});

test("nothing recorded refuses generation, and says so by name", async () => {
  const { file } = throwawayDeposition();
  const { blockers, pages } = await generated(read(file));
  assert.equal(pages, null, "the certificate generated with no party time recorded");
  const finding = blockers.find((item) => item.code === "CERT_TIME_USED_UNRECORDED");
  assert.ok(finding, `no refusal; got ${blockers.map((b) => b.code).join(", ") || "none"}`);
  assert.equal(finding.target, "cert.timeUsedLines");
});

test("what the writer records is what the certificate states", async () => {
  const { root, storageRoot, file } = throwawayDeposition();
  writeDepositionAttorneyTime(root, { depositionId: ID, storageRoot, attorneyTime: [{ name: "Pat Counsel", minutes: 95 }, { name: "Dana Counsel", minutes: 0 }] });

  const stored = read(file).certification.attorneyTime;
  assert.equal(stored.length, 2);
  assert.equal(stored[0].name.source, "REPORTER_ENTERED");
  assert.equal(stored[0].name.state, "REPORTER_ADDED");
  assert.equal(stored[1].minutes.value, 0, "a party who used no time was dropped from the record");

  const { blockers, pages } = await generated(read(file));
  assert.deepEqual(blockers.map((b) => b.code), [], "generation refused after the time was recorded");
  // The composed list is one string and the page is fixed-width, so it wraps across physical
  // lines. Read the page flattened rather than asserting about any single line.
  const printed = textOf(pages).join(" ").replace(/\s+/g, " ");
  assert.match(printed, /Pat Counsel - 01 HOURS:35 MINUTES/);
  // Zero is an answer the certificate can state. Dropping it would remove a party from a
  // certified list on the strength of their number.
  assert.match(printed, /Dana Counsel - 00 HOURS:00 MINUTES/);
});

test("the reader returns the list the form has to show before it replaces it", () => {
  const { root, storageRoot } = throwawayDeposition();
  assert.deepEqual(readDepositionAttorneyTime(root, { depositionId: ID, storageRoot }).attorneyTime, []);
  writeDepositionAttorneyTime(root, { depositionId: ID, storageRoot, attorneyTime: [{ name: "Pat Counsel", minutes: 60 }] });
  assert.deepEqual(readDepositionAttorneyTime(root, { depositionId: ID, storageRoot }).attorneyTime, [{ name: "Pat Counsel", minutes: 60 }]);
});

test("the writer refuses a duration nobody gave", () => {
  const { root, storageRoot } = throwawayDeposition();
  const write = (attorneyTime) => () => writeDepositionAttorneyTime(root, { depositionId: ID, storageRoot, attorneyTime });
  assert.throws(write([{ name: "Pat Counsel" }]), /whole number of minutes/);
  assert.throws(write([{ name: "Pat Counsel", minutes: -5 }]), /not negative/);
  assert.throws(write([{ name: "Pat Counsel", minutes: 12.5 }]), /whole number of minutes/);
  assert.throws(write([{ name: "  ", minutes: 10 }]), /requires a name/);
  assert.throws(write([{ name: "Pat Counsel", minutes: 10, rate: 400 }]), /Unsupported attorney time field: rate/);
  assert.throws(write("60"), /must be an array/);
});

test("the caption's county and district lines come from the record, not from the operator", async () => {
  const { file } = throwawayDeposition({ county: "Bexar", judicialDistrict: "45" });
  const record = read(file);
  record.certification.attorneyTime = [{ name: { value: "Pat Counsel" }, minutes: { value: 60 } }];
  const { blockers, pages } = await generated(record);
  assert.deepEqual(blockers.map((b) => b.code), []);
  const lines = textOf(pages);
  assert.ok(lines.some((text) => text.includes("BEXAR COUNTY, TEXAS")), `no county line; got ${lines.slice(0, 8).join(" | ")}`);
  assert.ok(lines.some((text) => text.includes("45TH JUDICIAL DISTRICT")), "no judicial district line");
});

test("a county or district recorded with its own words is not printed twice", async () => {
  const { file } = throwawayDeposition({ county: "Bexar County", judicialDistrict: "285th Judicial District" });
  const record = read(file);
  record.certification.attorneyTime = [{ name: { value: "Pat Counsel" }, minutes: { value: 60 } }];
  const { pages } = await generated(record);
  const lines = textOf(pages);
  assert.ok(lines.some((text) => text.includes("BEXAR COUNTY, TEXAS")), "the county line is missing");
  assert.ok(!lines.some((text) => text.includes("COUNTY COUNTY")), "the county line prints the word twice");
  assert.ok(lines.some((text) => text.includes("285TH JUDICIAL DISTRICT")), "the district line is missing");
  assert.ok(!lines.some((text) => text.includes("DISTRICT JUDICIAL DISTRICT")), "the district line prints the words twice");
});

test("an unrecorded county names no court at all", async () => {
  const { file } = throwawayDeposition({ judicialDistrict: "45" });
  const record = read(file);
  record.certification.attorneyTime = [{ name: { value: "Pat Counsel" }, minutes: { value: 60 } }];
  const { pages } = await generated(record);
  // Not "COUNTY, TEXAS" with nothing in front of it: a caption line naming no county is a
  // confident wrong answer about which court holds this record.
  assert.ok(!textOf(pages).some((text) => text.includes("COUNTY, TEXAS")), "the caption printed a county line with no county");
});
