import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { recordExhibit, recordExhibitAudit } from "../server/canonical-exhibit-lifecycle.mjs";
import { getCanonicalFinalizationStatus, recordTranscriptCompletion, requestFinalization } from "../server/canonical-finalization.mjs";
import { getFinalizationReadiness } from "../server/finalization-readiness.mjs";
import { appendReporterOperations, getWorkingTranscript, readReporterOverlay } from "../server/transcription-jobs.mjs";
import { computeReviewStateHash } from "../server/review-state-hash.mjs";
import { getTranscriptPrintModel } from "../server/transcript-print-model.mjs";
import { getCompleteTranscriptModel } from "../server/complete-transcript-model.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function fixture(t) {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "depo-finalization-")); t.after(() => fs.rmSync(storageRoot, { recursive: true, force: true }));
  const built = spawnSync(process.execPath, [path.join(root, "scripts", "create-milestone2-browser-fixture.mjs"), storageRoot], { encoding: "utf8" }); assert.equal(built.status, 0, built.stderr);
  const value = JSON.parse(built.stdout); return { ...value, storageRoot, depositionId: value.id };
}
async function qualify(f) {
  recordExhibitAudit(root, { ...f, actor: "Reporter", input: { result: "NO_EXHIBITS", sourceAnchor: "reporter-review:exhibits" } });
  return recordTranscriptCompletion(root, { ...f, actor: "Reporter", input: { comment: "Transcript production complete." } });
}
function editTranscript(f, text = "Doctor revised,") {
  const working = getWorkingTranscript(root, f), overlay = readReporterOverlay(root, f), wordId = working.segments[0].asrWordIds[0];
  const expectedReviewStateHash = computeReviewStateHash({ transcript: working, overlay });
  appendReporterOperations(root, { ...f, operations: [{ op: "replace", wordId, text }], expectedReviewStateHash });
}
function makeFederal(f, selection, review) {
  const canonicalFile = path.join(f.directory, "intake", "canonical-deposition-record.json"), record = JSON.parse(fs.readFileSync(canonicalFile, "utf8"));
  record.case.jurisdictionType = { value: "federal" }; record.case.court = { value: "UNITED STATES DISTRICT COURT FOR THE WESTERN DISTRICT OF TEXAS" }; const oath = record.openingRecord.oathAdministrations.at(-1); oath.selection = selection; oath.spokenText = selection === "OATH" ? "Do you swear that your testimony will be truthful?" : "Do you affirm that your testimony will be truthful?"; oath.officer.role = "Federal deposition officer"; oath.officer.name = "Riley Reporter";
  const reviewId = `review-${review}`; record.reviewElection = { schemaVersion: "2.0.0", events: [{ id: reviewId, kind: "RULE_30E_REVIEW_ELECTION", jurisdiction: "federal", status: review, requestedBy: review === "REQUESTED" ? "Dr. Synthetic Witness" : null, requestedAt: review === "REQUESTED" ? "2026-08-26T13:00:00.000Z" : null, sourceAnchor: "transcript:20:1", recordedBy: "Riley Reporter", recordedAt: "2026-08-26T13:00:00.000Z" }], notifications: review === "REQUESTED" ? [{ id: "notice", kind: "RULE_30E_OFFICER_NOTIFICATION", reviewElectionId: reviewId, notifiedAt: "2026-07-01T12:00:00.000Z", officerIdentity: "Riley Reporter", recipient: "Dr. Synthetic Witness", sourceAnchor: "email:notice", recordedBy: "Riley Reporter", recordedAt: "2026-07-01T12:01:00.000Z" }] : [], completions: review === "REQUESTED" ? [{ id: "review-complete", kind: "RULE_30E_REVIEW_COMPLETION", reviewElectionId: reviewId, disposition: "COMPLETED", completedAt: "2026-07-20T12:00:00.000Z", sourceAnchor: "review:return", recordedBy: "Riley Reporter", recordedAt: "2026-07-20T12:01:00.000Z" }] : [], corrections: [], overrides: [] }; record.certification.certificationDate = { value: "2026-09-03" }; fs.writeFileSync(canonicalFile, JSON.stringify(record, null, 2));
  const assemblyFile = path.join(f.directory, "intake", "complete-transcript-assembly.json"), assembly = JSON.parse(fs.readFileSync(assemblyFile, "utf8")); assembly.operator.jurisdiction = "federal"; assembly.operator.signatureDisposition = review === "REQUESTED" ? "requested" : "waived"; fs.writeFileSync(assemblyFile, JSON.stringify(assembly, null, 2));
}

test("ready alone cannot finalize, and clients cannot assert ready or finalized", async t => {
  const f = fixture(t); recordExhibitAudit(root, { ...f, actor: "Reporter", input: { result: "NO_EXHIBITS", sourceAnchor: "review" } });
  await assert.rejects(() => requestFinalization(root, { ...f, actor: "Reporter", ready: true, finalized: true }), /TRANSCRIPT_COMPLETION_REQUIRED/);
  assert.equal(fs.existsSync(path.join(f.directory, "intake", "canonical-finalization-ledger.json")), false);
});

test("current completion and readiness create immutable FINAL-v1 idempotently", async t => {
  const f = fixture(t), completion = await qualify(f), first = await requestFinalization(root, { ...f, actor: "Reporter" }), second = await requestFinalization(root, { ...f, actor: "Reporter" });
  assert.equal(first.created, true); assert.equal(first.event.finalVersionId, "FINAL-v1"); assert.equal(first.event.transcriptCompletionEventId, completion.id);
  assert.equal(second.created, false); assert.equal(second.event.id, first.event.id);
  assert.ok(first.event.binding.readiness.evaluationDigest); assert.ok(first.event.binding.document.completeDocumentModelHash); assert.ok(first.event.binding.document.renderingSpecificationHash);
  assert.equal(first.event.binding.exhibits.state, "NO_EXHIBITS"); assert.ok(first.event.binding.exhibits.auditId);
  assert.equal(first.event.binding.certification.approvedDigest, first.event.binding.certification.contentDigest);
  assert.equal(first.event.binding.document.artifactSha256, undefined, "Phase C makes no ungenerated artifact-byte claim");
  assert.equal((await getCanonicalFinalizationStatus(root, f)).state, "FINALIZED");
});

test("a transcript edit makes completion stale and preserves v1", async t => {
  const f = fixture(t); await qualify(f); const first = (await requestFinalization(root, { ...f, actor: "Reporter" })).event, snapshot = JSON.stringify(first);
  editTranscript(f);
  const status = await getCanonicalFinalizationStatus(root, f); assert.equal(status.state, "WORKING"); assert.equal(status.transcriptCompletion.current, false); assert.equal(JSON.stringify(status.history.finalizations[0]), snapshot);
  await assert.rejects(() => requestFinalization(root, { ...f, actor: "Reporter" }), /READINESS_BLOCKED|TRANSCRIPT_COMPLETION_STALE/);
});

test("corrected state requires renewed audit and completion, then creates linked v2 without changing v1", async t => {
  const f = fixture(t); await qualify(f); const v1 = (await requestFinalization(root, { ...f, actor: "Reporter" })).event, v1Bytes = JSON.stringify(v1);
  editTranscript(f, "Doctor corrected,");
  recordExhibitAudit(root, { ...f, actor: "Reporter", input: { result: "NO_EXHIBITS", sourceAnchor: "review:renewed", correctionReason: "Transcript changed." } });
  await recordTranscriptCompletion(root, { ...f, actor: "Reporter", input: { reason: "Transcript correction completed." } });
  const v2 = (await requestFinalization(root, { ...f, actor: "Reporter" })).event;
  assert.equal(v2.finalVersionId, "FINAL-v2"); assert.equal(v2.predecessorFinalVersionId, "FINAL-v1"); assert.notEqual(v2.bindingDigest, v1.bindingDigest);
  const status = await getCanonicalFinalizationStatus(root, f); assert.equal(status.state, "FINALIZED"); assert.equal(status.history.finalizations.length, 2); assert.equal(JSON.stringify(status.history.finalizations[0]), v1Bytes);
});

test("canonical administrative changes never rewrite an existing final version", async t => {
  const f = fixture(t); await qualify(f); const v1 = (await requestFinalization(root, { ...f, actor: "Reporter" })).event, before = JSON.stringify(v1);
  const canonicalFile = path.join(f.directory, "intake", "canonical-deposition-record.json"), record = JSON.parse(fs.readFileSync(canonicalFile, "utf8")); record.case.caseStyle.value = "Corrected Caption"; fs.writeFileSync(canonicalFile, JSON.stringify(record, null, 2));
  const status = await getCanonicalFinalizationStatus(root, f); assert.notEqual(status.state, "FINALIZED"); assert.equal(JSON.stringify(status.history.finalizations[0]), before);
});

test("missing or stale exhibit authority blocks finalization", async t => {
  const f = fixture(t); await recordTranscriptCompletion(root, { ...f, actor: "Reporter", input: {} });
  await assert.rejects(() => requestFinalization(root, { ...f, actor: "Reporter" }), /EXHIBIT_AUDIT_REQUIRED/);
});

test("exhibits-present finalization binds only current-effective exhibit identity and disposition", async t => {
  const f = fixture(t), paragraphId = getTranscriptPrintModel(root, f).paragraphs[0].id;
  const saved = recordExhibit(root, { ...f, actor: "Reporter", input: { label: "Exhibit 1", description: "Physical contract", markedAt: "2026-08-26T13:00:00Z", markedBy: "Dennis J. Bentley", transcriptReferences: [{ sourceAnchor: "transcript:8:2", paragraphId }], material: { kind: "PHYSICAL" }, custody: { status: "RESOLVED", holder: "Dennis J. Bentley", sourceAnchor: "transcript:20:2" }, sealedHandling: { status: "NOT_APPLICABLE" }, packageDisposition: "EXCLUDED", packageDispositionReason: "Original retained by counsel.", sourceAnchor: "transcript:8:2" } });
  recordExhibitAudit(root, { ...f, actor: "Reporter", input: { result: "EXHIBITS_PRESENT", sourceAnchor: "reporter-review:exhibits" } });
  const model = await getCompleteTranscriptModel(root, f), indexText = model.pages.find(page => page.role === "index").lines.map(line => line.content).join("\n");
  assert.match(indexText, /EXHIBITS/); assert.match(indexText, /Exhibit 1/); assert.equal(model.pagination.index.exhibits[0].page, 4);
  await recordTranscriptCompletion(root, { ...f, actor: "Reporter", input: {} });
  const final = (await requestFinalization(root, { ...f, actor: "Reporter" })).event;
  assert.equal(final.binding.exhibits.state, "EXHIBITS_PRESENT_COMPLETE"); assert.deepEqual(final.binding.exhibits.currentEffective.map(item => item.exhibitId), [saved.exhibitId]); assert.equal(final.binding.exhibits.currentEffective[0].packageDisposition, "EXCLUDED");
});

for (const selection of ["OATH", "AFFIRMATION"]) for (const review of ["REQUESTED", "NOT_REQUESTED"]) test(`Federal ${selection} plus ${review} finalizes through the qualified certification authority`, async t => {
  const f = fixture(t); makeFederal(f, selection, review); await qualify(f); const readiness = await getFinalizationReadiness(root, f); assert.equal(readiness.ready, true, JSON.stringify(readiness.blockers)); const result = await requestFinalization(root, { ...f, actor: "Reporter" });
  assert.equal(result.created, true); assert.equal(result.event.profile, "FEDERAL_DEPOSITION"); assert.equal(result.event.binding.certification.variant, `FEDERAL_${selection}_REVIEW_${review}`); assert.equal(result.event.binding.certification.approvedDigest, result.event.binding.certification.contentDigest);
});

test("finalization APIs expose only server-validated mutations", () => {
  const source = fs.readFileSync(new URL("../server/local-api.mjs", import.meta.url), "utf8");
  assert.match(source, /\/api\/finalization\/status/); assert.match(source, /\/api\/finalization\/transcript-completion/); assert.match(source, /\/api\/finalization\/finalize/);
  assert.doesNotMatch(source, /requestFinalization\([^)]*(ready|finalized)/);
});
