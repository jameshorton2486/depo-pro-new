import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

// The manual intake panel was written to the wrapping-label convention -- <label>Text<input/></label>
// -- that .modal, .intake-fields and .admin-card each scope a `display:grid; gap:7px` rule to. No
// rule ever scoped .manual-intake, so its labels fell back to display:inline and every label ran
// into its own value on screen ("WitnessThaddeus Bellweather"). The labels were correctly
// associated the whole time; the stylesheet simply had no entry for this container.
//
// What these tests cannot reach: rendering. They read the stylesheet and the screen's syntax tree,
// not a browser, so they cannot prove a computed style or that a keypress reaches the handler. That
// is the render harness at Checkpoint 3.
const SHEET = new URL("../app/globals.css", import.meta.url);
const SCREEN = new URL("../app/ManualIntakeForm.tsx", import.meta.url);

function declarationsFor(selector) {
  // Comments stripped first: a rule preceded by one would otherwise carry the comment text into
  // the selector chunk and never match.
  const css = fs.readFileSync(SHEET, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(match => match[1].split(",").some(part => part.trim() === selector))
    .map(match => match[2].replace(/\s+/g, ""));
}

function elements() {
  const text = fs.readFileSync(SCREEN, "utf8");
  const source = ts.createSourceFile("ManualIntakeForm.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = [];
  const visit = node => {
    const opening = ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening) {
      const attributes = opening.attributes.properties.filter(ts.isJsxAttribute);
      found.push({
        tag: opening.tagName.getText(),
        attributes: attributes.map(a => a.name.getText()),
        type: attributes.find(a => a.name.getText() === "type")?.getText() ?? "",
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test("the manual intake panel styles its labels", () => {
  const declarations = declarationsFor(".manual-intake label");
  assert.equal(declarations.length, 1, "the .manual-intake label rule is missing from globals.css");
  assert.match(declarations[0], /display:grid/, "labels would fall back to display:inline and run into their values");
});

test("a required manual intake field that is missing is marked, not only named", () => {
  // aria-invalid is set per field in the screen; before this commit the sheet had no rule for it
  // anywhere, so the refusal named the fields at the foot of the form and nothing marked which.
  assert.ok(
    declarationsFor('.manual-intake [aria-invalid="true"]').length >= 1,
    "aria-invalid has no visible treatment scoped to the manual intake panel",
  );
});

test("every manual intake field takes Enter", () => {
  const fields = elements().filter(element => element.tag === "input" || element.tag === "select");
  assert.ok(fields.length >= 10, `expected the panel's fields, found ${fields.length}`);
  const deaf = fields.filter(field => !field.attributes.includes("onKeyDown"));
  assert.deepEqual(deaf, [], "a field that does not take Enter submits the enclosing intake form instead");
});

test("Enter on the panel's own buttons still presses the button", () => {
  // The handler is bound to the fields, never to a button or to the panel. On the panel it would
  // also swallow Enter on Add counsel and Add party; on a non-interactive element it is also an
  // accessibility fault the linter refuses.
  const wrong = elements().filter(element =>
    element.attributes.includes("onKeyDown") && element.tag !== "input" && element.tag !== "select");
  assert.deepEqual(wrong.map(element => element.tag), [], "Enter is bound somewhere it would swallow a button press");
});

test("nothing in the manual intake panel submits the form around it", () => {
  // The panel renders inside IntakeScreen's <form>. A nested form is dropped by the parser, so a
  // submit button here fires the OUTER form and advances to Deposition Setup with fields incomplete.
  const submits = elements().filter(element => element.type.includes("submit"));
  assert.deepEqual(submits.map(element => element.tag), []);
});
