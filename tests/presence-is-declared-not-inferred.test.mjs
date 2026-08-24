import assert from "node:assert/strict";
import test from "node:test";
import { createCanonicalDepositionRecord, field } from "../server/canonical-deposition-record.mjs";
import { extractedFieldKeys } from "../app/extracted-fields.mjs";

// Two rules, one record.
//
// 1. Presence is declared, not inferred. The envelope decided state by asking the value:
//    `value===null||value==="" ? "MISSING" : "EXTRACTED"`. A boolean false, an empty array and a
//    zero all answered "I am here", so a checkbox nobody ticked became a finding of the source
//    document -- `remote: false, state: EXTRACTED, source: NOD_EXTRACTED` on a record whose Notice
//    said the deposition WAS remote.
//
// 2. Provenance is per field, not per record. `noticeSupplied ? "NOD_EXTRACTED" : "REPORTER_ENTERED"`
//    was stamped across every field, so filing a Notice made all of them claim it -- including a
//    date the reporter typed and a time zone hardcoded in the setup screen.
//
// Measured on one real record (DEP-20260824-RGALP): 107 envelope fields, 51 stamped NOD_EXTRACTED,
// and 25 of those named the Notice for something it never supplied.
const notice = { noticeSupplied: true };

test("an unsupplied boolean is MISSING, not false", () => {
  const record = createCanonicalDepositionRecord({ witness: "W" }, notice);
  for (const key of ["remote", "videotaped", "interpreted", "corporateRepresentative"]) {
    const item = record.deposition[key];
    assert.equal(item.state, "MISSING", `${key} was not supplied, so it cannot be EXTRACTED`);
    assert.equal(item.value, null, `${key} must not carry a manufactured false`);
  }
});

test("an unsupplied array is MISSING, not an empty list", () => {
  // The same defect wearing a different type. `|| []` manufactured a value out of absence and the
  // envelope then read the result as present, so the record asserted the Notice had listed no
  // governing rules when the Notice had not been asked.
  const record = createCanonicalDepositionRecord({ witness: "W" }, notice);
  for (const [group, key] of [["case", "governingRules"], ["deposition", "corporateTopics"]]) {
    const item = record[group][key];
    assert.equal(item.state, "MISSING", `${group}.${key} was not supplied`);
    assert.equal(item.value, null, `${group}.${key} must not carry a manufactured []`);
  }
});

test("an unsupplied string is MISSING", () => {
  const record = createCanonicalDepositionRecord({ witness: "W" }, notice);
  for (const key of ["location", "remotePlatform", "scheduledStart"]) {
    assert.equal(record.deposition[key].state, "MISSING");
    assert.equal(record.deposition[key].value, null);
  }
});

test("a value that WAS supplied is recorded, including a false", () => {
  // The positive control. If the rule were "booleans are never present" the three tests above
  // would pass while meaning nothing, and a reporter who answered would be overruled.
  const record = createCanonicalDepositionRecord(
    { witness: "W", remote: false, videotaped: true, governingRules: [], location: "San Antonio" }, notice);
  assert.equal(record.deposition.remote.state, "EXTRACTED", "someone answered, and the answer was no");
  assert.equal(record.deposition.remote.value, false);
  assert.equal(record.deposition.videotaped.value, true);
  assert.equal(record.case.governingRules.state, "EXTRACTED", "a supplied empty list is an answer");
  assert.equal(record.deposition.location.value, "San Antonio");
});

test("a hand-typed field is never attributed to the notice", () => {
  // The record may not say a document supplied something the document never supplied. Filing a
  // Notice is not evidence about any particular field.
  const record = createCanonicalDepositionRecord(
    { witness: "W", depositionDate: "2026-09-18", timeZone: "America/Chicago",
      representativeCapacity: "Fact witness", extractedFields: ["witness"] }, notice);
  assert.equal(record.deposition.witness.source, "NOD_EXTRACTED", "the one the extraction did supply");
  for (const key of ["depositionDate", "timeZone", "representativeCapacity"]) {
    assert.equal(record.deposition[key].source, "REPORTER_ENTERED",
      `${key} was typed or defaulted, so the Notice must not be named as its source`);
  }
});

test("with no notice nothing claims one, whatever the caller declares", () => {
  const record = createCanonicalDepositionRecord({ witness: "W", extractedFields: ["witness"] });
  assert.equal(record.deposition.witness.source, "REPORTER_ENTERED");
});

test("the envelope reads presence from the declaration, not from the value", () => {
  // Tested at the envelope rather than only through the record, because the record no longer hands
  // it a manufactured value: the callers were fixed too, so an unsupplied field now arrives as
  // undefined and the old value-inspecting rule would call that MISSING as well. A mutation
  // restoring the old rule passed every record-level test in this file. These are the shapes that
  // tell the two rules apart -- a value that looks present and was not supplied.
  for (const [label, value] of [["false", false], ["an empty array", []], ["zero", 0], ["an empty string", ""]]) {
    const item = field(value, { source: "NOD_EXTRACTED", supplied: false });
    assert.equal(item.state, "MISSING", `${label} was not supplied, so it is MISSING whatever it looks like`);
    assert.equal(item.value, null, `${label} must not be carried when nothing supplied it`);
  }
  // And the same shapes, supplied, are present -- so the rule tracks the declaration both ways.
  for (const [label, value] of [["false", false], ["an empty array", []], ["zero", 0]]) {
    const item = field(value, { source: "REPORTER_ENTERED", supplied: true });
    assert.equal(item.state, "EXTRACTED", `${label} was supplied, so it is an answer`);
    assert.deepEqual(item.value, value);
  }
});

test("the envelope refuses to guess when presence was not declared", () => {
  // The guard that stops this returning. Any future call site that omits both must fail loudly
  // rather than inherit a default, because every default here is a guess about provenance.
  assert.throws(() => field("a value", { source: "NOD_EXTRACTED" }), /cannot be inferred/);
  assert.doesNotThrow(() => field("a value", { source: "NOD_EXTRACTED", supplied: true }));
  assert.doesNotThrow(() => field(null, { source: "NOD_EXTRACTED", state: "MISSING" }));
  assert.equal(field(false, { source: "REPORTER_ENTERED", supplied: false }).value, null,
    "nothing was supplied, so nothing is carried, whatever shape was passed");
});

test("an extraction value the reporter edited becomes the reporter's answer", () => {
  // The review step exists so the reporter can disagree with the extraction. A record that keeps
  // calling the result NOD_EXTRACTED erases that they did.
  const ufm = { case_style: "Vasquez v. Central Texas Logistics", cause_number: "2024-CI-88214",
    deponent: "Dr. Priya Ramanathan", caption: { court: "DISTRICT COURT", county: "BEXAR COUNTY" } };
  const unchanged = extractedFieldKeys(ufm, key => ({
    caseStyle: "Vasquez v. Central Texas Logistics", causeNumber: "2024-CI-88214",
    witness: "Dr. Priya Ramanathan", canonicalCourt: "DISTRICT COURT", canonicalCounty: "BEXAR COUNTY",
  }[key]));
  assert.ok(unchanged.includes("caseStyle") && unchanged.includes("witness") && unchanged.includes("court"));

  const edited = extractedFieldKeys(ufm, key => ({
    caseStyle: "Vasquez v. Central Texas Logistics, LLC", causeNumber: "2024-CI-88214",
    witness: "Dr. Priya Ramanathan", canonicalCourt: "DISTRICT COURT", canonicalCounty: "BEXAR COUNTY",
  }[key]));
  assert.ok(!edited.includes("caseStyle"), "the reporter changed it, so it is their answer now");
  assert.ok(edited.includes("causeNumber"), "and the ones they left alone still belong to the notice");
});

test("a field the extraction never produced is never declared extracted", () => {
  const keys = extractedFieldKeys({ caption: {} }, () => "something the reporter typed");
  assert.deepEqual(keys, [], "nothing was extracted, so nothing may claim to have been");
});
