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
  // Status and endpoint selection derive from the record type the SERVER actually served, never
  // from the screen's cached model. This line used to assert the cached form
  // (`printModel?.recordType===...`), which is the stale-state defect Release Integration
  // Priority 1 exists to close -- so the cached form is now asserted ABSENT. Merely replacing the
  // assertion would let it be reintroduced somewhere else in the file without anything noticing.
  assert.doesNotMatch(screen,/printModel\?\.recordType===/);
  assert.ok(screen.includes("deriveDocumentStatus({ servedRecordType:servedModel?.recordType"));
  assert.ok(screen.includes("documentState?.state===DOCUMENT_STATUS.READY"));
  // The fallback itself must survive: a reporter with no assembly authority still works the
  // testimony. What changed is that it announces itself, not that it went away.
  assert.ok(screen.includes("blockedReason"));
});

test("administrative pages render from modeled lines but cannot become direct-edit authorities",()=>{
  assert.ok(pages.includes('page.editable===false'));
  // The current control renders evidence fragments on both page kinds, then refuses the edit in
  // the click boundary. Administrative text remains visible without becoming an edit authority.
  assert.ok(pages.includes('if(page.editable===false||!line.paragraphId)return'));
  assert.ok(pages.includes('line.fragments.length?line.fragments.map'));
  assert.ok(pages.includes(':line.content'));
});

test("the API exposes complete model, DOCX and PDF from one assembly authority",()=>{
  assert.ok(api.includes("getCompleteTranscriptModel"));
  assert.ok(api.includes("/api/transcript/complete-document-model"));
  assert.ok(api.includes("/api/transcript/complete-document-docx"));
  assert.ok(api.includes("/api/transcript/complete-document-pdf"));
  assert.ok(screen.includes("Generate Working PDF"));
});
