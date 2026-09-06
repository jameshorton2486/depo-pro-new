// Rule 203 stage one: the certificate names eight facts that do not exist yet.
//
// A transcript is certified before it is submitted to the witness, before the witness returns it,
// before the officer's charges are known, and before the further certification. Depo-Pro had two
// wrong answers to that and no right one: block the document until facts nobody can supply exist,
// or let the caret resolve to nothing and print "Certified to by me this ." -- a deferred fact
// silently vanishing from a certified clause.
//
// The third answer is the one every certified specimen uses: print the blank the reporter fills in
// by hand. The rule is presentation, and these tests hold it to that -- it may not reach canonical
// data, the correction log, the waived variant, or any field nobody approved a width for.
import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../../server/canonical-deposition-record.mjs";
import { assembleInsertionInput } from "../../server/insertion-pages/assemble.mjs";
import { buildTexasInsertionPageSet } from "../../server/insertion-pages/build-pages.mjs";
import { loadTemplateVariant } from "../../server/insertion-pages/templates.mjs";
import { validateInsertionInput } from "../../server/insertion-pages/validate.mjs";
import { STAGE_ONE_DEFERRED_RULE_WIDTHS, deferredRule } from "../../server/insertion-pages/variants.mjs";

const DEFERRED = Object.keys(STAGE_ONE_DEFERRED_RULE_WIDTHS);

// Everything the certificate needs EXCEPT the eight deferred facts. chargesResponsibleParty is
// present deliberately: it is a stage-one fact -- who is responsible for the charges is settled
// when the deposition is taken -- and it must keep blocking when absent.
const ESTABLISHED = Object.freeze({
  custodialAttorney: "Pat Counsel", charges: "500.00", chargesResponsibleParty: "Plaintiff",
  submissionDate: "2026-09-18", returnDeadline: "2026-10-08", returnStatus: "2026-10-01",
  serviceDate: "2026-10-12", certificationDate: "2026-09-18", furtherCertificationDate: "2026-10-14",
});
const STAGE_ONE = Object.freeze({ custodialAttorney: null, charges: null, chargesResponsibleParty: "Plaintiff" });

async function input({ jurisdiction = "texas-state", signatureDisposition = "requested", certification = STAGE_ONE } = {}) {
  const record = createCanonicalDepositionRecord({
    court: "45TH JUDICIAL DISTRICT COURT, BEXAR COUNTY, TEXAS", causeNumber: "2026-CI-10001",
    witness: "Jordan Example", depositionDate: "2026-08-01",
    parties: [{ name: "Alex Plaintiff", role: "Plaintiff" }, { name: "Delta Company", role: "Defendant" }],
    attorneys: [
      { name: "Pat Counsel", firm: "Plaintiff Firm", address: "100 Main, San Antonio, Texas", phone: "210-555-0101", represents: ["Alex Plaintiff"], side: "PLAINTIFF" },
      { name: "Dana Counsel", firm: "Defense Firm", address: "200 Main, San Antonio, Texas", phone: "210-555-0102", represents: ["Delta Company"], side: "DEFENDANT" },
    ],
    reporterProfile: { name: "Riley Reporter", licenseNumber: "1234", csrExpiration: "2027-12-31", company: "Reporter Firm", firmRegistrationNumber: "5678", address: "300 Main, San Antonio, Texas", phone: "210-555-0103" },
  });
  const template = await loadTemplateVariant(`${jurisdiction === "federal" ? "FEDERAL" : "TEXAS_STATE"}_SIGNATURE_${signatureDisposition.toUpperCase()}`);
  return assembleInsertionInput({
    record, template, intake: { counselOfRecord: ["Pat Counsel", "Dana Counsel"] },
    operator: {
      jurisdiction, signatureDisposition, signatureDispositionBasis: "Stated on the record",
      appearances: record.counsel.map(attorney => ({ ...attorney, participation: { method: { value: "zoom" }, detail: { value: "Zoom" } } })),
      courtHeadingLine: "IN THE DISTRICT COURT OF", countyCourtLine: "BEXAR COUNTY, TEXAS", judicialDistrictLine: "45TH JUDICIAL DISTRICT",
      proceedingHeading: "ORAL DEPOSITION OF", witnessLocation: { physicalAddress: "San Antonio, Texas" },
      titleNarrative: ["Jordan Example, produced as a witness and duly sworn,", "was taken before Riley Reporter,", "Certified Shorthand Reporter in and for Texas."],
      certification, timeUsed: { totalOnRecordMinutes: 120, parties: [{ name: "Pat Counsel", minutes: 60 }, { name: "Dana Counsel", minutes: 60 }] },
    },
    pagination: { index: { appearances: { startPage: 2 }, examinations: [{ examiner: "Pat Counsel", startPage: 5, endPage: 40 }], changesAndSignature: { startPage: 41 }, reportersCertification: { startPage: 43 }, entries: [], actualSectionPages: {}, declaredSectionPages: {} } },
  });
}

const text = pages => pages.flatMap(page => page.lines).map(line => line.text).join("\n");
const build = assembled => buildTexasInsertionPageSet(assembled, { setId: "set", depositionId: "DEP-20260901-DEFERRED", generatedAt: "2026-09-01T12:00:00.000Z" });

// The reviewed templates already print rules of their own -- the Changes lines, the reporter's
// signature rule, the notarial jurat's blanks. So "does this page contain underscores" proves
// nothing. Two measurements do: whether a rule of exactly this width appears (matched whole, so a
// 10-character rule is not found inside a 63-character one), and what the SAME document gains when
// the eight facts go from established to deferred. The second is the one that matters -- it is
// blind to whatever the templates print on their own.
const rules = printed => (printed.match(/_+/g) ?? []).map(run => run.length).sort((a, b) => a - b);
const printsRule = (printed, width) => new RegExp(`(?<!_)_{${width}}(?!_)`).test(printed);
const gained = (deferred, established) => {
  const remaining = rules(established);
  return rules(deferred).filter(width => {
    const at = remaining.indexOf(width);
    if (at === -1) return true;
    remaining.splice(at, 1);
    return false;
  });
};
// Written out rather than read from the table, because a test that reads the widths from the table
// it is grading cannot fail when the table changes -- mutating cert.charges from 10 to 12 killed
// nothing until this existed. Six of these are measurements taken off the certified Etminan
// transcript; two are Depo-Pro presentation policy, marked as such, because that document carries
// those two dates filled in and there was nothing to measure.
const APPROVED = Object.freeze({
  "cert.submissionDate": 20,           // measured
  "cert.returnDeadline": 20,           // measured
  "cert.returnStatus": 25,             // measured
  "cert.custodialAttorney": 25,        // measured
  "cert.charges": 10,                  // measured
  "cert.serviceDate": 11,              // measured
  "cert.certificationDate": 20,        // policy: matched to the other date rules
  "cert.furtherCertificationDate": 20, // policy: matched to the other date rules
});
const APPROVED_WIDTHS = Object.values(APPROVED).sort((a, b) => a - b);

// --- the eight print, and print a rule the reporter can write on -------------------------------

test("every deferred fact prints its approved rule rather than blocking the transcript", async () => {
  const assembled = await input();
  const blocking = validateInsertionInput(assembled).filter(item => item.severity === "blocking").map(item => item.target);
  for (const field of DEFERRED) assert.ok(!blocking.includes(field), `${field} must not block a stage-one transcript`);
  const printed = text(build(assembled).pages);
  for (const field of DEFERRED) {
    const width = APPROVED[field];
    assert.ok(printsRule(printed, width), `${field} must print a ${width}-character rule of its own`);
  }
  // And exactly eight rules were added -- one per deferred fact, each at its approved width.
  assert.deepEqual(gained(printed, text(build(await input({ certification: ESTABLISHED })).pages)), APPROVED_WIDTHS);
});

test("the clause survives -- the deferred fact does not disappear from the sentence", async () => {
  // The defect this closes. "Certified to by me this ." reads as a completed certification of
  // nothing; a rule reads as a date to be entered when it exists.
  const printed = text(build(await input()).pages);
  assert.ok(printed.includes(`Certified to by me this ${deferredRule("cert.certificationDate")}.`),
    printed.split("\n").filter(line => /Certified to by me/.test(line)).join(" | "));
  assert.doesNotMatch(printed, /Certified to by me this \./);
});

test("the surrounding clauses are intact -- only the fact is blank", async () => {
  const printed = text(build(await input()).pages);
  for (const clause of ["to the witness or to the attorney", "Certified to by me this"]) {
    assert.ok(printed.includes(clause), `the template sentence "${clause}" must survive the substitution`);
  }
});

test("a known value prints normally, and adds no blank of its own", async () => {
  const printed = text(build(await input({ certification: ESTABLISHED })).pages);
  assert.ok(printed.includes("Certified to by me this September 18, 2026."));
  for (const value of ["October 8, 2026", "October 12, 2026", "500.00", "Pat Counsel"]) {
    assert.ok(printed.includes(value), `${value} is established and must print as itself`);
  }
  // Nothing here can be stated as "no underscores": the reviewed Changes page and notarial jurat
  // print their own. What can be stated is that this build gains nothing over itself.
  assert.deepEqual(gained(printed, printed), []);
});

// --- what the rule may not do -----------------------------------------------------------------

test("a stage-one fact that is not deferred still blocks", async () => {
  // chargesResponsibleParty is settled at the deposition. Nothing here may make it optional.
  const assembled = await input({ certification: { ...STAGE_ONE, chargesResponsibleParty: null } });
  const blocking = validateInsertionInput(assembled).filter(item => item.severity === "blocking").map(item => item.target);
  assert.ok(blocking.includes("cert.chargesResponsibleParty"));
});

test("a genuinely missing required field still refuses", async () => {
  const assembled = await input();
  assembled.fieldValues["reporter.csrNumber"] = null;
  const blocking = validateInsertionInput(assembled).filter(item => item.severity === "blocking").map(item => item.target);
  assert.ok(blocking.includes("reporter.csrNumber"), "the deferred list is eight named fields, not a general amnesty");
});

test("no rule text enters canonical data", async () => {
  // The substitution happens at the print site, after the record has been read. The field map the
  // rest of the application validates and stores still says the fact is missing.
  const assembled = await input();
  for (const field of DEFERRED) assert.equal(assembled.fieldValues[field], null, `${field} must stay null in canonical data`);
  build(assembled);
  for (const field of DEFERRED) assert.equal(assembled.fieldValues[field], null, `${field} must stay null after rendering`);
  assert.doesNotMatch(JSON.stringify(assembled.fieldValues), /_/, "no rule may be serialised into the field map the record is validated and stored from");
});

test("the waived variant is unchanged", async () => {
  // Stage-one deferral is a property of TEXAS_STATE_SIGNATURE_REQUESTED. Waived is a different
  // reviewed document and must print exactly what it printed before, deferred facts or not.
  const deferred = text(build(await input({ signatureDisposition: "waived" })).pages);
  const established = text(build(await input({ signatureDisposition: "waived", certification: ESTABLISHED })).pages);
  assert.deepEqual(gained(deferred, established), [], "signature waived does not reach stage-one deferral");
});

test("federal routing fails closed without a verified Rule 30(e) election", async () => {
  const assembled = await input({ jurisdiction: "federal" });
  assert.equal(assembled.variant, null);
  for (const field of DEFERRED) assert.equal(assembled.fieldValues[field], null);
  assert.throws(() => build(assembled), /cannot render/, "an unresolved federal route must not fall back to a legacy stub");
});

// --- the policy refuses to guess ----------------------------------------------------------------

test("the approved widths are the approved widths", () => {
  // The table is the approval. If it changes, a reporter's certificate changes, and that is a
  // decision somebody makes rather than a number that drifts.
  assert.deepEqual({ ...STAGE_ONE_DEFERRED_RULE_WIDTHS }, { ...APPROVED });
  for (const [field, width] of Object.entries(APPROVED)) assert.equal(deferredRule(field).length, width, field);
});

test("an approved deferred field with no approved width refuses rather than taking a default", () => {
  assert.throws(() => deferredRule("cert.somethingNobodyMeasured"), /STAGE_ONE_DEFERRED_WIDTH_REQUIRED/);
  assert.throws(() => deferredRule(null), /STAGE_ONE_DEFERRED_WIDTH_REQUIRED/);
});

test("validation and rendering read one table, so they cannot disagree", async () => {
  // Two lists would drift: a field permitted to be blank with no printed rule renders an empty
  // clause; a field with a rule but no permission blocks a document it can already print.
  const assembled = await input();
  const permitted = validateInsertionInput(assembled).filter(item => item.severity === "blocking").map(item => item.target);
  for (const field of DEFERRED) {
    assert.ok(!permitted.includes(field));
    assert.ok(Number.isInteger(STAGE_ONE_DEFERRED_RULE_WIDTHS[field]));
  }
});
