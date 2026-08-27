import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

// aria-invalid is true for an empty required field from first render. That was invisible until
// c79008a gave it a border, and then the manual intake panel opened with all five required fields
// already marked as errors, before the reporter had typed anything.
//
// The instrument that found this was a person looking at the screen. These tests do not have that
// instrument: they read the screen's syntax tree, evaluate the marking expression out of it, and
// prove nothing about a rendered border. A regression that changes only how the mark LOOKS would
// pass here. The render harness at Checkpoint 3 is what would close that.
const SCREEN = new URL("../app/ManualIntakeForm.tsx", import.meta.url);
const source = () => ts.createSourceFile(
  "ManualIntakeForm.tsx", fs.readFileSync(SCREEN, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

// The marking rule as the screen actually writes it, lifted out and made callable. Evaluating the
// real expression is the point: a test that restated the rule would agree with itself.
function markingRule() {
  let body = null;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText() === "missing" && node.initializer
        && ts.isArrowFunction(node.initializer)) body = node.initializer.body.getText();
    ts.forEachChild(node, visit);
  };
  visit(source());
  assert.notEqual(body, null, "no `missing` rule found on the manual intake screen");
  const js = ts.transpileModule(`(key, attempted, required, fields) => (${body})`,
    { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
  return new Function(`return ${js}`)();
}

const REQUIRED = new Set(["caseStyle", "witness", "causeNumber", "depositionDate", "deponentType"]);
const EMPTY_FIELDS = { caseStyle:"", witness:"", causeNumber:"", depositionDate:"", deponentType:"" };

test("a required field is not marked before a submit attempt", () => {
  const marks = markingRule();
  const marked = [...REQUIRED].filter(key => marks(key, false, REQUIRED, EMPTY_FIELDS));
  assert.deepEqual(marked, [], "the panel accuses these fields before the reporter has typed anything");
});

test("a required field is marked after a submit attempt", () => {
  const marks = markingRule();
  const marked = [...REQUIRED].filter(key => marks(key, true, REQUIRED, EMPTY_FIELDS));
  assert.deepEqual(marked.sort(), [...REQUIRED].sort(), "an empty required field is not marked after a failed submit");
  assert.equal(marks("caseStyle", true, REQUIRED, { ...EMPTY_FIELDS, caseStyle:"Okafor v. Vandermeer" }), false,
    "a filled required field stays marked after the attempt");
});

test("the attempt is recorded in one place", () => {
  // "Has submit been attempted" must not get a second source: Enter and the button both go through
  // the one handler, so a path that submits without recording the attempt cannot appear.
  const text = fs.readFileSync(SCREEN, "utf8");
  assert.equal((text.match(/setAttempted\(/g) ?? []).length, 1, "more than one place records the submit attempt");
  assert.equal((text.match(/onReady\(fields\)/g) ?? []).length, 1, "a submit path bypasses the handler that records the attempt");
});
