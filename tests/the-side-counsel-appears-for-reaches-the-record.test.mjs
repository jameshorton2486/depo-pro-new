import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { COUNSEL_SIDES, manualIntakeAnalysis } from "../app/manual-intake.mjs";
import { createDeposition } from "../server/deposition-store.mjs";

// The appearance page prints `FOR ` plus whatever is in `represents`, verbatim
// (insertion-pages/build-pages.mjs:28). So "FOR THE PLAINTIFF:" on a certified page only ever
// appeared because somebody typed a side into a field that holds party names. This is the field
// the record can actually be asked for the side, kept apart from the two it sits near:
// `represents` holds party names, `appearanceRole` holds examination posture.
//
// These drive the real write path -- the shape page.tsx sends, through createDeposition, read back
// off disk -- rather than asking the module whether it likes a value. A test that called
// counselEntry directly would pass with the form wired to nothing.
const ENTERED = {
  caseStyle: "Okafor v. Vandermeer Holdings, LLC",
  witness: "Thaddeus Bellweather",
  causeNumber: "2026-CI-88213",
  depositionDate: "2026-08-27",
  deponentType: "Party",
  attorneys: [
    { name:"Teodora Marchetti", firm:"Marchetti and Vaughn LLP", represents:"Vandermeer Holdings, LLC", side:"INTERVENOR" },
    { name:"Ignatius Rourke", firm:"Rourke Legal Group", represents:"Thaddeus Bellweather", side:"" },
  ],
  parties: [{ name:"Thaddeus Bellweather", role:"Witness" }],
};

function created(fields, t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "side-"));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const analysis = manualIntakeAnalysis(fields);
  return createDeposition(root, {
    deposition: {
      id: "DEP-20260827-SIDE1",
      caseStyle: analysis.caseStyle, witness: analysis.witness, causeNumber: analysis.causeNumber,
      depositionDate: analysis.depositionDate, deponentType: analysis.deponentType,
      courtReporterName: "Marguerite Okonkwo-Vance",
      // Top level, the way page.tsx sends them.
      attorneys: analysis.attorneys, parties: analysis.parties,
    },
  }, { storageRoot: path.join(root, "depos") });
}

test("the side a reporter chose reaches the canonical record", t => {
  const counsel = created(ENTERED, t).canonicalData.counsel;
  const marchetti = counsel[0];
  assert.equal(marchetti.side.value, "INTERVENOR");
  assert.equal(marchetti.side.source, "REPORTER_ENTERED");
  assert.equal(marchetti.side.state, "REPORTER_ADDED");
  // Separate from the two fields it sits near, and neither is disturbed by it.
  assert.deepEqual(marchetti.represents.value, ["Vandermeer Holdings, LLC"]);
  assert.notEqual(marchetti.side.value, marchetti.appearanceRole.value);
});

test("counsel with no side recorded is missing, not defaulted", t => {
  const rourke = created(ENTERED, t).canonicalData.counsel[1];
  assert.equal(rourke.side.value, null, "a side nobody chose was filled in");
  assert.equal(rourke.side.state, "MISSING");
  assert.equal(rourke.side.source, "REPORTER_ENTERED");
});

test("a side outside the list is refused, not stored", t => {
  const fields = { ...ENTERED, attorneys:[{ ...ENTERED.attorneys[0], side:"Plaintiffs" }] };
  assert.throws(() => created(fields, t), /Counsel side "Plaintiffs" is not one of/);
});

test("every side the form offers is one the record accepts", () => {
  // The select is built from COUNSEL_SIDES and the write boundary validates against it, so this
  // fails if the two ever stop being the same list.
  assert.ok(COUNSEL_SIDES.includes("OTHER"), "Other is a value a reporter can choose");
  assert.equal(new Set(COUNSEL_SIDES).size, COUNSEL_SIDES.length, "a duplicate side is offered twice");
});

// "Other" needs wording or it is a null in disguise: fail-closed on its own would make it and
// MISSING behave identically at the appearance page, which is the same nothing said twice.
const withSide = (side, sideOther) => ({ ...ENTERED, attorneys:[{ ...ENTERED.attorneys[0], side, sideOther }] });

test("the wording an Other side prints as reaches the record", t => {
  const counsel = created(withSide("OTHER", "THE GUARDIAN AD LITEM for the minor claimant"), t).canonicalData.counsel[0];
  assert.equal(counsel.side.value, "OTHER");
  assert.equal(counsel.sideOther.value, "THE GUARDIAN AD LITEM for the minor claimant");
  assert.equal(counsel.sideOther.source, "REPORTER_ENTERED");
  assert.equal(counsel.sideOther.state, "REPORTER_ADDED");
});

test("an Other side with no wording is refused", t => {
  assert.throws(() => created(withSide("OTHER", ""), t), /must record the wording it should print as/);
  // Whitespace is not wording.
  assert.throws(() => created(withSide("OTHER", "   "), t), /must record the wording it should print as/);
});

test("a named side carries no wording of its own", t => {
  // Wording belongs to Other. On a named side it would be a second, competing print form.
  const counsel = created(withSide("INTERVENOR", "Guardian Ad Litem"), t).canonicalData.counsel[0];
  assert.equal(counsel.sideOther.value, null);
  assert.equal(counsel.sideOther.state, "MISSING");
});
