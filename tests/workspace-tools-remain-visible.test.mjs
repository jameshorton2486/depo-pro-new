import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("preparation panels cannot collapse the transcript tools out of view", () => {
  assert.match(css, /\.workspace\s*\{[^}]*min-height:\s*100vh/);
  assert.doesNotMatch(css, /\.workspace\s*\{[^}]*(?:^|[;{])\s*height:\s*100vh/m);
  assert.match(css, /\.workspace-body\s*\{[^}]*height:\s*calc\(100vh\s*-\s*24px\)[^}]*min-height:\s*640px/);
  assert.match(css, /@media \(max-width:900px\)[\s\S]*?\.workspace-menu\s*\{[^}]*order:\s*2[^}]*max-height:\s*min\(70vh,640px\)/);
  assert.match(css, /\.workspace-document,\.workspace-transcript\s*\{\s*order:\s*3/);
});
