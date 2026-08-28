import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { manualIntakeAnalysis } from "../app/manual-intake.mjs";

// IntakeScreen.tsx:390 carried a bare `required` on the Notice file input. Native constraint
// validation runs before the submit handler, so the browser refused the manual route before any
// application code saw it: a reporter with a real mouse could not create a walk-in deposition,
// which is the feature b61c515 is titled after. Seven tests of manual-intake.mjs passed throughout,
// because not one of them reads the form the module feeds.
//
// What this test does: parses the screen, takes the `required` attribute off the Notice input as an
// expression, and evaluates that expression against the REAL return value of manualIntakeAnalysis.
// So it fails if the attribute goes back to a literal, if the condition inverts, or if it keys on a
// field the module does not actually set.
//
// What it cannot reach: the browser. It does not render, so it cannot prove Chrome computes
// `required=false` from this expression, and it says nothing about the other three file inputs.
// The instrument for that is the render harness at Checkpoint 3.
const SCREEN = new URL("../app/IntakeScreen.tsx", import.meta.url);

function noticeRequiredExpression() {
  const text = fs.readFileSync(SCREEN, "utf8");
  const source = ts.createSourceFile("IntakeScreen.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = null;
  const visit = node => {
    const opening = ts.isJsxSelfClosingElement(node) ? node : ts.isJsxOpeningElement(node) ? node : null;
    if (opening && opening.tagName.getText() === "input") {
      const attributes = opening.attributes.properties.filter(ts.isJsxAttribute);
      const isNotice = attributes.some(a => a.name.getText() === "onChange" && a.getText().includes("setNotice("));
      if (isNotice) found = attributes.find(a => a.name.getText() === "required") ?? "absent";
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.notEqual(found, null, "no <input> on the intake screen sets the Notice via setNotice()");
  assert.notEqual(found, "absent", "the Notice input has no `required` attribute at all");
  assert.ok(
    found.initializer && ts.isJsxExpression(found.initializer) && found.initializer.expression,
    "the Notice input's `required` is an unconditional attribute, so native validation refuses the manual route",
  );
  return found.initializer.expression.getText();
}

const evaluateFor = analysis => new Function("analysis", `return (${noticeRequiredExpression()});`)(analysis);

const ENTERED = {
  caseStyle: "Whitaker v. Brazos Ridge Logistics, LLC",
  witness: "Dana Ellsworth Whitaker",
  causeNumber: "2026-CI-90210",
  depositionDate: "2026-08-27",
  deponentType: "Fact witness",
};

test("the extraction path still requires a Notice", () => {
  assert.equal(evaluateFor(null), true);
});

test("manual entry does not require a Notice", () => {
  // The caller's real shape, not a stand-in: if manualIntakeAnalysis stops marking its output, or
  // the screen keys on a field it never set, this fails.
  const analysis = manualIntakeAnalysis(ENTERED);
  assert.equal(analysis.manualEntry, true, "manualIntakeAnalysis no longer marks its output as manual entry");
  assert.equal(evaluateFor(analysis), false);
});
