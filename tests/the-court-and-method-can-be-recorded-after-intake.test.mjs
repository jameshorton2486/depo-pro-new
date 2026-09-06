// case.court and deposition.remote had slots in the canonical record, a place on the certified
// page, and no writer after intake. buildCanonicalRecord sets them from a Notice; the manual route
// has no Notice and no fields for them. So a deposition created by the manual route was refused at
// generation for its whole life, on two fields nobody could supply by any route.
//
// The guards here are about what an unanswered control records. An empty string is an answer
// nobody gave: isBlank collapses "" and null, so a blank would render a dropped clause with a
// clean bill of health, which is what UNEXPECTED_BLANK exists to catch. And `remote` is
// three-state on purpose -- a boolean defaulting to false records "taken in person" because nobody
// answered, the same provenance defect the canonical record's own header names.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeDepositionProceeding } from "../server/deposition-store.mjs";

const ID = "DEP-20260828-PROC1";

function throwawayDeposition() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-pro-proceeding-"));
  const directory = path.join(root, "store", "reporter_x", "cause", "witness_2026-08-28");
  fs.mkdirSync(path.join(directory, "intake"), { recursive: true });
  fs.writeFileSync(path.join(directory, "deposition.json"), JSON.stringify({ schemaVersion: "1.0.0", id: ID }));
  const missing = () => ({ value: null, source: "REPORTER_ENTERED", state: "MISSING", confidence: null, citations: [] });
  fs.writeFileSync(path.join(directory, "intake", "canonical-deposition-record.json"), JSON.stringify({
    schemaVersion: "1.0.0",
    case: { court: missing(), county: missing(), causeNumber: missing() },
    deposition: { remote: missing(), location: missing(), remotePlatform: missing(), witness: missing() },
    // These four are canonical deposition facts and are recorded through the correction log now,
    // which demands who made the change. The reporter is read from this record rather than accepted
    // from a caller, so a deposition with nobody on it cannot record them -- and the fixture used
    // to be exactly that, which is how it caught the migration.
    //
    // A real deposition always has one: creation requires a courtReporterId, and this shape is what
    // buildCanonicalRecord produces from it.
    reporter: { fullName: { value: "Miah Bardot", source: "REPORTER_PROFILE", state: "EXTRACTED", confidence: null, citations: [] },
                csrNumber: { value: "12129", source: "REPORTER_PROFILE", state: "EXTRACTED", confidence: null, citations: [] } },
  }));
  return { root, storageRoot: path.join(root, "store"), file: path.join(directory, "intake", "canonical-deposition-record.json") };
}

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

test("a control left alone records MISSING, never an empty string", () => {
  const { root, storageRoot, file } = throwawayDeposition();
  writeDepositionProceeding(root, { depositionId: ID, storageRoot, proceeding: { court: "285th Judicial District Court" } });
  const record = read(file);
  assert.equal(record.case.court.value, "285th Judicial District Court");
  assert.equal(record.case.court.state, "REPORTER_ADDED");
  assert.equal(record.case.court.source, "REPORTER_ENTERED");
  // The three nobody answered. A "" here would pass isBlank and print a dropped clause as complete.
  for (const key of ["location", "remotePlatform"]) {
    assert.equal(record.deposition[key].value, null, `${key} must be null, not an empty string`);
    assert.equal(record.deposition[key].state, "MISSING");
  }
  assert.equal(record.deposition.remote.value, null);
  assert.equal(record.deposition.remote.state, "MISSING");
});

test("in person is recorded as an answer, not collapsed into unrecorded", () => {
  const { root, storageRoot, file } = throwawayDeposition();
  writeDepositionProceeding(root, { depositionId: ID, storageRoot, proceeding: { remote: false, location: "1200 Main Street" } });
  const record = read(file);
  // false is an answer. Read as blank it would become MISSING, and the record would say the
  // reporter never answered a question they did answer.
  assert.equal(record.deposition.remote.value, false);
  assert.equal(record.deposition.remote.state, "REPORTER_ADDED");
  assert.equal(record.deposition.location.value, "1200 Main Street");
});

test("remote is recorded with its platform", () => {
  const { root, storageRoot, file } = throwawayDeposition();
  writeDepositionProceeding(root, { depositionId: ID, storageRoot, proceeding: { remote: true, remotePlatform: "Zoom" } });
  const record = read(file);
  assert.equal(record.deposition.remote.value, true);
  assert.equal(record.deposition.remotePlatform.value, "Zoom");
});

test("the route refuses a field it does not own, by name", () => {
  const { root, storageRoot } = throwawayDeposition();
  assert.throws(
    () => writeDepositionProceeding(root, { depositionId: ID, storageRoot, proceeding: { court: "A court", caseStyle: "Smith v. Jones" } }),
    /Unsupported proceeding field: caseStyle/,
    "a narrow route must not become a general canonical-record patch endpoint",
  );
});

test("the deposition method refuses anything that is not a stated answer", () => {
  const { root, storageRoot } = throwawayDeposition();
  // Separate from the allow-list above so the two guards are distinguishable when either is
  // removed: one keeps the route narrow, this one keeps `remote` from carrying a string that
  // would read as truthy and record a method nobody chose.
  assert.throws(
    () => writeDepositionProceeding(root, { depositionId: ID, storageRoot, proceeding: { remote: "yes" } }),
    /must be true, false, or null/,
  );
});

test("fields the editor does not own are left exactly as they were", () => {
  const { root, storageRoot, file } = throwawayDeposition();
  const before = read(file);
  writeDepositionProceeding(root, { depositionId: ID, storageRoot, proceeding: { court: "285th Judicial District Court" } });
  const after = read(file);
  assert.deepEqual(after.case.county, before.case.county);
  assert.deepEqual(after.case.causeNumber, before.case.causeNumber);
  assert.deepEqual(after.deposition.witness, before.deposition.witness);
});

// The editor shipped with no stylesheet rules of its own and inherited a transparent 195x24 box
// with no border, so the label ran into the field and typed text sat on a background the same
// colour as the page. Measured on the running screen, not asserted from the sheet -- but the rule
// is pinned here because a stylesheet is the one place a working screen silently regresses.
test("the editor's fields are given a field's appearance", () => {
  const sheet = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const rule = sheet.match(/\.proceeding-editor input \{[^}]*\}/)?.[0] ?? "";
  assert.match(rule, /background:#fff/, "an input with no background is indistinguishable from the page");
  assert.match(rule, /border:1px/, "an input with no border has no edges to type inside");
  assert.match(sheet, /\.proceeding-editor label \{[^}]*display:grid/, "an inline label collides with its own field");
  // A radio stretched to the width of a text field is not a radio any more.
  assert.match(sheet, /\.proceeding-method input \{ width:auto/);
});
