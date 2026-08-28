import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { DISPOSITIONS, JURISDICTIONS } from "../app/complete-transcript-options.mjs";
import { createDeposition, readDepositionCounsel } from "../server/deposition-store.mjs";

// The panel is the reporter's way into a complete transcript. Two things about it are load-bearing
// and neither is visible in its output:
//
//   1. It must not import a server module. Doing so pulls deposition-store, audio-pipeline and
//      node:child_process into the browser bundle, and the WHOLE APPLICATION fails to load with
//      "Module node:child_process has been externalized". That happened while building this panel;
//      the app served an error boundary instead of the library. Nothing in a rendered check would
//      have caught it, because nothing rendered.
//   2. It must offer canonical counsel ids. `operator.examiningCounselId` is an id, never a typed
//      name, so the roster it offers has to be the roster the record holds.
const PANEL = new URL("../app/PrepareCompleteTranscript.tsx", import.meta.url);
const OPTIONS = new URL("../app/complete-transcript-options.mjs", import.meta.url);

const importsOf = url => {
  const text = fs.readFileSync(url, "utf8");
  const source = ts.createSourceFile("x.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  ts.forEachChild(source, node => {
    if (ts.isImportDeclaration(node)) found.push(node.moduleSpecifier.getText().replace(/['"]/g, ""));
  });
  return found;
};

test("the preparation panel imports no server module", () => {
  const server = importsOf(PANEL).filter(specifier => specifier.includes("/server/") || specifier.startsWith("../server"));
  assert.deepEqual(server, [], `importing these into the browser bundle breaks the application: ${server.join(", ")}`);
});

test("the shared options module imports nothing at all", () => {
  // Its whole purpose is to be safe on both sides. One import is how it stops being that.
  assert.deepEqual(importsOf(OPTIONS), []);
});

test("every choice the panel offers is one the validator accepts", async () => {
  // Not a comparison of the two lists: the validator re-exports the same frozen array, so that
  // check agrees with itself and a mutation to the list kills nothing. This crosses to the
  // validator's own logic instead -- each offered value must clear its field, and a value the
  // panel could never offer must not.
  const { validateAssembly } = await import("../server/complete-transcript-assembly.mjs");
  const codes = operator => validateAssembly({ schemaVersion:"1.1.0", operator }).map(finding => finding.code);

  for (const jurisdiction of JURISDICTIONS) {
    assert.ok(!codes({ jurisdiction }).includes("ASSEMBLY_JURISDICTION"), `the panel offers ${jurisdiction} and the validator refuses it`);
  }
  for (const signatureDisposition of DISPOSITIONS) {
    assert.ok(!codes({ signatureDisposition }).includes("ASSEMBLY_SIGNATURE_DISPOSITION"), `the panel offers ${signatureDisposition} and the validator refuses it`);
  }
  assert.ok(codes({ jurisdiction:"new-mexico" }).includes("ASSEMBLY_JURISDICTION"), "the validator accepts a jurisdiction the panel cannot offer");
  assert.ok(codes({ signatureDisposition:"assumed" }).includes("ASSEMBLY_SIGNATURE_DISPOSITION"), "the validator accepts a disposition the panel cannot offer");
});

test("the counsel roster hands back the canonical ids a preparation must reference", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "roster-"));
  t.after(() => fs.rmSync(root, { recursive:true, force:true }));
  const storageRoot = path.join(root, "depos");
  createDeposition(root, {
    deposition: {
      id:"DEP-20260828-ROST1", caseStyle:"Whitaker v. Brazos Ridge Logistics, LLC",
      witness:"Dana Ellsworth Whitaker", causeNumber:"2026-CI-90210", depositionDate:"2026-08-28",
      courtReporterName:"Marguerite Okonkwo-Vance",
      attorneys:[
        { name:"Marisol Vantongeren-Okafor", firm:"Vantongeren & Okafor LLP", represents:["Dana Ellsworth Whitaker"], side:"PLAINTIFF" },
        { name:"Rufus Q. Pemberton-Stack", firm:"Brazos Ridge Defense Group", represents:["Brazos Ridge Logistics, LLC"], side:"DEFENDANT" },
      ],
    },
  }, { storageRoot });

  const roster = readDepositionCounsel(root, { depositionId:"DEP-20260828-ROST1", storageRoot });
  // The ids and names the preparation must reference. Asserted by field rather than by whole-object
  // equality: the roster also carries the editable fields the counsel editor round-trips, and a
  // test that pinned the exact key set would fail whenever an editable field was added without
  // anything being wrong.
  assert.deepEqual(roster.counsel.map(entry => ({ id:entry.id, name:entry.name, firm:entry.firm })), [
    { id:"attorney-1", name:"Marisol Vantongeren-Okafor", firm:"Vantongeren & Okafor LLP" },
    { id:"attorney-2", name:"Rufus Q. Pemberton-Stack", firm:"Brazos Ridge Defense Group" },
  ]);
});
