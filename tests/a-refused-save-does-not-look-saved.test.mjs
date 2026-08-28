import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import ts from "typescript";

// Administrator Settings had two defects that hid each other.
//
// A refused save rendered in the same neutral grey box as a successful one, with role="status" for
// both. The server does say why -- "Create an administrator access code with at least 8
// characters." -- but it read as a note rather than as the reason nothing was saved. A Deepgram key
// was pasted, the save was refused for want of an access code, and the screen said something that
// looked like a receipt.
//
// And on success the chips were computed from the FORM rather than read back from the server, so
// they could report "Configured" for a key the store had never kept: the screen agreeing with
// itself. Both are the same failure this branch has been closing -- a thing that looks like it
// worked.
const SCREEN = new URL("../app/AdminSettings.tsx", import.meta.url);
const read = () => fs.readFileSync(SCREEN, "utf8");

test("a refused save renders as an alert, not as a confirmation", () => {
  const text = read();
  const source = ts.createSourceFile("AdminSettings.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let attributes = null;
  const visit = node => {
    const opening = ts.isJsxOpeningElement(node) ? node : null;
    if (opening && opening.tagName.getText() === "p" && opening.attributes.getText().includes("admin-message")) {
      attributes = opening.attributes.getText();
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(attributes, "the settings message element was not found");
  assert.match(attributes, /role=\{failed \? "alert" : "status"\}/, "a refusal is still announced as a status");
  assert.match(attributes, /admin-message-failed/, "a refusal looks the same as a confirmation");
  // And the failed style must actually differ from the neutral one.
  const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.admin-message-failed \{[^}]*\}/, "the failed message has no style of its own");
});

test("the saved status is read back from the server, not computed from the form", () => {
  const text = read();
  // The success path must ask the server what it holds.
  assert.match(text, /setStatus\(await apiJson<Status>\("\/api\/admin\/status"/, "the screen does not re-read the status after saving");
  // And must not derive the chips from the values it just submitted.
  assert.doesNotMatch(text, /deepgramConfigured:\s*!!data\.get/, "the chips are computed from the form again");
  assert.doesNotMatch(text, /anthropicConfigured:\s*!!data\.get/, "the chips are computed from the form again");
});
