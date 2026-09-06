import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const screen=fs.readFileSync(new URL("../app/ExhibitReconciliationScreen.tsx",import.meta.url),"utf8");
const page=fs.readFileSync(new URL("../app/page.tsx",import.meta.url),"utf8");
const nav=fs.readFileSync(new URL("../app/WorkspaceNav.tsx",import.meta.url),"utf8");
const finalization=fs.readFileSync(new URL("../app/FinalizationPanel.tsx",import.meta.url),"utf8");

test("reporter exhibit UI consumes the existing server-owned authority",()=>{
  assert.match(screen,/\/api\/exhibits\/readiness/);
  assert.match(screen,/\/api\/exhibits\/audit/);
  assert.match(screen,/\/api\/exhibits\/record/);
  assert.doesNotMatch(screen,/transcriptModelHash|reviewStateHash|lifecycleDigest/);
  assert.doesNotMatch(screen,/\{\s*ready\s*:/);
});

test("no exhibits and exhibits present are explicit attributable choices",()=>{
  assert.match(screen,/NO_EXHIBITS/);
  assert.match(screen,/EXHIBITS_PRESENT/);
  assert.match(screen,/correctionReason/);
  assert.match(screen,/An empty list does not establish that no exhibits were marked/);
});

test("transcript evidence is selected from stable rendered identities rather than typed internals",()=>{
  assert.match(screen,/\/api\/transcript\/rendered/);
  assert.match(screen,/paragraphId:\s*paragraph\.id/);
  assert.match(screen,/sourceWordId:\s*word\.id/);
  assert.match(screen,/<select\s+required\s+value=\{draft\.paragraphId\}/);
});

test("corrections use the canonical exhibit identity and require a reason",()=>{
  assert.match(screen,/exhibitId:\s*draft\.exhibitId\s*\|\|\s*undefined/);
  assert.match(screen,/draft\.exhibitId\s*\?\s*draft\.correctionReason\s*:\s*undefined/);
  assert.match(screen,/Reason for correction/);
});

test("Phase G is reachable from navigation and finalization remediation",()=>{
  assert.match(nav,/view: "exhibits", label: "Exhibits"/);
  assert.match(page,/showExhibits/);
  assert.match(page,/destination==="EXHIBITS"/);
  assert.match(finalization,/EXHIBITS:"Reconcile Exhibits"/);
});

test("digital exhibit intake is constrained and sent to the server-owned record boundary",()=>{
  assert.match(screen,/type="file"/);
  assert.match(screen,/accept="application\/pdf,image\/png,image\/jpeg"/);
  assert.match(screen,/fileBase64/);
  assert.match(screen,/25 MB maximum/);
  assert.match(screen,/identified by SHA-256/);
  assert.match(screen,/PHYSICAL/);
  assert.match(screen,/RETAINED_BY_COUNSEL/);
});
