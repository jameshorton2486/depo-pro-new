import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";
import { COUNSEL_SIDES, COUNSEL_SIDE_PHRASES, counselSidePhrase } from "../app/manual-intake.mjs";

// The record stores a code; the appearance page prints a phrase. Keeping them apart is what stops
// a typography change from meaning an edit to a canonical record.
//
// The failure this is built against: a phrase map that exists but is never consulted. Everything
// still passes, and `FOR THIRD_PARTY_DEFENDANT:` prints on a certified page.
//
// What it cannot reach: build-pages.mjs does not consume the map yet -- that is the next commit --
// so the only call site here is the form's select. When the print site lands, it needs its own
// test against a rendered appearance page, not this one.
const SCREEN = new URL("../app/ManualIntakeForm.tsx", import.meta.url);

test("every named side has a print phrase that is not its code", () => {
  const named = COUNSEL_SIDES.filter(code => code !== "OTHER");
  for (const code of named) {
    const phrase = counselSidePhrase(code);
    assert.ok(phrase, `${code} has no print phrase, so it would print as its code`);
    assert.notEqual(phrase, code, `${code} prints as its own code`);
    assert.doesNotMatch(phrase, /_/, `${code} prints with an underscore in it: ${phrase}`);
  }
  assert.equal(named.length, Object.keys(COUNSEL_SIDE_PHRASES).length, "a code and the phrase map have drifted apart");
});

test("the side a reporter supplies has no phrase of its own", () => {
  // OTHER's phrase is the reporter's sideOther. A map entry here would be a second, competing one.
  assert.equal(counselSidePhrase("OTHER"), null);
});

test("the phrase is the complete text after FOR, article included", () => {
  // Not the fragment after "FOR THE": a reporter appearing for a named entity needs
  // `FOR AMERIGROUP TEXAS, INC.:` with no article, and an article hardcoded at the print site
  // makes that inexpressible. So the article lives in the phrase.
  assert.equal(counselSidePhrase("PLAINTIFF"), "THE PLAINTIFF");
  assert.equal(counselSidePhrase("AD_LITEM"), "THE GUARDIAN AD LITEM");
});

test("the form offers the printed phrase, not the stored code", () => {
  // The select's option text must come from the map. Rendering the code raw would show the
  // reporter something different from what prints, and is the shape of the failure above.
  const text = fs.readFileSync(SCREEN, "utf8");
  const source = ts.createSourceFile("ManualIntakeForm.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let option = null;
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === "option"
        && node.openingElement.attributes.getText().includes("value={option}")) option = node.children.map(c => c.getText()).join("");
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.notEqual(option, null, "no <option> is generated from the side list");
  assert.match(option, /counselSidePhrase\(/, `the select renders ${option.trim()} rather than consulting the phrase map`);
});
