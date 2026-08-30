// What a Notice says about a party, and what it does not say about a witness.
//
// Both defects here came out of the Heath Thomas federal notice, and both were the schema's doing
// rather than the model's.
import assert from "node:assert/strict";
import test from "node:test";
import { extractionTool } from "../server/extraction-schema.mjs";
import { PARTY_ROLES, createCanonicalDepositionRecord, partyEntry } from "../server/canonical-deposition-record.mjs";
import { masterDataFromExtraction, canonicalInputFromMaster } from "../server/master-deposition-data.mjs";

const setup = extractionTool.input_schema.properties.setup;

test("a party is a name and a role, and the model cannot merge them", () => {
  // As bare strings there was nowhere to put the role, so it went into the name --
  // "Heath Thomas (Plaintiff)" -- and captionParties composes the caption block from these names,
  // so the parenthetical would have printed on the title page and on certification-1.
  const party = setup.properties.parties.items;
  assert.equal(party.type, "object", "a party cannot be a bare string");
  assert.deepEqual(party.required, ["name", "role"], "the role has to be answered, not left out");
  assert.equal(party.additionalProperties, false);
});

test("the party role the schema permits is the vocabulary the record uses", () => {
  // One vocabulary, shared rather than copied. partyEntry -- the path a reporter's correction takes
  // -- uppercases what it is given and throws on anything outside PARTY_ROLES, so an extraction
  // free to invent a role would produce records a later correction could no longer round-trip.
  const permitted = setup.properties.parties.items.properties.role.enum;
  assert.deepEqual(permitted.filter(value => value !== null), [...PARTY_ROLES]);
  assert.ok(permitted.includes(null), "a notice that does not say which side a party is on gets null");
  assert.throws(() => partyEntry({ name: "A Party", role: "DEPONENT" }), /Unsupported party role/);
  for (const role of PARTY_ROLES) assert.doesNotThrow(() => partyEntry({ name: "A Party", role }));

  // Worth knowing, and not asserted as a guarantee: createCanonicalDepositionRecord builds its
  // parties inline rather than through partyEntry, so it does NOT enforce the enum. Nothing breaks
  // downstream -- captionParties matches /plaintiff/i and /defendant/i, so free text still lands on
  // the right side of the caption -- but the two construction paths do not validate alike, and only
  // the schema now keeps an extraction inside the vocabulary.
  assert.doesNotThrow(() => createCanonicalDepositionRecord({ parties: [{ name: "A Party", role: "DEPONENT" }] }));
});

test("a deponent type nobody stated is not invented", () => {
  // The notice states who is deposed and routinely not in what capacity. Requiring the field left
  // the model no way to say so: on the Thomas notice it answered "party witness" while the same
  // extraction raised a review flag saying the capacity was not stated.
  assert.ok(!setup.required.includes("deponentType"),
    "a required field invites a value where the document supplies none -- the rule this file states about barNumber");

  const silent = masterDataFromExtraction({ setup: { witness: "Heath Thomas", parties: [] } }, { sourceDocument: "Heath_Thomas_NOD.pdf" });
  assert.equal(silent.deposition.representativeCapacity.status, "MISSING");
  assert.equal(silent.deposition.representativeCapacity.sourceType, null,
    "no document may be cited for a capacity no document stated");
  assert.ok(!canonicalInputFromMaster(silent).extractedFields.includes("representativeCapacity"));
});

test("a structured party reaches the canonical record as two separate facts", () => {
  const master = masterDataFromExtraction({
    setup: { witness: "Heath Thomas", parties: [{ name: "Heath Thomas", role: "PLAINTIFF" }, { name: "Home Depot U.S.A., Inc.", role: null }] },
  }, { sourceDocument: "Heath_Thomas_NOD.pdf" });

  assert.equal(master.parties[0].name.value, "Heath Thomas", "the role is not in the name");
  assert.equal(master.parties[0].role.value, "PLAINTIFF");
  assert.equal(master.parties[1].role.status, "MISSING", "a role the notice did not state stays unanswered");

  const record = createCanonicalDepositionRecord(canonicalInputFromMaster(master), { noticeSupplied: true });
  assert.equal(record.parties[0].name.value, "Heath Thomas");
  assert.equal(record.parties[0].role.value, "PLAINTIFF");
  assert.equal(record.parties[1].role.value, null);
});
