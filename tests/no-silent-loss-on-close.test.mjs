// The 1,200 ms window, and what is allowed to happen in it.
//
// Measured before the repair: commit boundaries were an idle debounce, click-away and Ctrl+S, and
// `grep beforeunload app/` returned nothing. Closing a tab mid-sentence discarded whatever had not
// yet debounced, and said nothing. This characterizes the rule that replaced that silence.
//
// The component wiring itself needs a browser and is qualified there. What is pinned here is the
// decision: which states count as unsaved, and which event is permitted to do what about them.
import assert from "node:assert/strict";
import test from "node:test";
import { guardAction, hasUnsavedText } from "../app/unsaved-edit-guard.mjs";

const edit = (over = {}) => ({ paragraphId: "p1", lineKey: "1", draft: "one two", baseText: "one two", caret: 0, status: "editing", ...over });

test("typed text that has not reached the record counts as unsaved", () => {
  assert.equal(hasUnsavedText(edit({ draft: "one two three" })), true);
});

test("an untouched open paragraph is not unsaved", () => {
  assert.equal(hasUnsavedText(edit()), false, "opening a paragraph is not editing it");
  assert.equal(hasUnsavedText(null), false, "nothing open is nothing to lose");
});

test("a saved edit is clean even though its draft differs from the text it started from", () => {
  // status "saved" means the server took it. baseText is the pre-edit text and will differ.
  assert.equal(hasUnsavedText(edit({ draft: "one two three", status: "saved" })), false);
});

test("a save in flight counts as unsaved, because unload may cancel it", () => {
  assert.equal(hasUnsavedText(edit({ draft: "one two three", status: "saving" })), true);
});

test("a refused or failed save counts as unsaved, and is where the reporter most needs stopping", () => {
  assert.equal(hasUnsavedText(edit({ draft: "one two three", status: "conflict" })), true);
  assert.equal(hasUnsavedText(edit({ draft: "one two three", status: "failed" })), true);
  // The draft matching baseText does not make a refusal clean: the record still lacks the edit.
  assert.equal(hasUnsavedText(edit({ status: "conflict" })), true);
});

test("hiding the tab may save; unloading it may only warn", () => {
  const dirty = edit({ draft: "one two three" });
  assert.equal(guardAction("hide", dirty), "flush", "visibilitychange still permits async work");
  assert.equal(guardAction("unload", dirty), "warn",
    "a save started during unload is not a save -- the browser is entitled to cancel it");
});

test("neither event does anything when nothing is dirty", () => {
  assert.equal(guardAction("hide", edit()), "none");
  assert.equal(guardAction("unload", edit()), "none");
  assert.equal(guardAction("unload", null), "none");
});
