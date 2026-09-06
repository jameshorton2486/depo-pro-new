import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { versionControls, workflowControls } from "../app/finalization-presentation.mjs";

test("workflow controls display server-owned completion and finalization states",()=>{
  assert.deepEqual(workflowControls({state:"WORKING",transcriptCompletion:{state:"NOT_RECORDED"}}),{showCompletion:true,showCreateFinal:false});
  assert.deepEqual(workflowControls({state:"WORKING",transcriptCompletion:{state:"STALE"}}),{showCompletion:true,showCreateFinal:false});
  assert.deepEqual(workflowControls({state:"FINALIZATION_READY",transcriptCompletion:{state:"CURRENT"}}),{showCompletion:false,showCreateFinal:true});
  assert.deepEqual(workflowControls({state:"FINALIZED",transcriptCompletion:{state:"CURRENT"}}),{showCompletion:false,showCreateFinal:false});
});

test("version controls never turn missing historical or failed-integrity artifacts into actions",()=>{
  assert.deepEqual(versionControls({artifacts:{generationEligibility:"PERMITTED",verified:false,status:"ARTIFACTS_NOT_GENERATED"}}),{showGenerate:true,showDownloads:false,historicalGenerationProhibited:false,integrityFailure:false});
  assert.deepEqual(versionControls({artifacts:{generationEligibility:"PROHIBITED_HISTORICAL_REGENERATION",verified:false,status:"HISTORICAL_ARTIFACTS_MISSING"}}),{showGenerate:false,showDownloads:false,historicalGenerationProhibited:true,integrityFailure:false});
  assert.deepEqual(versionControls({artifacts:{generationEligibility:"NOT_APPLICABLE",verified:false,status:"ARTIFACT_INTEGRITY_FAILURE"}}),{showGenerate:false,showDownloads:false,historicalGenerationProhibited:false,integrityFailure:true});
  assert.deepEqual(versionControls({artifacts:{generationEligibility:"ALREADY_GENERATED",verified:true,status:"ARTIFACTS_VERIFIED"}}),{showGenerate:false,showDownloads:true,historicalGenerationProhibited:false,integrityFailure:false});
});

test("Preview and Finalize uses the projection, authoritative actions, accessible confirmation, and immutable downloads",()=>{
  const panel=fs.readFileSync(new URL("../app/FinalizationPanel.tsx",import.meta.url),"utf8"),preview=fs.readFileSync(new URL("../app/TranscriptPreviewScreen.tsx",import.meta.url),"utf8"),nav=fs.readFileSync(new URL("../app/WorkspaceNav.tsx",import.meta.url),"utf8"),workspace=fs.readFileSync(new URL("../app/WorkspaceScreen.tsx",import.meta.url),"utf8");
  for(const marker of ["/api/finalization/reporter-projection","/api/finalization/transcript-completion","/api/finalization/finalize","/api/finalization/artifacts/generate","/api/finalization/artifacts/download","aria-modal=\"true\"","Confirm Create Final Version","role=\"alert\"","aria-busy","Reason for renewing completion","renewalReason.trim()","Final DOCX","Final PDF"])assert.match(panel,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")));
  assert.match(preview,/FinalizationPanel/);assert.match(nav,/Preview & Finalize/);assert.match(workspace,/Generate Working PDF/);assert.doesNotMatch(panel,/sha256|byteCount|manifest|filesystem/i);
});
