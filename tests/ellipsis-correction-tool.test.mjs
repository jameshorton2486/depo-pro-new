import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { insertAtCaret } from "../app/caret-insertion.mjs";

test("ellipsis is inserted at the exact cursor and advances the cursor",()=>{
  assert.deepEqual(insertAtCaret("Are you do you",8,"..."),{draft:"Are you ...do you",caret:11});
});

test("cursor insertion works at both paragraph boundaries",()=>{
  assert.deepEqual(insertAtCaret("Answer",0,"..."),{draft:"...Answer",caret:3});
  assert.deepEqual(insertAtCaret("Answer",6,"..."),{draft:"Answer...",caret:9});
});

test("the Quick Tools action uses the active editor and does not steal its focus",()=>{
  const screen=fs.readFileSync(new URL("../app/WorkspaceScreen.tsx",import.meta.url),"utf8");
  const pages=fs.readFileSync(new URL("../app/WorkspaceDocumentPages.tsx",import.meta.url),"utf8");
  assert.match(screen,/aria-label="Insert ellipsis at cursor"/);
  assert.match(screen,/onMouseDown=\{event=>event\.preventDefault\(\)\}/);
  assert.match(screen,/insertAtCaret\("\.\.\."\)/);
  assert.match(pages,/quickTools\(\{canInsertAtCaret:/);
  assert.match(pages,/insertTextAtCaret\(current\.draft,current\.caret,text\)/);
});
