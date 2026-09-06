import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { recordExhibitAudit } from "../server/canonical-exhibit-lifecycle.mjs";
import { recordTranscriptCompletion, requestFinalization } from "../server/canonical-finalization.mjs";
import { qualifyFinalArtifacts } from "../server/final-artifact-provenance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = "http://localhost:3000";

test("reporter projection and immutable downloads are exercised through the local API", async t => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-finalization-api-")); t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  const built = spawnSync(process.execPath, [path.join(root, "scripts", "create-milestone2-browser-fixture.mjs"), storageRoot], { encoding: "utf8" }); assert.equal(built.status, 0, built.stderr);
  const fixture = JSON.parse(built.stdout), options = { depositionId: fixture.id, storageRoot };
  recordExhibitAudit(root, { ...options, actor: "Reporter", input: { result: "NO_EXHIBITS", sourceAnchor: "reporter-review:exhibits" } }); await recordTranscriptCompletion(root, { ...options, actor: "Reporter", input: {} }); const final = (await requestFinalization(root, { ...options, actor: "Reporter" })).event; const generated = await qualifyFinalArtifacts(root, { ...options, finalVersionId: final.finalVersionId, actor: "Reporter" });
  process.env.DEPO_PRO_DEPOSITIONS_ROOT = storageRoot; process.env.PORT = "3000";
  const { server } = await import(`../server/local-api.mjs?phase-f-api=${Date.now()}`); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address(), base = `http://127.0.0.1:${address.port}`, headers = { Origin: origin };
  const projectionResponse = await fetch(`${base}/api/finalization/reporter-projection?depositionId=${fixture.id}`, { headers }); assert.equal(projectionResponse.status, 200); const projection = await projectionResponse.json(); assert.equal(projection.currentFinalVersionId, "FINAL-v1"); assert.equal(projection.versions[0].artifacts.status, "ARTIFACTS_VERIFIED");
  for (const kind of ["docx", "pdf"]) {
    const response = await fetch(`${base}/api/finalization/artifacts/download?depositionId=${fixture.id}&finalVersionId=FINAL-v1&kind=${kind}`, { headers }); assert.equal(response.status, 200); assert.match(response.headers.get("content-disposition"), new RegExp(`Deposition-FINAL-v1\\.${kind}`)); assert.equal((await response.arrayBuffer()).byteLength, generated.manifest.artifacts[kind].byteCount);
  }
  const unknown = await fetch(`${base}/api/finalization/artifacts/download?depositionId=${fixture.id}&finalVersionId=FINAL-v999&kind=pdf`, { headers }); assert.notEqual(unknown.status, 200); assert.match((await unknown.json()).error, /FINAL_VERSION_NOT_FOUND/);
  fs.appendFileSync(path.join(fixture.directory, "final", "FINAL-v1", "transcript.pdf"), "tampered"); const tampered = await fetch(`${base}/api/finalization/artifacts/download?depositionId=${fixture.id}&finalVersionId=FINAL-v1&kind=docx`, { headers }); assert.notEqual(tampered.status, 200); assert.match((await tampered.json()).error, /PDF_INTEGRITY_FAILURE/);
});
