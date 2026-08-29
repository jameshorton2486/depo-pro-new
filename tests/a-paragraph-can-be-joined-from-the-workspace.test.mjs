// Join was reachable only by keystroke, and only on the document pages.
//
// The operation itself has existed and been tested since the overlay was built: Backspace at the
// start of a paragraph joins it to the previous one, Delete at the end joins the next. Both are
// wired through joinParagraph, which is the same function these buttons call. What was missing was
// any way to discover it -- a reporter who did not already know the keystroke had no way to repair
// a paragraph broken in the wrong place from the screen they were reading it on.
//
// The disabled conditions are the whole guard. joinParagraph indexes into the paragraph list and
// reaches for index-1 or index+1, so the first paragraph has nothing above it and the last has
// nothing below. Without the bounds the control offers an operation that cannot succeed, and the
// reporter learns that by clicking it.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const SOURCE = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");

test("both directions are reachable from the workspace, not only by keystroke", () => {
  assert.match(SOURCE, /Join to previous paragraph/);
  assert.match(SOURCE, /Join to next paragraph/);
  assert.match(SOURCE, /joinParagraph\(active\.id,"previous"\)/);
  assert.match(SOURCE, /joinParagraph\(active\.id,"next"\)/);
});

test("the first paragraph cannot be joined upward", () => {
  // activeIndex<=0 covers both the first paragraph and the no-selection case, where findIndex
  // returns -1 and an unguarded control would call joinParagraph with a paragraph that is not there.
  assert.match(SOURCE, /disabled=\{!active\|\|busy\|\|activeIndex<=0\}/);
});

test("the last paragraph cannot be joined downward", () => {
  assert.match(SOURCE, /activeIndex>=\(rendered\?\.paragraphs\.length\?\?0\)-1/);
});

test("the index the bounds are measured against is the rendered paragraph list", () => {
  // Measured against what is on screen rather than a count carried separately; a second source of
  // truth for "how many paragraphs" is how bounds drift out of step with the thing they bound.
  assert.match(SOURCE, /const activeIndex = active \? \(rendered\?\.paragraphs \?\? \[\]\)\.findIndex/);
});
