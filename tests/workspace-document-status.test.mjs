// Workspace document status: the reporter is told which document they are about to make.
//
// READY-CASE PROVENANCE, AND WHY IT IS NOT ORDINARY-WORKFLOW COVERAGE.
// The ready case below reaches complete assembly authority through
// scripts/create-milestone2-browser-fixture.mjs, because no ordinary reporter path creates
// intake/complete-transcript-assembly.json -- that path is Release Integration Priority 2 and
// does not exist yet. This is acceptable for Priority 1 ONLY. When Priority 2 lands, the ready
// case must be rebuilt on the ordinary path, and this comment removed rather than edited: a test
// that keeps saying "fixture-created" after the real path exists stops being a disclosure and
// starts being an excuse.
//
// The blocked case starts from the same fixture and then DELETES the assembly file, so the two
// cases differ by exactly the thing under test and nothing else. That is the ordinary state of
// every deposition created through Intake today.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { COMPLETE_RECORD_TYPE, DOCUMENT_STATUS, deriveDocumentStatus, documentControlLabel, generationNotice } from "../app/document-status.mjs";
import { getCompleteTranscriptModel } from "../server/complete-transcript-model.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function disposableRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "depo-status-"));
  test.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

// Builds the fixture deposition and returns its id plus the path of its assembly authority.
function fixtureDeposition(storageRoot) {
  const built = spawnSync(process.execPath, [path.join(repositoryRoot, "scripts", "create-milestone2-browser-fixture.mjs"), storageRoot], { encoding: "utf8" });
  assert.equal(built.status, 0, `fixture generator failed: ${built.stderr}`);
  const { id, directory } = JSON.parse(built.stdout);
  return { id, assemblyFile: path.join(directory, "intake", "complete-transcript-assembly.json") };
}

test("blocked state: a deposition with no assembly authority reports blocked, names the reason, and names the absent pages", async () => {
  const storageRoot = disposableRoot();
  // A complete, valid deposition with exactly one thing taken away: the assembly authority.
  // Deleting it rather than never writing it is what makes this the isolated variable.
  const { id, assemblyFile } = fixtureDeposition(storageRoot);
  fs.rmSync(assemblyFile);

  let blockedReason = "";
  await assert.rejects(
    () => getCompleteTranscriptModel(repositoryRoot, { depositionId: id, storageRoot }),
    (error) => { blockedReason = error.message; return true; },
  );

  const status = deriveDocumentStatus({ servedRecordType: "TRANSCRIPT_PRINT_MODEL", blockedReason });

  assert.equal(status.state, DOCUMENT_STATUS.BLOCKED);
  // The ruling: an absent assembly is BLOCKED, never softened into the state that means the
  // reporter chose this.
  assert.notEqual(status.state, DOCUMENT_STATUS.TESTIMONY_ONLY);
  assert.equal(status.reason, blockedReason);
  assert.match(status.reason, /COMPLETE_TRANSCRIPT_ASSEMBLY_REQUIRED/);
  assert.deepEqual(status.absentSections, [
    "title and caption", "appearances", "index",
    "changes and signature (when signature is requested)", "reporter's certification",
  ]);
  assert.equal(documentControlLabel(status.state), "Generate testimony-only Word");

  const notice = generationNotice({ producedKind: "testimony-only", outputPath: "X\\professional-testimony.docx" });
  assert.match(notice, /Testimony body only generated/);
  assert.match(notice, /reporter's certification/);
  // The message that was true of both documents, and therefore said nothing, must not return.
  assert.doesNotMatch(notice, /Word proof generated from the shared pages/);
});

test("ready state: a fixture-created deposition with complete assembly authority reports ready", async () => {
  const storageRoot = disposableRoot();
  const { id } = fixtureDeposition(storageRoot);

  const model = await getCompleteTranscriptModel(repositoryRoot, { depositionId: id, storageRoot });
  assert.equal(model.recordType, COMPLETE_RECORD_TYPE);

  const status = deriveDocumentStatus({ servedRecordType: model.recordType, blockedReason: "" });

  assert.equal(status.state, DOCUMENT_STATUS.READY);
  assert.equal(status.reason, "");
  assert.deepEqual(status.absentSections, []);
  assert.equal(documentControlLabel(status.state), "Generate complete transcript Word");
  assert.match(generationNotice({ producedKind: "complete-transcript", outputPath: "X\\complete-transcript.docx" }), /Complete transcript generated/);
});
