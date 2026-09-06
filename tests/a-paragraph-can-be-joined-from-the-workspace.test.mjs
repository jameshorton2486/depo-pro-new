// Join was reachable only by keystroke, and only on the document pages.
//
// The operation itself has existed and been tested since the overlay was built: Backspace at the
// start of a paragraph joins it to the previous one, Delete at the end joins the next. Both are
// wired through joinParagraph, which is the same function the panel's buttons call. What was
// missing was any way to discover it -- a reporter who did not already know the keystroke had no
// way to repair a paragraph broken in the wrong place from the screen they were reading it on.
//
// The bounds are the whole guard. joinParagraph indexes into the paragraph list and reaches for
// index-1 or index+1, so the first paragraph has nothing above it and the last has nothing below.
// Without them the control offers an operation that cannot succeed, and the reporter learns that by
// clicking it.
//
// THESE USED TO PIN THE SOURCE. They asserted the literal disabled expression in the component, and
// the correction-cockpit rewrite moved that decision into structureActions -- so they broke on a
// rename while the behaviour was intact, which is what source pinning is bad at. The bounds are now
// exercised as behaviour and the source check is reduced to the wiring a module cannot see.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { structureActions } from "../app/transcript-tools.mjs";

const SOURCE = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
const paragraph = { id: "p", words: [{ id: "w1" }, { id: "w2" }] };
const at = (index, total) => {
  const actions = structureActions({ paragraph, index, total });
  return {
    previous: actions.find(item => item.key === "join-previous"),
    next: actions.find(item => item.key === "join-next"),
  };
};

test("both directions are offered, not only the keystroke", () => {
  const middle = at(3, 10);
  assert.equal(middle.previous.available, true);
  assert.equal(middle.next.available, true);
  assert.equal(middle.previous.label, "Join to previous");
  assert.equal(middle.next.label, "Join to next");
  // And the panel still calls the same function the keystrokes do.
  assert.match(SOURCE, /joinParagraph\(active\.id,"previous"\)/);
  assert.match(SOURCE, /joinParagraph\(active\.id,"next"\)/);
});

test("the first paragraph cannot be joined upward", () => {
  assert.equal(at(0, 10).previous.available, false);
  assert.ok(at(0, 10).previous.unavailable, "and says why, rather than being silently dead");
});

test("the last paragraph cannot be joined downward", () => {
  assert.equal(at(9, 10).next.available, false);
  assert.equal(at(0, 1).next.available, false, "a transcript of one paragraph joins in neither direction");
  assert.equal(at(0, 1).previous.available, false);
});

test("with nothing selected neither direction is offered", () => {
  // findIndex returns -1 with no selection, and an unguarded control would reach for paragraph -2.
  assert.equal(at(-1, 10).previous.available, false);
  assert.equal(at(-1, 10).next.available, false);
  assert.deepEqual(structureActions({ paragraph: null, index: -1, total: 10 }), []);
});

test("the index the bounds are measured against is the rendered paragraph list", () => {
  // Measured against what is on screen rather than a count carried separately; a second source of
  // truth for "how many paragraphs" is how bounds drift out of step with the thing they bound.
  assert.match(SOURCE, /const activeIndex = active \? \(rendered\?\.paragraphs \?\? \[\]\)\.findIndex/);
  assert.match(SOURCE, /total:rendered\?\.paragraphs\.length\?\?0/);
});
