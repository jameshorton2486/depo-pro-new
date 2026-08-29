// Phase 1 of O-10. See docs/opening-procedures/authorization-o10-oath-basis-on-the-record.md.
//
// The certification page states, as a literal in both Texas templates, that the witness "was duly
// sworn by the officer". When the record attests the witness was NOT sworn, that sentence is false
// and goes out under the reporter's CSR number. It refuses instead.
//
// Only an explicit false refuses. true and MISSING both generate, and those rows are asserted here
// rather than left implicit, so that phase 1's scope is a tested decision. Anyone who later makes
// MISSING refuse will fail them and has to read why first.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { attestWitnessSworn, readDepositionCorrections } from "../server/deposition-store.mjs";
import { assembleInsertionInput } from "../server/insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet } from "../server/insertion-pages/build-pages.mjs";
import { loadTemplateVariant } from "../server/insertion-pages/templates.mjs";
import { validateInsertionInput } from "../server/insertion-pages/validate.mjs";
import { readOpeningState, saveOpeningState } from "../server/opening-procedures.mjs";

let counter = 0;
const nextId = () => `DEP-20260829-OB${String(++counter).padStart(3, "0")}`;

function record() {
  return createCanonicalDepositionRecord({
    court: "45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS", causeNumber: "2026-CI-10001",
    witness: "Jordan Example", depositionDate: "2026-08-01",
    parties: [{ name: "Alex Plaintiff", role: "Plaintiff" }, { name: "Delta Company", role: "Defendant" }],
    attorneys: [
      { name: "Pat Counsel", firm: "Plaintiff Firm", address: "100 Main, San Antonio, Texas", phone: "210-555-0101", represents: ["Alex Plaintiff"], side: "PLAINTIFF" },
      { name: "Dana Counsel", firm: "Defense Firm", address: "200 Main, San Antonio, Texas", phone: "210-555-0102", represents: ["Delta Company"], side: "DEFENDANT" },
    ],
    reporterProfile: { name: "Riley Reporter", licenseNumber: "1234", csrExpiration: "2027-12-31", company: "Reporter Firm", firmRegistrationNumber: "5678", address: "300 Main, San Antonio, Texas", phone: "210-555-0103" },
  });
}

/** A throwaway deposition on disk. No specimen and no real matter. */
function scratch(t) {
  const depositionId = nextId();
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-oath-"));
  t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  const folder = path.join(storageRoot, "reporter", "cause", "witness");
  fs.mkdirSync(path.join(folder, "intake"), { recursive: true });
  fs.writeFileSync(path.join(folder, "deposition.json"), JSON.stringify({ id: depositionId }));
  fs.writeFileSync(path.join(folder, "intake", "canonical-deposition-record.json"), JSON.stringify(record(), null, 2));
  return { depositionId, storageRoot, folder };
}

async function assembled(rec, operatorExtra = {}) {
  const template = await loadTemplateVariant("TEXAS_STATE_SIGNATURE_WAIVED");
  const appearances = rec.counsel.map((a) => ({ ...a, participation: { method: { value: "zoom" }, detail: { value: "Zoom" } } }));
  return assembleInsertionInput({
    record: rec, template, intake: { counselOfRecord: ["Pat Counsel", "Dana Counsel"] },
    operator: {
      jurisdiction: "texas-state", signatureDisposition: "waived", signatureDispositionBasis: "Stated on the record", appearances,
      courtHeadingLine: "IN THE DISTRICT COURT OF", countyCourtLine: "BEXAR COUNTY, TEXAS", judicialDistrictLine: "45TH JUDICIAL DISTRICT",
      proceedingHeading: "ORAL DEPOSITION OF", witnessLocation: { physicalAddress: "San Antonio, Texas" },
      titleNarrative: ["Jordan Example, produced as a witness and duly sworn,", "was taken remotely by Zoom before Riley Reporter,", "Certified Shorthand Reporter in and for Texas."],
      certification: { custodialAttorney: "Pat Counsel", charges: "500.00", chargesResponsibleParty: "Plaintiff", serviceDate: "August 14, 2026", certificationDate: "August 14, 2026", furtherCertificationDate: "August 30, 2026" },
      timeUsed: { totalOnRecordMinutes: 120, parties: [{ name: "Pat Counsel", minutes: 60 }, { name: "Dana Counsel", minutes: 60 }] },
      ...operatorExtra,
    },
    pagination: { index: { appearances: { startPage: 2 }, examinations: [{ examiner: "Pat Counsel", startPage: 5, endPage: 40 }], changesAndSignature: { startPage: 41 }, reportersCertification: { startPage: 41 }, entries: [], actualSectionPages: {}, declaredSectionPages: {} } },
  });
}

const withSworn = (value) => {
  const rec = record();
  rec.deposition.witnessSworn = { value, source: "REPORTER_ENTERED", state: value === null ? "MISSING" : "REPORTER_ADDED", confidence: null, citations: [] };
  return rec;
};
const oathFindings = (input) => validateInsertionInput(input).filter((f) => f.code === "CERT_WITNESS_NOT_SWORN");

test("an attestation that the witness was not sworn blocks the certification page", async () => {
  const input = await assembled(withSworn(false));
  const findings = oathFindings(input);
  assert.equal(findings.length, 1, "exactly one oath-basis finding");
  assert.equal(findings[0].severity, "blocking");
  assert.equal(findings[0].target, "deposition.witnessSworn");
  // Both production call sites gate on any blocking finding before a page is built. Assert the gate
  // the callers apply, not a thrown error.
  assert.ok(validateInsertionInput(input).some((f) => f.severity === "blocking"));
});

test("an attested oath, and an unattested record, both still generate", async () => {
  for (const [label, rec] of [["true", withSworn(true)], ["MISSING", withSworn(null)], ["absent envelope", record()]]) {
    const input = await assembled(rec);
    assert.equal(oathFindings(input).length, 0, `${label} must not raise the oath-basis finding`);
    const set = buildTexasInsertionPageSet(input, { setId: "s", depositionId: "DEP", generatedAt: "2026-08-29T12:00:00.000Z" });
    const text = set.pages.filter((p) => p.role.startsWith("certification")).flatMap((p) => p.lines.map((l) => l.text)).join("\n");
    assert.match(text, /was duly sworn/, `${label} still produces the sworn certificate under phase 1`);
  }
});

// The constraint the whole design rests on. If a dropdown ever writes the attestation, provenance is
// attached to an act the reporter did not intend as one, which reads as attribution while being
// none. A paragraph in the authorization does not survive a refactor; this does.
test("changing the Opening oath selector does not attest anything", (t) => {
  const s = scratch(t);
  const before = readDepositionCorrections(null, s.depositionId, { storageRoot: s.storageRoot }).length;
  saveOpeningState(null, { depositionId: s.depositionId, storageRoot: s.storageRoot, state: { witnessOathSelection: "AFFIRMATION" } });

  assert.equal(readOpeningState(null, { depositionId: s.depositionId, storageRoot: s.storageRoot }).witnessOathSelection, "AFFIRMATION",
    "the workflow value is recorded, as it should be");
  const rec = JSON.parse(fs.readFileSync(path.join(s.folder, "intake", "canonical-deposition-record.json"), "utf8"));
  assert.equal(rec.deposition.witnessSworn?.value ?? null, null, "the selector must not write the attested fact");
  assert.equal(rec.deposition.witnessSworn?.state ?? "MISSING", "MISSING", "and must not move it out of MISSING");
  assert.equal(readDepositionCorrections(null, s.depositionId, { storageRoot: s.storageRoot }).length, before,
    "and must not append to the correction log");
});

test("the attestation is a distinct act, and it carries who, why and at", (t) => {
  const s = scratch(t);
  attestWitnessSworn(null, {
    depositionId: s.depositionId, storageRoot: s.storageRoot, sworn: false,
    who: "Riley Reporter, Texas CSR 1234", why: "The witness declined to swear and affirmed on the record.",
  });
  const rec = JSON.parse(fs.readFileSync(path.join(s.folder, "intake", "canonical-deposition-record.json"), "utf8"));
  assert.equal(rec.deposition.witnessSworn.value, false, "false is an answer, not an absence");
  assert.equal(rec.deposition.witnessSworn.state, "REPORTER_ADDED");
  assert.equal(rec.deposition.witnessSworn.source, "REPORTER_ENTERED");

  const log = readDepositionCorrections(null, s.depositionId, { storageRoot: s.storageRoot });
  assert.equal(log.length, 1);
  assert.equal(log[0].path, "deposition.witnessSworn");
  assert.equal(log[0].to, false);
  assert.ok(log[0].who.trim() && log[0].why.trim() && !Number.isNaN(Date.parse(log[0].at)), "who, why and at are all present");
});

test("an attestation without attribution is refused", (t) => {
  const s = scratch(t);
  const base = { depositionId: s.depositionId, storageRoot: s.storageRoot, sworn: true };
  assert.throws(() => attestWitnessSworn(null, { ...base, who: "", why: "x" }), /requires who/);
  assert.throws(() => attestWitnessSworn(null, { ...base, who: "Riley", why: "  " }), /requires why/);
  assert.throws(() => attestWitnessSworn(null, { ...base, who: "Riley", why: "x", sworn: undefined }), /true or false/);
  assert.throws(() => attestWitnessSworn(null, { ...base, who: "Riley", why: "x", sworn: "OATH" }), /true or false/);
  assert.equal(readDepositionCorrections(null, s.depositionId, { storageRoot: s.storageRoot }).length, 0,
    "nothing reached the log");
});

// Positive control. Without it, a run in which every case returns the same result -- including a
// validator that silently stopped running -- would read as a passing suite. F-21.
test("the harness detects a difference when one exists", async () => {
  const a = await assembled(withSworn(true));
  const b = await assembled(withSworn(true), { proceedingHeading: "ORAL AND VIDEOTAPED DEPOSITION OF" });
  const sha = (input) => buildTexasInsertionPageSet(input, { setId: "s", depositionId: "DEP", generatedAt: "2026-08-29T12:00:00.000Z" }).sha256;
  assert.notEqual(sha(a), sha(b), "changing a field the renderer reads must change the page set");
});
