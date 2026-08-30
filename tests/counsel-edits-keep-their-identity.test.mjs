import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDeposition, readDepositionCounsel, writeDepositionCounsel } from "../server/deposition-store.mjs";

// Counsel could be entered at intake and never corrected: the server capability existed and no
// screen called it. The screen is the gap this closes, and the constraint that matters is identity.
//
// counselEntry falls back to `attorney-${index + 1}` when no id is supplied. So an editor that
// omits the id renumbers counsel by position, and the examiner reference in the assembly and every
// speaker mapping then point at an id that no longer exists -- while the save looks entirely
// successful, the name updates on screen, and the record writes cleanly. That failure surfaces
// later as a missing examiner, screens away from its cause.
//
// These drive the real write path and read the record back, rather than asking the module whether
// it accepts a shape.
//
// WHICH TEST HERE ACTUALLY CATCHES ID REGENERATION: only "removing one counsel does not renumber
// the others". Do not read the others as covering it.
//
// `attorney-${index + 1}` rebuilt from the index reproduces exactly the ids it replaced whenever
// the order is unchanged, so "an edited attorney keeps the id it had" and "the examiner reference
// survives an edit" both PASS under full positional regeneration. That was verified by running the
// mutation, not assumed. Remove a counsel and the survivors shift: attorney-2 becomes attorney-1,
// the examiner reference and every speaker mapping re-point, and the save still reports success.
//
// If this file is ever trimmed, that test is the one to keep.
function deposition(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "counsel-"));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const storageRoot = path.join(root, "depos");
  createDeposition(root, {
    deposition:{
      id:"DEP-20260828-EDIT1", caseStyle:"Whitaker v. Brazos Ridge Logistics, LLC",
      witness:"Dana Ellsworth Whitaker", causeNumber:"2026-CI-90210", depositionDate:"2026-08-28",
      courtReporterName:"Marguerite Okonkwo-Vance",
      attorneys:[
        { name:"Marisol Vantongeren-Okafor", firm:"Vantongeren & Okafor LLP", represents:["Dana Ellsworth Whitaker"], side:"PLAINTIFF" },
        { name:"Rufus Q. Pemberton-Stack", firm:"Brazos Ridge Defense Group", represents:["Brazos Ridge Logistics, LLC"], side:"DEFENDANT" },
      ],
    },
  }, { storageRoot });
  return { root, storageRoot, depositionId:"DEP-20260828-EDIT1" };
}
const rosterOf = ({ root, storageRoot, depositionId }) => readDepositionCounsel(root, { depositionId, storageRoot }).counsel;
const save = ({ root, storageRoot, depositionId }, counsel) => writeDepositionCounsel(root, { depositionId, counsel, storageRoot });

test("an edited attorney keeps the id it had", t => {
  const fixture = deposition(t);
  const before = rosterOf(fixture);
  assert.deepEqual(before.map(entry => entry.id), ["attorney-1", "attorney-2"]);

  // Correct a misspelled name, sending the roster back the way an editing screen would.
  save(fixture, before.map(entry => entry.id === "attorney-1" ? { ...entry, name:"Marisol Vantongeren-Okafor II" } : entry));

  const after = rosterOf(fixture);
  assert.deepEqual(after.map(entry => entry.id), ["attorney-1", "attorney-2"], "an edit renumbered counsel");
  assert.equal(after[0].name, "Marisol Vantongeren-Okafor II");
  assert.equal(after[1].name, "Rufus Q. Pemberton-Stack", "editing one attorney disturbed another");
});

test("the examiner reference survives an edit to the attorney it names", t => {
  const fixture = deposition(t);
  // The assembly stores this id and never a name; if an edit moves it, the examiner is lost.
  const examiningCounselId = "attorney-1";
  const before = rosterOf(fixture);
  save(fixture, before.map(entry => ({ ...entry, firm:`${entry.firm}, P.C.` })));

  const after = rosterOf(fixture);
  const named = after.find(entry => entry.id === examiningCounselId);
  assert.ok(named, "the id the assembly names no longer exists after an edit");
  assert.equal(named.name, "Marisol Vantongeren-Okafor");
  assert.equal(named.firm, "Vantongeren & Okafor LLP, P.C.");
});

test("a counsel added after creation reaches the canonical record", t => {
  const fixture = deposition(t);
  const before = rosterOf(fixture);
  save(fixture, [...before, { name:"Sylvie Adeyemi-Marsh", firm:"Adeyemi-Marsh Trial Law", represents:["Brazos Ridge Logistics, LLC"], side:"INTERVENOR" }]);

  const after = rosterOf(fixture);
  assert.equal(after.length, 3);
  assert.deepEqual(after.slice(0, 2).map(entry => entry.id), ["attorney-1", "attorney-2"], "adding counsel disturbed the existing ids");
  const added = after[2];
  assert.equal(added.name, "Sylvie Adeyemi-Marsh");
  assert.equal(added.side, "INTERVENOR");
  assert.ok(added.id, "the added counsel has no id");
});

test("an edit carries REPORTER_ENTERED, never NOD_EXTRACTED", t => {
  const fixture = deposition(t);
  save(fixture, rosterOf(fixture).map(entry => ({ ...entry, honorific:"Ms." })));

  const file = path.join(fixture.storageRoot, "okonkwo-vance_m", "2026-ci-90210", "whitaker_dana_2026-08-28", "intake", "canonical-deposition-record.json");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const entry of record.counsel) {
    for (const field of ["fullName", "firm", "honorific", "side"]) {
      assert.notEqual(entry[field].source, "NOD_EXTRACTED", `${entry.id}.${field} claims a Notice supplied a reporter's edit`);
      assert.equal(entry[field].source, "REPORTER_ENTERED");
    }
  }
});

test("removing one counsel does not renumber the others", t => {
  // The case that catches positional regeneration. With the order unchanged, an id rebuilt from
  // the index produces exactly the ids it replaced and looks correct; remove the first attorney and
  // the second must still be attorney-2, not renumbered to attorney-1.
  const fixture = deposition(t);
  const before = rosterOf(fixture);
  save(fixture, before.filter(entry => entry.id === "attorney-2"));

  const after = rosterOf(fixture);
  assert.deepEqual(after.map(entry => entry.id), ["attorney-2"], "the surviving counsel was renumbered");
  assert.equal(after[0].name, "Rufus Q. Pemberton-Stack");
});

test("the editor sends each row back with the id it arrived with", async () => {
  // The screen is where the id can be dropped. It sends the roster whole, each row carrying its own
  // id, and a new row deliberately has none so the server assigns one. A screen that rebuilt rows
  // from name and firm alone would renumber counsel on every save.
  const { default: ts } = await import("typescript");
  const url = new URL("../app/CounselEditor.tsx", import.meta.url);
  const text = fs.readFileSync(url, "utf8");
  const source = ts.createSourceFile("CounselEditor.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // The roster loaded from the server is spread whole into state, so the id rides along.
  assert.match(text, /\{ \.\.\.BLANK, \.\.\.entry \}/, "the editor rebuilds rows instead of carrying them");
  // And the save posts that state, not a reconstruction of it.
  assert.match(text, /body:JSON\.stringify\(\{ depositionId, counsel \}\)/, "the editor sends something other than the rows it holds");
  // A new row has no id: BLANK must not invent one.
  let blank = null;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === "BLANK") blank = node.initializer?.getText() ?? "";
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(blank !== null, "BLANK not found");
  assert.doesNotMatch(blank, /\bid\b/, "a new counsel row invents an id the server should assign");
});

test("each persisted counsel row can select an observed Deepgram speaker",()=>{
  const text=fs.readFileSync(new URL("../app/CounselEditor.tsx",import.meta.url),"utf8");
  assert.match(text,/Deepgram speaker/);
  assert.match(text,/speakerAssignmentForCounsel\?\.\(row\.id\)/);
  assert.match(text,/onSpeakerAssignment\?\.\(row\.id,event\.target\.value,row\.appearanceRole\)/);
  assert.match(text,/Save the speaker map below/);
});
