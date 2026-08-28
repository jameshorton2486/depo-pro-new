// Creating a deposition with no Notice to read.
//
// The provenance assertions here run at the CALL SITE -- through
// createCanonicalDepositionRecord, the way a real manual intake reaches the canonical record --
// rather than against counselEntry's `source` option in isolation. Mutating the tag constant
// alone would not tell us the manual path is wired to it, and a rule nothing invokes enforces
// nothing.
import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";
import { KEYTERM_PRODUCT_CAP } from "../server/keyterm-limits.mjs";
import { deriveManualKeyterms, manualIntakeAnalysis, validateManualIntake } from "../app/manual-intake.mjs";

const entered = () => ({
  caseStyle: "Alex Plaintiff v. Delta Company",
  witness: "Jordan Example",
  causeNumber: "2026-CI-10001",
  depositionDate: "2026-08-27",
  deponentType: "Fact witness",
  attorneys: [
    { name: "Pat Counsel", firm: "Plaintiff Firm", represents: ["Alex Plaintiff"] },
    { name: "Dana Counsel", firm: "Defense Firm", represents: ["Delta Company"] },
  ],
  parties: [{ name: "Alex Plaintiff", role: "Plaintiff" }, { name: "Delta Company", role: "Defendant" }],
});

test("manual intake refuses each required field by name rather than filling it in", () => {
  for (const key of ["caseStyle", "witness", "causeNumber", "depositionDate", "deponentType"]) {
    const problems = validateManualIntake({ ...entered(), [key]: "" });
    assert.equal(problems.length, 1, `omitting ${key} produced ${problems.length} problems`);
    assert.equal(problems[0].field, key);
    assert.match(problems[0].code, /^MANUAL_INTAKE_[A-Z]+_REQUIRED$/);
    // Reporter-facing prose, not an enum echoed onto the screen.
    assert.ok(problems[0].message.length > 15 && !/[A-Z_]{6,}/.test(problems[0].message));
  }
  assert.deepEqual(validateManualIntake(entered()), []);
});

// The shape ManualIntakeForm actually submits: `represents` is one text field per counsel row, so
// it arrives as a STRING. Every other test here passes an array, which is what the extraction path
// produces -- and that difference is why the first real submit threw
// "(attorney.represents ?? []).map is not a function" with a fully green suite behind it. The
// module was only ever fed a shape its real caller does not produce.
test("the shape ManualIntakeForm submits is accepted, with represents as a string", () => {
  const fromTheForm = {
    caseStyle: "Rivera v. Northgate Logistics",
    witness: "Marguerite Okonkwo-Vance",
    causeNumber: "2026-CI-88214",
    depositionDate: "2026-08-27",
    deponentType: "Fact witness",
    attorneys: [{ name: "Teodora Marchetti", firm: "Marchetti and Vaughn LLP", represents: "Yolanda Rivera" }],
    parties: [{ name: "Yolanda Rivera", role: "Plaintiff" }],
  };
  assert.deepEqual(validateManualIntake(fromTheForm), []);
  const analysis = manualIntakeAnalysis(fromTheForm);
  assert.deepEqual(analysis.attorneys[0].represents, ["Yolanda Rivera"]);
  assert.equal(analysis.attorneys[0].id, "attorney-1");
  // An empty text field is no representation, not a representation of "".
  assert.deepEqual(manualIntakeAnalysis({ ...fromTheForm, attorneys: [{ name: "Solo Counsel", represents: "" }] }).attorneys[0].represents, []);
});

test("counsel become canonical records with stable ids, never prose", () => {
  const analysis = manualIntakeAnalysis(entered());
  assert.deepEqual(analysis.attorneys.map(attorney => attorney.id), ["attorney-1", "attorney-2"]);
  assert.equal(analysis.attorneys[0].name, "Pat Counsel");
  // The examiner is stored on the assembly as a counsel id. Counsel captured as a name would
  // leave examiner selection with nothing to reference.
  for (const attorney of analysis.attorneys) assert.equal(typeof attorney.id, "string");
  assert.deepEqual(analysis.parties.map(party => party.id), ["party-1", "party-2"]);
});

test("a manually entered deposition carries REPORTER_ENTERED, never NOD_EXTRACTED", () => {
  const analysis = manualIntakeAnalysis(entered());
  // Exactly how deposition-store builds it for an intake with no notice file: noticeSupplied is
  // Boolean(noticeName), and manual intake uploads none.
  const record = createCanonicalDepositionRecord(
    { ...analysis, extractedFields: [] },
    { noticeSupplied: false },
  );

  for (const counsel of record.counsel) {
    assert.equal(counsel.fullName.source, "REPORTER_ENTERED", `counsel ${counsel.id} cites the wrong source`);
    assert.notEqual(counsel.fullName.source, "NOD_EXTRACTED");
  }
  assert.equal(record.case.caseStyle.source, "REPORTER_ENTERED");
  assert.equal(record.case.causeNumber.source, "REPORTER_ENTERED");
  assert.equal(record.deposition.witness.source, "REPORTER_ENTERED");
  for (const party of record.parties) assert.equal(party.name.source, "REPORTER_ENTERED");

  // No field that HAS a value may cite a Notice, because there was no Notice.
  //
  // Deliberately not a string match on the whole record. An unfilled field may legitimately name
  // NOD_EXTRACTED as the source it would come from -- nonappearance.scheduledTime does, with
  // value null and state MISSING -- and that is the missing-value design working, not a false
  // claim. What would be a defect is a value a reporter typed carrying a Notice as its source.
  const claimed = [];
  (function walk(node, trail) {
    if (!node || typeof node !== "object") return;
    if (node.source === "NOD_EXTRACTED" && node.value !== null && node.value !== undefined) claimed.push(trail);
    for (const [key, value] of Object.entries(node)) walk(value, trail ? `${trail}.${key}` : key);
  })(record, "");
  assert.deepEqual(claimed, [], `these fields hold a value but cite a Notice that was never supplied: ${claimed.join(", ")}`);
});

test("manual intake supplies no ufmData, which is what keeps the record from citing a Notice", () => {
  // extractedFieldKeys reads ufmData to decide which keys an extraction produced. A manual
  // intake that populated it would let sourceFor return NOD_EXTRACTED for typed values.
  assert.deepEqual(manualIntakeAnalysis(entered()).ufmData, {});
});

test("keyterms derive from the names supplied, witness first, deduplicated and capped", () => {
  const analysis = manualIntakeAnalysis(entered());
  assert.equal(analysis.keyterms[0], "Jordan Example");
  assert.deepEqual(analysis.keyterms, [
    "Jordan Example", "Pat Counsel", "Dana Counsel", "Plaintiff Firm", "Defense Firm",
    "Alex Plaintiff", "Delta Company",
  ]);
  // buildTermRows reads keyterms as the wire list, so these reach TermReviewTable unchanged.
  assert.deepEqual(analysis.deepgramArtifact.wire, analysis.keyterms);

  // A name repeated as both party and firm is one term, not two.
  const duplicated = deriveManualKeyterms({ witness: "Delta Company", attorneys: [{ name: "Delta Company" }], parties: ["Delta Company"] });
  assert.deepEqual(duplicated, ["Delta Company"]);
  // Initials and honorific fragments are noise on the wire.
  assert.deepEqual(deriveManualKeyterms({ witness: "J", attorneys: [{ name: "Dr" }] }), []);

  const many = deriveManualKeyterms({ witness: "Witness Name", attorneys: Array.from({ length: KEYTERM_PRODUCT_CAP + 40 }, (_, index) => ({ name: `Counsel Number ${index}` })) });
  assert.equal(many.length, KEYTERM_PRODUCT_CAP);
});

test("the manual intake warning states what a Notice would have supplied and this does not", () => {
  const analysis = manualIntakeAnalysis(entered());
  assert.equal(analysis.manualEntry, true);
  assert.equal(analysis.warnings.length, 1);
  assert.match(analysis.warnings[0], /No Notice was analysed/);
  // "confidence" describes an extraction's self-report. There was no extraction, so it must not
  // claim one -- least of all a high one.
  assert.equal(analysis.confidence, "reporter-entered");
});
