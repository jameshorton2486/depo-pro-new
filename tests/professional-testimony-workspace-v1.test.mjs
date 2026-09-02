import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const workspace=fs.readFileSync(new URL("../app/WorkspaceScreen.tsx",import.meta.url),"utf8");
const pages=fs.readFileSync(new URL("../app/WorkspaceDocumentPages.tsx",import.meta.url),"utf8");
const api=fs.readFileSync(new URL("../server/local-api.mjs",import.meta.url),"utf8");
const tools=fs.readFileSync(new URL("../app/transcript-tools.mjs",import.meta.url),"utf8");

test("professional testimony surface retains editing, structural, review, audio, and export controls",()=>{
  // "Generate Word DOCX" was this list's stand-in for "the export control is still here". The
  // control now names the document it is about to produce, so its label is computed rather than
  // literal; documentControlLabel( is the same stand-in for the same control.
  // The correction-cockpit rewrite renamed several of these while keeping every capability. Undo
  // and Redo moved out of the header into the correction panel, where undoing a correction belongs;
  // Low confidence became a REVIEW worklist category; honorifics moved beside the participants,
  // because an honorific is a fact about a person rather than a per-paragraph decision.
  for(const marker of ["Find / Replace","Replace selected","Low confidence","Unresolved participant honorifics","Next marked passage","overlay/undo","overlay/redo","documentControlLabel("])assert.ok(workspace.includes(marker),marker);
  // onSplit left this list with bare Enter: the page component no longer splits, and Split here in
  // the tools panel anchors to the selected word rather than to a caret offset.
  for(const marker of ["Split here","Join to previous","Join to next"])assert.ok(tools.includes(marker),marker);
  assert.ok(workspace.includes("structureActions("),"the panel gets its structural controls from the tested module");
  for(const marker of ["autosave on","onJoinPrevious","onJoinNext","onPlayParagraph"])assert.ok(pages.includes(marker),marker);
  assert.ok(api.includes("/api/transcript/final-document-docx"));
});

test("Workspace remains a renderer of server-owned pages",()=>{
  assert.ok(workspace.includes("pages={printModel.pages}"));
  assert.ok(workspace.includes("profile={printModel.layoutProfile}"));
  assert.doesNotMatch(pages,/wrapText|paginateSharedDocument|slice\([^)]*25/);
});
