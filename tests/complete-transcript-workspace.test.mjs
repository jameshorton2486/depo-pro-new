import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const screen=fs.readFileSync(new URL("../app/WorkspaceScreen.tsx",import.meta.url),"utf8");
const pages=fs.readFileSync(new URL("../app/WorkspaceDocumentPages.tsx",import.meta.url),"utf8");
const api=fs.readFileSync(new URL("../server/local-api.mjs",import.meta.url),"utf8");

test("Workspace prefers the complete shared model and retains a testimony-only fallback",()=>{
  assert.ok(screen.includes("/api/transcript/complete-document-model"));
  assert.ok(screen.includes("/api/transcript/print-model"));
  assert.ok(screen.indexOf("/api/transcript/complete-document-model")<screen.indexOf("/api/transcript/print-model"));
  assert.ok(screen.includes('printModel?.recordType==="COMPLETE_TRANSCRIPT_DOCUMENT_MODEL"'));
});

test("administrative pages render from modeled lines but cannot become direct-edit authorities",()=>{
  assert.ok(pages.includes('page.editable===false'));
  assert.ok(pages.includes('page.editable!==false&&line.paragraphId'));
  assert.ok(pages.includes('line.fragments.length?line.fragments.map'));
  assert.ok(pages.includes(':line.content'));
});

test("the API exposes complete model and DOCX from one assembly authority",()=>{
  assert.ok(api.includes("getCompleteTranscriptModel"));
  assert.ok(api.includes("/api/transcript/complete-document-model"));
  assert.ok(api.includes("/api/transcript/complete-document-docx"));
});
