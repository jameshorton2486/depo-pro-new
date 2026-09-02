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
// Keyed on the field, not on a list of codes. Phase 2 added a second oath-basis code, and a helper
// that named codes silently reported zero findings for the new one rather than failing -- which is
// the shape of bug that makes a test look like it passed.
const oathFindings = (input) => validateInsertionInput(input).filter((f) => f.target === "deposition.witnessSworn");

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

// Phase 1 read: "an attested oath, and an unattested record, both still generate". That was the
// deliberate scoping decision -- MISSING was the common state, and an unattested certificate was
// treated as a gap rather than a false statement. Phase 2 rejects that reading: the sworn sentence
// is a literal in both templates, so an unattested certificate does not omit the claim, it makes
// it. The case is rewritten rather than deleted, because the change it records is the point.
test("an attested oath generates; an unattested record no longer does", async () => {
  const attested = await assembled(withSworn(true));
  assert.equal(oathFindings(attested).length, 0, "an attested oath raises no oath-basis finding");
  const set = buildTexasInsertionPageSet(attested, { setId: "s", depositionId: "DEP", generatedAt: "2026-08-29T12:00:00.000Z" });
  const text = set.pages.filter((p) => p.role.startsWith("certification")).flatMap((p) => p.lines.map((l) => l.text)).join("\n");
  assert.match(text, /was duly sworn/, "an attested oath still produces the sworn certificate");

  for (const [label, rec] of [["MISSING", withSworn(null)], ["absent envelope", record()]]) {
    const input = await assembled(rec);
    const findings = oathFindings(input);
    assert.equal(findings.length, 1, `${label} must raise the oath-basis finding`);
    assert.equal(findings[0].code, "CERT_OATH_BASIS_UNRESOLVED", `${label} is unresolved, not a refusal to swear`);
    assert.equal(findings[0].severity, "blocking");
    assert.ok(validateInsertionInput(input).some((f) => f.severity === "blocking"), `${label} must stop the page`);
    // The remedy has to be findable. A refusal that does not say where to go is a dead end.
    assert.match(findings[0].message, /Scripts & Oaths/, `${label} must name where the attestation is made`);
  }
});

// FALSE is not MISSING, and the codes must stay apart. A witness who affirmed has already been
// correctly attested; telling that reporter to go and attest would be telling them to redo work
// they did right, and there is no wording that would let the page generate afterwards.
test("a witness who affirmed and a witness nobody asked about are refused differently", async () => {
  const affirmed = oathFindings(await assembled(withSworn(false)));
  const unknown = oathFindings(await assembled(withSworn(null)));
  assert.equal(affirmed[0].code, "CERT_WITNESS_NOT_SWORN");
  assert.equal(unknown[0].code, "CERT_OATH_BASIS_UNRESOLVED");
  assert.notEqual(affirmed[0].code, unknown[0].code, "collapsing these gives the reporter the wrong remedy");
  assert.doesNotMatch(affirmed[0].message, /Scripts & Oaths/, "there is nothing for an affirmation to attest");
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

test("the attestation is a distinct act, and it carries origin, why and at", (t) => {
  const s = scratch(t);
  attestWitnessSworn(null, {
    depositionId: s.depositionId, storageRoot: s.storageRoot, sworn: false,
    why: "The witness declined to swear and affirmed on the record.",
  });
  const rec = JSON.parse(fs.readFileSync(path.join(s.folder, "intake", "canonical-deposition-record.json"), "utf8"));
  assert.equal(rec.deposition.witnessSworn.value, false, "false is an answer, not an absence");
  assert.equal(rec.deposition.witnessSworn.state, "REPORTER_ADDED");
  assert.equal(rec.deposition.witnessSworn.source, "REPORTER_ENTERED");

  const log = readDepositionCorrections(null, s.depositionId, { storageRoot: s.storageRoot });
  assert.equal(log.length, 1);
  assert.equal(log[0].path, "deposition.witnessSworn");
  assert.equal(log[0].to, false);
  assert.equal(log[0].origin, "OPENING");
  assert.ok(log[0].why.trim() && !Number.isNaN(Date.parse(log[0].at)), "origin, why and at are all present");
  // The reporter's own words are what survives. An oath attestation IS a personal legal act, and the
  // temptation is to sign it -- but the application cannot see who is at the keyboard, so a name here
  // would assert the one thing it cannot establish. `why` is typed by a human and is required; that
  // is a claim somebody actually made, rather than one the software made on their behalf.
  assert.match(log[0].why, /declined to swear/);
  assert.equal("who" in log[0], false, "and no name is manufactured to stand behind it");
});

test("the origin is the call site's to state, not its caller's", (t) => {
  // Kills the half of the forgery that lives here. Replacing a forgeable `who` with a forgeable
  // `origin` would move the defect rather than repair it, and the endpoint test cannot see this on
  // its own: a call site that honoured its caller's origin is inert until some route forwards one,
  // so each half passes alone. This is the half that does not need a route to be wrong.
  const s = scratch(t);
  attestWitnessSworn(null, { depositionId: s.depositionId, storageRoot: s.storageRoot, sworn: true,
    why: "I administered the oath on the record.", origin: "AUTOMATION" });
  const log = readDepositionCorrections(null, s.depositionId, { storageRoot: s.storageRoot });
  assert.equal(log[0].origin, "OPENING", "the path that ran names itself");
  assert.equal(JSON.stringify(log[0]).includes("AUTOMATION"), false);
});

test("an attestation with no stated basis is refused, and one cannot be signed", (t) => {
  const s = scratch(t);
  const base = { depositionId: s.depositionId, storageRoot: s.storageRoot, sworn: true };
  assert.throws(() => attestWitnessSworn(null, { ...base, why: "  " }), /requires why/);
  assert.throws(() => attestWitnessSworn(null, { ...base, why: "x", sworn: undefined }), /true or false/);
  assert.throws(() => attestWitnessSworn(null, { ...base, why: "x", sworn: "OATH" }), /true or false/);
  // A caller who supplies a name is refused outright rather than quietly ignored, because a caller
  // who believes they attributed something and did not is worse off than one told they cannot.
  assert.throws(() => attestWitnessSworn(null, { ...base, why: "x", who: "Riley Reporter, Texas CSR 1234" }), /may not name its author/);
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
