import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("preparation panels cannot collapse the transcript tools out of view", () => {
  assert.match(css, /\.workspace\s*\{[^}]*min-height:\s*100vh/);
  assert.doesNotMatch(css, /\.workspace\s*\{[^}]*(?:^|[;{])\s*height:\s*100vh/m);
  assert.match(css, /\.workspace-body\s*\{[^}]*height:\s*calc\(100vh\s*-\s*24px\)[^}]*min-height:\s*640px/);
  assert.match(css, /@media \(max-width:900px\)[\s\S]*?\.workspace-menu\s*\{[^}]*order:\s*2[^}]*max-height:\s*min\(70vh,640px\)/);
  assert.match(css, /\.workspace-stage\s*\{\s*order:\s*3/);
});

test("quick transcript actions remain outside the scrolling 25-line document", () => {
  const source = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  assert.match(source, /<aside className="workspace-quick-tools" aria-label="Quick transcript actions">/);
  assert.match(source, /workspace-quick-tools-grid/);
  assert.match(css, /\.workspace-stage\s*\{[^}]*display:flex[^}]*flex-direction:column[^}]*overflow:hidden/);
  assert.match(css, /\.workspace-quick-tools\s*\{[^}]*order:-1[^}]*position:sticky[^}]*top:0/);
  assert.match(css, /\.workspace-quick-tools-grid\s*\{[^}]*grid-template-columns:repeat\(5,[^}]*grid-template-rows:repeat\(2,52px\)/);
  assert.match(css, /@media\(max-width:700px\)[\s\S]*?\.workspace-quick-tools-grid\s*\{[^}]*grid-template-columns:repeat\(3/);
});

test("role names in tools are explicit without changing transcript rendering", () => {
  const source = fs.readFileSync(new URL("../app/WorkspaceScreen.tsx", import.meta.url), "utf8");
  assert.match(source, /COURT_REPORTER:"THE REPORTER"/);
  assert.match(source, /VIDEOGRAPHER:"THE VIDEOGRAPHER"/);
  assert.match(source, /INTERPRETER:"THE INTERPRETER"/);
  assert.match(source, /WITNESS:"THE WITNESS \(A\. during Q&A\)"/);
});
