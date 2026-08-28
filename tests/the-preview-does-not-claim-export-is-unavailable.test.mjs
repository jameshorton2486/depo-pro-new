import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

// Print Preview carried a disabled control reading "Export unavailable", tooltipped "PDF and Word
// output follow after page geometry is verified." The geometry has been verified since the Texas
// profile was Word-proven, and Word generation exists in the Workspace -- so the screen stated
// something false to the one person who would act on it.
//
// It now routes to where generation actually happens. There is no second export engine here, and
// there must not be: Preview is a projection of the current Workspace state and persists nothing.
const SCREEN = new URL("../app/TranscriptPreviewScreen.tsx", import.meta.url);

test("the preview makes no claim that export or geometry is unavailable", () => {
  const text = fs.readFileSync(SCREEN, "utf8");
  assert.doesNotMatch(text, /Export unavailable/, "the disabled export control is back");
  assert.doesNotMatch(text, /geometry is verified/, "the screen claims the geometry is unverified again");
  // A bare `disabled` is a control switched off for good, which is what the stale one was.
  // `disabled={loading}` on Refresh is a control busy for a moment, and is fine.
  assert.doesNotMatch(text, /\sdisabled(?!=)/, "a permanently disabled control returned to the preview");
});

test("the preview routes to the Workspace rather than generating anything itself", () => {
  const text = fs.readFileSync(SCREEN, "utf8");
  const source = ts.createSourceFile("TranscriptPreviewScreen.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let routes = false;
  const visit = node => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === "button"
        && node.children.map(child => child.getText()).join("").includes("Generate in the Workspace")) {
      routes = node.openingElement.attributes.getText().includes("onClick={onBack}");
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(routes, "the generate control does not hand the reporter back to the Workspace");

  // No second engine: the screen must not call a generation endpoint of its own.
  assert.doesNotMatch(text, /api\/(transcript\/docx|insertion-pages\/docx|final-document)/, "the preview reaches a generation endpoint directly");
});
