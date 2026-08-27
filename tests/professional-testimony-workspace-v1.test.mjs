import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workspace=fs.readFileSync(new URL("../app/WorkspaceScreen.tsx",import.meta.url),"utf8");
const pages=fs.readFileSync(new URL("../app/WorkspaceDocumentPages.tsx",import.meta.url),"utf8");
const api=fs.readFileSync(new URL("../server/local-api.mjs",import.meta.url),"utf8");

test("professional testimony surface retains editing, structural, review, audio, and export controls",()=>{
  // "Generate Word DOCX" was this list's stand-in for "the export control is still here". The
  // control now names the document it is about to produce, so its label is computed rather than
  // literal; documentControlLabel( is the same stand-in for the same control.
  for(const marker of ["Find / Replace","Replace selected","Low confidence","Unresolved participant honorifics","Next marked passage","Undo last edit or mark","Redo last edit or mark","documentControlLabel("])assert.ok(workspace.includes(marker),marker);
  for(const marker of ["autosave on","onSplit","onJoinPrevious","onJoinNext","onPlayParagraph"])assert.ok(pages.includes(marker),marker);
  assert.ok(api.includes("/api/transcript/final-document-docx"));
});

test("Workspace remains a renderer of server-owned pages",()=>{
  assert.ok(workspace.includes("pages={printModel.pages}"));
  assert.ok(workspace.includes("profile={printModel.layoutProfile}"));
  assert.doesNotMatch(pages,/wrapText|paginateSharedDocument|slice\([^)]*25/);
});
