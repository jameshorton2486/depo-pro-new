// An attorney routinely appears for more than one party. `represents` was a scalar string in the
// extraction schema, so a multi-party representation could not be expressed -- and two certified
// transcripts show what that cost.
//
// Thomas:  "HOME DEPOT U.S.A., INC. A/K/A THE HOME DEPOT AND SHAWN HERBER" over Lucia Zhan,
//          while the canonical record held only Home Depot.
// Etminan: "LEONARDO ISAIAS RODRIGUEZ; SANDY DEAN KOEPKE; AND STANDING SEAM & SPECIALTY
//          COMPANY, INC." over Christian Ramon, while the record held only Koepke and Standing
//          Seam.
//
// Same failure, two independent records, one structural cause.
import assert from "node:assert/strict";
import test from "node:test";
import { extractionTool } from "../server/extraction-schema.mjs";
import { counselEntry } from "../server/canonical-deposition-record.mjs";
import { assembleInsertionInput } from "../server/insertion-pages/assemble.mjs";

const attorneySchema = extractionTool.input_schema.properties.setup.properties.attorneys.items;

test("the extraction schema accepts more than one represented party", () => {
  const represents = attorneySchema.properties.represents;
  assert.equal(represents.type, "array", "a scalar cannot express a multi-party representation");
  assert.equal(represents.items.type, "string");
  assert.equal(represents.minItems, 1, "an attorney appears for at least one party");
});

test("represents is still required, so an omission is visible rather than defaulted", () => {
  assert.ok(attorneySchema.required.includes("represents"));
});

test("a multi-party representation survives into the canonical record", () => {
  const entry = counselEntry({ name:"Lucia D. Zhan", represents:["Home Depot U.S.A., Inc.", "Shawn Herber"] }, 0);
  assert.deepEqual(entry.represents.value, ["Home Depot U.S.A., Inc.", "Shawn Herber"]);
});

test("a legacy scalar record still reads, rather than becoming a per-character array", () => {
  // Records written before this change hold a string. Coercion has to wrap, not spread.
  const entry = counselEntry({ name:"Christian R. Ramon", represents:"Defendants Koepke and Standing Seam" }, 0);
  assert.deepEqual(entry.represents.value, ["Defendants Koepke and Standing Seam"]);
});

test("the appearance page prints every represented party, not the first", () => {
  const assembled = assembleInsertionInput({
    record: {
      counsel: [{ id:"attorney-1", fullName:"Lucia D. Zhan", firm:"Brothers, Alvarado, Piazza & Cozort, P.C.",
        represents:["Home Depot U.S.A., Inc.", "Shawn Herber"], actualAppearance:true }],
      parties: [],
    },
    intake: {}, operator: {}, pagination: {}, template: {},
  });
  assert.deepEqual(assembled.appearances[0].representing, ["Home Depot U.S.A., Inc.", "Shawn Herber"],
    "dropping a party here prints a defendant heading the certified transcript contradicts");
});
