import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { recordExhibit, recordExhibitAudit } from "../server/canonical-exhibit-lifecycle.mjs";
import { recordTranscriptCompletion, requestFinalization } from "../server/canonical-finalization.mjs";
import { _testing, getFinalArtifactStatus, qualifyFinalArtifacts, verifyFinalArtifacts } from "../server/final-artifact-provenance.mjs";
import { appendReporterOperations, getWorkingTranscript, readReporterOverlay } from "../server/transcription-jobs.mjs";
import { computeReviewStateHash } from "../server/review-state-hash.mjs";
import { getTranscriptPrintModel } from "../server/transcript-print-model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hash = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
function preserveQualification(name, directory) { if (!process.env.PHASE_E_QUALIFICATION_DIR) return; const target = path.join(process.env.PHASE_E_QUALIFICATION_DIR, name); fs.mkdirSync(target, { recursive: true }); fs.cpSync(directory, target, { recursive: true }); }
function fixture(t) { const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-artifacts-")); t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true })); const built = spawnSync(process.execPath, [path.join(root, "scripts", "create-milestone2-browser-fixture.mjs"), storageRoot], { encoding: "utf8" }); assert.equal(built.status, 0, built.stderr); return { ...JSON.parse(built.stdout), storageRoot, depositionId: JSON.parse(built.stdout).id }; }
async function finalize(f) { recordExhibitAudit(root, { ...f, actor: "Reporter", input: { result: "NO_EXHIBITS", sourceAnchor: "reporter-review:exhibits" } }); await recordTranscriptCompletion(root, { ...f, actor: "Reporter", input: {} }); return (await requestFinalization(root, { ...f, actor: "Reporter" })).event; }
function edit(f, text) { const transcript = getWorkingTranscript(root, f), overlay = readReporterOverlay(root, f); appendReporterOperations(root, { ...f, operations: [{ op: "replace", wordId: transcript.segments[0].asrWordIds[0], text }], expectedReviewStateHash: computeReviewStateHash({ transcript, overlay }) }); }
function makeFederal(f, selection) { const canonicalFile = path.join(f.directory, "intake", "canonical-deposition-record.json"), record = JSON.parse(fs.readFileSync(canonicalFile, "utf8")); record.case.jurisdictionType = { value: "federal" }; record.case.court = { value: "UNITED STATES DISTRICT COURT FOR THE WESTERN DISTRICT OF TEXAS" }; const oath = record.openingRecord.oathAdministrations.at(-1); oath.selection = selection; oath.spokenText = selection === "OATH" ? "Do you swear that your testimony will be truthful?" : "Do you affirm that your testimony will be truthful?"; oath.officer = { role: "Federal deposition officer", name: "Riley Reporter" }; record.reviewElection = { schemaVersion: "2.0.0", events: [{ id: "review-requested", kind: "RULE_30E_REVIEW_ELECTION", jurisdiction: "federal", status: "REQUESTED", requestedBy: "Dr. Synthetic Witness", requestedAt: "2026-08-26T13:00:00.000Z", sourceAnchor: "transcript:20:1", recordedBy: "Riley Reporter", recordedAt: "2026-08-26T13:00:00.000Z" }], notifications: [{ id: "notice", kind: "RULE_30E_OFFICER_NOTIFICATION", reviewElectionId: "review-requested", notifiedAt: "2026-07-01T12:00:00.000Z", officerIdentity: "Riley Reporter", recipient: "Dr. Synthetic Witness", sourceAnchor: "email:notice", recordedBy: "Riley Reporter", recordedAt: "2026-07-01T12:01:00.000Z" }], completions: [{ id: "review-complete", kind: "RULE_30E_REVIEW_COMPLETION", reviewElectionId: "review-requested", disposition: "COMPLETED", completedAt: "2026-07-20T12:00:00.000Z", sourceAnchor: "review:return", recordedBy: "Riley Reporter", recordedAt: "2026-07-20T12:01:00.000Z" }], corrections: [], overrides: [] }; record.certification.certificationDate = { value: "2026-09-03" }; fs.writeFileSync(canonicalFile, JSON.stringify(record, null, 2)); const assemblyFile = path.join(f.directory, "intake", "complete-transcript-assembly.json"), assembly = JSON.parse(fs.readFileSync(assemblyFile, "utf8")); assembly.operator.jurisdiction = "federal"; assembly.operator.signatureDisposition = "requested"; fs.writeFileSync(assemblyFile, JSON.stringify(assembly, null, 2)); }

test("FINAL-v1 qualifies exact stored DOCX/PDF bytes and repeated requests reuse them", async t => {
  const f = fixture(t), final = await finalize(f), result = await qualifyFinalArtifacts(root, { ...f, finalVersionId: final.finalVersionId, actor: "Reporter" });
  assert.equal(result.created, true); assert.equal(result.manifest.finalizationEventId, final.id); assert.equal(result.manifest.bindings.completeDocumentModelDigest, final.binding.document.completeDocumentModelHash); assert.equal(result.manifest.bindings.administrativeIndexProjectionDigest, final.binding.readiness.source.administrativeProjectionDigest); assert.equal(result.manifest.bindings.renderingSpecificationDigest, final.binding.document.renderingSpecificationHash);
  const directory = path.join(f.directory, "final", "FINAL-v1"), docx = path.join(directory, "transcript.docx"), pdf = path.join(directory, "transcript.pdf");
  preserveQualification("texas-oath", directory);
  assert.equal(result.manifest.artifacts.docx.sha256, hash(docx)); assert.equal(result.manifest.artifacts.pdf.sha256, hash(pdf)); assert.equal(result.manifest.artifacts.docx.byteCount, fs.statSync(docx).size); assert.equal(result.manifest.artifacts.pdf.byteCount, fs.statSync(pdf).size); assert.equal(verifyFinalArtifacts(root, { ...f, finalVersionId: "FINAL-v1" }).verified, true);
  const again = await qualifyFinalArtifacts(root, { ...f, finalVersionId: "FINAL-v1", actor: "Reporter", sha256: "fake", verified: true }); assert.equal(again.created, false); assert.equal(again.manifest.provenanceEventId, result.manifest.provenanceEventId);
  assert.equal(fs.existsSync(path.join(f.directory, "transcript", "complete-transcript.docx")), false, "working artifacts do not acquire final authority");
});

test("tamper and missing bytes fail without rewriting the manifest", async t => {
  const f = fixture(t), final = await finalize(f), result = await qualifyFinalArtifacts(root, { ...f, finalVersionId: final.finalVersionId, actor: "Reporter" }), manifest = JSON.stringify(result.manifest, null, 2), directory = path.join(f.directory, "final", "FINAL-v1");
  fs.appendFileSync(path.join(directory, "transcript.docx"), "tampered"); assert.throws(() => verifyFinalArtifacts(root, { ...f, finalVersionId: "FINAL-v1" }), /DOCX_INTEGRITY_FAILURE/); assert.equal(fs.readFileSync(path.join(directory, "manifest.json"), "utf8").trim(), manifest);
  fs.writeFileSync(path.join(directory, "transcript.docx"), Buffer.alloc(result.manifest.artifacts.docx.byteCount)); fs.rmSync(path.join(directory, "transcript.pdf")); assert.throws(() => verifyFinalArtifacts(root, { ...f, finalVersionId: "FINAL-v1" }), /DOCX_INTEGRITY_FAILURE|PDF_MISSING/);
  await assert.rejects(() => qualifyFinalArtifacts(root, { ...f, finalVersionId: "FINAL-v1", actor: "Reporter" }), /INTEGRITY_FAILURE|MISSING/);
});

test("later edits cannot leak into v1 and v2 has independent immutable storage", async t => {
  const f = fixture(t), v1 = await finalize(f), a1 = await qualifyFinalArtifacts(root, { ...f, finalVersionId: v1.finalVersionId, actor: "Reporter" }), v1Manifest = JSON.stringify(a1.manifest);
  edit(f, "Corrected");
  const preserved = await qualifyFinalArtifacts(root, { ...f, finalVersionId: "FINAL-v1", actor: "Reporter" }); assert.equal(preserved.created, false); assert.equal(JSON.stringify(preserved.manifest), v1Manifest);
  recordExhibitAudit(root, { ...f, actor: "Reporter", input: { result: "NO_EXHIBITS", sourceAnchor: "reporter-review:renewed", correctionReason: "Transcript changed." } }); await recordTranscriptCompletion(root, { ...f, actor: "Reporter", input: { reason: "Correction complete." } }); const v2 = (await requestFinalization(root, { ...f, actor: "Reporter" })).event;
  const a2 = await qualifyFinalArtifacts(root, { ...f, finalVersionId: v2.finalVersionId, actor: "Reporter" }); assert.equal(a2.created, true); assert.notEqual(a2.manifest.finalizationBindingDigest, a1.manifest.finalizationBindingDigest); assert.equal(JSON.stringify(verifyFinalArtifacts(root, { ...f, finalVersionId: "FINAL-v1" }).manifest), v1Manifest); assert.ok(fs.existsSync(path.join(f.directory, "final", "FINAL-v2", "transcript.pdf")));
});

test("qualification fails closed without a final version and exposes server-owned APIs", async t => {
  const f = fixture(t); assert.equal(getFinalArtifactStatus(root, { ...f, finalVersionId: "FINAL-v1" }).status, "FINALIZED_WITHOUT_QUALIFIED_ARTIFACTS"); await assert.rejects(() => qualifyFinalArtifacts(root, { ...f, finalVersionId: "FINAL-v1", actor: "Reporter" }), /FINAL_VERSION_NOT_FOUND/);
  const source = fs.readFileSync(new URL("../server/local-api.mjs", import.meta.url), "utf8"); assert.match(source, /\/api\/finalization\/artifacts\/generate/); assert.match(source, /\/api\/finalization\/artifacts\/status/); assert.match(source, /\/api\/finalization\/artifacts\/verify/); assert.doesNotMatch(source, /qualifyFinalArtifacts\([^)]*(sha256|verified|byteCount)/);
});

test("an incomplete final directory is never blessed or overwritten", async t => {
  const f = fixture(t), final = await finalize(f), directory = path.join(f.directory, "final", final.finalVersionId); fs.mkdirSync(directory, { recursive: true }); fs.writeFileSync(path.join(directory, "transcript.docx"), "partial");
  await assert.rejects(() => qualifyFinalArtifacts(root, { ...f, finalVersionId: final.finalVersionId, actor: "Reporter" }), /INCOMPLETE_SET/); assert.equal(fs.readFileSync(path.join(directory, "transcript.docx"), "utf8"), "partial"); assert.equal(fs.existsSync(path.join(directory, "manifest.json")), false);
});

for (const selection of ["OATH", "AFFIRMATION"]) test(`Federal ${selection} with completed requested review qualifies immutable artifacts`, async t => {
  const f = fixture(t); makeFederal(f, selection); const final = await finalize(f), result = await qualifyFinalArtifacts(root, { ...f, finalVersionId: final.finalVersionId, actor: "Reporter" });
  preserveQualification(`federal-${selection.toLowerCase()}-review-requested`, path.join(f.directory, "final", "FINAL-v1"));
  assert.equal(result.manifest.bindings.certification.variant, `FEDERAL_${selection}_REVIEW_REQUESTED`); assert.equal(result.manifest.parity.status, "PASS"); assert.equal(verifyFinalArtifacts(root, { ...f, finalVersionId: "FINAL-v1" }).verified, true);
});

test("an exhibits-present final binds the qualified exhibit identity and renders its index", async t => {
  const f = fixture(t), paragraphId = getTranscriptPrintModel(root, f).paragraphs[0].id;
  const exhibit = recordExhibit(root, { ...f, actor: "Reporter", input: { label: "Exhibit 1", description: "Physical contract", markedAt: "2026-08-26T13:00:00Z", markedBy: "Counsel", transcriptReferences: [{ sourceAnchor: "transcript:8:2", paragraphId }], material: { kind: "PHYSICAL" }, custody: { status: "RESOLVED", holder: "Counsel", sourceAnchor: "transcript:20:2" }, sealedHandling: { status: "NOT_APPLICABLE" }, packageDisposition: "EXCLUDED", packageDispositionReason: "Retained by counsel.", sourceAnchor: "transcript:8:2" } });
  recordExhibitAudit(root, { ...f, actor: "Reporter", input: { result: "EXHIBITS_PRESENT", sourceAnchor: "reporter-review:exhibits" } }); await recordTranscriptCompletion(root, { ...f, actor: "Reporter", input: {} }); const final = (await requestFinalization(root, { ...f, actor: "Reporter" })).event;
  const result = await qualifyFinalArtifacts(root, { ...f, finalVersionId: final.finalVersionId, actor: "Reporter" }); assert.equal(result.manifest.bindings.exhibits.state, "EXHIBITS_PRESENT_COMPLETE"); assert.equal(result.manifest.bindings.exhibits.currentEffective[0].exhibitId, exhibit.exhibitId); assert.equal(result.manifest.parity.status, "PASS");
});

test("concurrent requests for one FINAL-vN converge on one immutable result", async t => {
  const f = fixture(t), final = await finalize(f); const results = await Promise.all([qualifyFinalArtifacts(root, { ...f, finalVersionId: final.finalVersionId, actor: "Reporter" }), qualifyFinalArtifacts(root, { ...f, finalVersionId: final.finalVersionId, actor: "Reporter" })]);
  assert.deepEqual(results.map(item => item.created).sort(), [false, true]); assert.equal(results[0].manifest.provenanceEventId, results[1].manifest.provenanceEventId); assert.equal(verifyFinalArtifacts(root, { ...f, finalVersionId: final.finalVersionId }).verified, true); assert.deepEqual(fs.readdirSync(path.join(f.directory, "final", final.finalVersionId)).sort(), ["manifest.json", "transcript.docx", "transcript.pdf"]);
});

test("a failing owner cleans only its staging and a waiting request can publish", async t => {
  const f = fixture(t), final = await finalize(f), options = { ...f, finalVersionId: final.finalVersionId, actor: "Reporter" }, key = "controlled-final"; let releaseFailure; const gate = new Promise(resolve => { releaseFailure = resolve; });
  const failing = _testing.withGenerationOwnership(key, () => _testing.generateOwned(root, options, { beforePublish: async () => { await gate; throw new Error("INJECTED_PUBLICATION_FAILURE"); } }));
  const waiting = _testing.withGenerationOwnership(key, () => _testing.generateOwned(root, options)); releaseFailure(); await assert.rejects(failing, /INJECTED_PUBLICATION_FAILURE/); const result = await waiting;
  assert.equal(result.created, true); assert.equal(verifyFinalArtifacts(root, options).verified, true); assert.equal(fs.readdirSync(path.join(f.directory, "final")).some(name => name.includes("staging")), false);
});

test("generation ownership is scoped so unrelated final identities can proceed", async () => {
  let active = 0, maximum = 0, release; const gate = new Promise(resolve => { release = resolve; }); const work = () => _testing.withGenerationOwnership(crypto.randomUUID(), async () => { active += 1; maximum = Math.max(maximum, active); await gate; active -= 1; }); const first = work(), second = work(); await new Promise(resolve => setImmediate(resolve)); assert.equal(maximum, 2); release(); await Promise.all([first, second]); assert.equal(_testing.generationLocks.size, 0);
});
