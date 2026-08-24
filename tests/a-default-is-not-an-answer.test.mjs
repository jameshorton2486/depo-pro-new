import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { DEPONENT_TYPES, deponentTypeOption } from "../app/intake-logistics.mjs";
import { extractedFieldKeys } from "../app/extracted-fields.mjs";
import { createCanonicalDepositionRecord } from "../server/canonical-deposition-record.mjs";

// A deponent type nobody stated is unanswered, not a fact witness.
//
// The setup screen showed "Fact witness" for a Notice that never mentioned one. Two defaults
// stacked to produce it: IntakeScreen wrote `analysis.deponentType || "Fact witness"`, and the
// select then defaulted again on top. The record stored it as a value, and before the provenance
// fix it stored it as a value the Notice had supplied.
//
// The extraction schema asks for `setup.deponentType` as a free-form string with no enum, so a
// returned value may match nothing. The only mention of "expert" for the measured Notice was prose
// in a speaker_map note -- reading a type out of that is the same inference line as reading
// `remote` out of "via Zoom".
const SCREEN = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const INTAKE = fs.readFileSync(new URL("../app/IntakeScreen.tsx", import.meta.url), "utf8");

test("only an exact option match is a deponent type", () => {
  assert.equal(deponentTypeOption("Expert witness"), "Expert witness");
  assert.equal(deponentTypeOption("expert WITNESS"), "Expert witness", "case is not the reporter's problem");
  for (const notAType of ["Expert witness; deponent", "Doctor", "witness", "", "   ", null, undefined]) {
    assert.equal(deponentTypeOption(notAType), undefined, `${JSON.stringify(notAType)} must not become a type`);
  }
});

test("the prose that tempted this is specifically refused", () => {
  // The measured Notice: speaker_map[0].note read "Expert witness; deponent". It is a note, not a
  // field, and a record must name what actually supplied a value.
  assert.equal(deponentTypeOption("Expert witness; deponent"), undefined);
});

test("an unstated deponent type reaches the record as MISSING", () => {
  const record = createCanonicalDepositionRecord({ witness: "W", deponentType: "" }, { noticeSupplied: true });
  assert.equal(record.deposition.representativeCapacity.state, "MISSING");
  assert.equal(record.deposition.representativeCapacity.value, null);
});

test("a stated deponent type is still recorded", () => {
  // The positive control. If the rule were "never record one" the test above would pass while the
  // screen became useless.
  const record = createCanonicalDepositionRecord(
    { witness: "W", deponentType: "Expert witness", extractedFields: ["deponentType"] }, { noticeSupplied: true });
  assert.equal(record.deposition.representativeCapacity.value, "Expert witness");
  assert.equal(record.deposition.representativeCapacity.state, "EXTRACTED");
});

test("it is declared as extracted only when the extraction supplied a mappable value", () => {
  const supplied = extractedFieldKeys({ deponentType: "Expert witness" }, key => ({ deponentType: "Expert witness" }[key] ?? ""));
  assert.ok(supplied.includes("deponentType"));
  const prose = extractedFieldKeys({ deponentType: "Expert witness; deponent" }, key => ({ deponentType: "Expert witness" }[key] ?? ""));
  assert.ok(!prose.includes("deponentType"), "a note is not an extracted field");
  const chosen = extractedFieldKeys({}, key => ({ deponentType: "Party" }[key] ?? ""));
  assert.ok(!chosen.includes("deponentType"), "the reporter chose it; the Notice did not");
});

test("the screen carries no default deponent type, and its placeholder cannot submit as one", () => {
  // The placeholder must be an empty value, not a label that becomes the answer. "" is unsupplied
  // everywhere in this codebase, so an untouched control says nothing rather than saying the first
  // option.
  assert.ok(!/deponentType[^>]*\|\| "Fact witness"/.test(SCREEN), "the select must not default");
  assert.ok(!/analysis\.deponentType \|\| "Fact witness"/.test(INTAKE), "and intake must not manufacture one");
  assert.match(SCREEN, /<option value="">Not stated<\/option>/, "the placeholder submits nothing");
  for (const option of DEPONENT_TYPES) {
    assert.ok(SCREEN.includes(option) || SCREEN.includes("DEPONENT_TYPES"), `${option} is still offered`);
  }
});

test("an empty reporter store says so before the reporter reaches the disabled control", () => {
  // Item 6. The field is required, the list was empty, and nothing said why until the dropdown had
  // one unusable entry in it.
  assert.match(SCREEN, /no court reporter is saved on this computer yet/,
    "an empty store must explain itself at the field, not at the dropdown");
  assert.match(SCREEN, /reporters\.length \?/, "and only when it is actually empty");
});
