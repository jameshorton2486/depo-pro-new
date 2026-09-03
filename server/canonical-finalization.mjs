import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { depositionDirectory } from "./deposition-store.mjs";
import { getFinalizationReadiness, FINALIZATION_READINESS_VERSION } from "./finalization-readiness.mjs";
import { getCompleteTranscriptModel } from "./complete-transcript-model.mjs";
import { createFixedPageDocxSpec } from "./final-document-docx.mjs";
import { loadTemplateVariant } from "./insertion-pages/templates.mjs";
import { getExhibitReadiness } from "./canonical-exhibit-lifecycle.mjs";

export const CANONICAL_FINALIZATION_VERSION = "1.0.0";
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const clean = (value, limit = 2000) => String(value ?? "").trim().slice(0, limit);
const requireText = (value, message, limit = 2000) => { const result = clean(value, limit); if (!result) throw new Error(message); return result; };

function paths(root, depositionId, storageRoot) {
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  return { directory, file: path.join(directory, "intake", "canonical-finalization-ledger.json") };
}
function emptyLedger(depositionId) { return { schemaVersion: CANONICAL_FINALIZATION_VERSION, recordType: "CANONICAL_FINALIZATION_LEDGER", depositionId, transcriptCompletions: [], finalizations: [] }; }
function readLedger(file, depositionId) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : emptyLedger(depositionId); }
function atomicJson(file, value) { const temporary = `${file}.${crypto.randomUUID()}.tmp`, descriptor = fs.openSync(temporary, "wx"); try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); } fs.renameSync(temporary, file); }
function attributed(actor) { return { recordedBy: requireText(actor, "Server-established attribution is required.", 300), recordedAt: new Date().toISOString() }; }
function currentEffective(events) { const superseded = new Set((events ?? []).map(item => item.supersedesEventId).filter(Boolean)); return [...(events ?? [])].reverse().find(item => !superseded.has(item.id)) ?? null; }
function completionState(readiness) { return { depositionId: readiness.source.depositionId, profile: readiness.profile, transcriptModelHash: readiness.source.transcriptModelHash, reviewStateHash: readiness.source.reviewStateHash }; }
function completionIsCurrent(completion, readiness) { const state = completionState(readiness); return Boolean(completion) && completion.depositionId === state.depositionId && completion.profile === state.profile && completion.transcriptModelHash === state.transcriptModelHash && completion.reviewStateHash === state.reviewStateHash; }

async function finalizationBinding(root, { depositionId, storageRoot, readiness }) {
  const model = await getCompleteTranscriptModel(root, { depositionId, storageRoot });
  if (model.modelHash !== readiness.source.completeDocumentModelHash) throw new Error("FINALIZATION_MODEL_STATE_CHANGED: The complete document changed during finalization evaluation.");
  const rendering = createFixedPageDocxSpec(model), template = await loadTemplateVariant(model.variant);
  if (!template.available || template.approval?.state !== "current") throw new Error("FINALIZATION_TEMPLATE_APPROVAL_REQUIRED: The selected certification template is not currently approved.");
  const exhibits = getExhibitReadiness(root, { depositionId, storageRoot });
  if (!exhibits.ready) throw new Error("FINALIZATION_EXHIBITS_NOT_READY: Exhibit lifecycle readiness changed during finalization evaluation.");
  return {
    readiness: { policyVersion: FINALIZATION_READINESS_VERSION, evaluationDigest: readiness.evaluationDigest, source: structuredClone(readiness.source) },
    document: { completeDocumentModelHash: model.modelHash, testimonyModelHash: model.source.testimonyModelHash, reviewStateHash: model.source.reviewStateHash, insertionPageSetHash: model.source.insertionPageSetHash, renderingSpecificationHash: rendering.sha256, renderer: rendering.renderer, layoutProfileId: rendering.profile.id },
    certification: { variant: model.variant, contentDigest: template.approval.contentDigest, authorityDigest: template.approval.authorityDigest, approvedDigest: template.approval.approvedDigest, approvedAuthorityDigest: template.approval.approvedAuthorityDigest, approvedBy: template.approval.approvedBy, approverRole: template.approval.approverRole, approvalScope: template.approval.approvalScope, approvedAt: template.approval.approvedAt, templateHashes: Object.fromEntries(Object.entries(template.templates).map(([role, value]) => [role, value.sha256])) },
    exhibits: { lifecycleDigest: exhibits.lifecycleDigest, state: exhibits.status, auditId: exhibits.audit?.id ?? null, currentEffective: exhibits.exhibits.map(item => ({ exhibitId: item.exhibitId, eventId: item.id, status: item.status, label: item.label, packageDisposition: item.packageDisposition, fileSha256: item.material?.file?.sha256 ?? null })) },
  };
}

export async function recordTranscriptCompletion(root, { depositionId, storageRoot, actor, input = {} } = {}) {
  const location = paths(root, depositionId, storageRoot), ledger = readLedger(location.file, depositionId), readiness = await getFinalizationReadiness(root, { depositionId, storageRoot });
  if (!readiness.source.transcriptModelHash || !readiness.source.reviewStateHash) throw new Error("TRANSCRIPT_COMPLETION_STATE_UNAVAILABLE: The authoritative transcript and review state are required.");
  const prior = currentEffective(ledger.transcriptCompletions);
  if (prior && !clean(input.reason, 2000)) throw new Error("Explain why transcript completion is being renewed or corrected.");
  const event = { id: crypto.randomUUID(), kind: "TRANSCRIPT_PRODUCTION_COMPLETED", ...completionState(readiness), sourceRevision: { canonicalRecordDigest: readiness.source.canonicalRecordDigest, readinessPolicyVersion: FINALIZATION_READINESS_VERSION }, comment: clean(input.comment, 2000) || null, reason: clean(input.reason, 2000) || null, ...attributed(actor), supersedesEventId: prior?.id ?? null };
  ledger.transcriptCompletions.push(event); atomicJson(location.file, ledger); return event;
}

export async function requestFinalization(root, { depositionId, storageRoot, actor } = {}) {
  const location = paths(root, depositionId, storageRoot), ledger = readLedger(location.file, depositionId), readiness = await getFinalizationReadiness(root, { depositionId, storageRoot });
  if (!readiness.ready) { const error = new Error(`FINALIZATION_READINESS_BLOCKED:${readiness.blockers.map(item => item.code).join(",")}`); error.readiness = readiness; throw error; }
  const completion = currentEffective(ledger.transcriptCompletions);
  if (!completion) throw new Error("TRANSCRIPT_COMPLETION_REQUIRED: Record transcript production completion before finalizing.");
  if (!completionIsCurrent(completion, readiness)) throw new Error("TRANSCRIPT_COMPLETION_STALE: Record transcript completion against the current transcript and review state.");
  const binding = await finalizationBinding(root, { depositionId, storageRoot, readiness }), bindingDigest = digest({ completionEventId: completion.id, profile: readiness.profile, ...binding });
  const duplicate = ledger.finalizations.find(item => item.bindingDigest === bindingDigest);
  if (duplicate) return { event: structuredClone(duplicate), created: false };
  const predecessor = ledger.finalizations.at(-1) ?? null, sequence = ledger.finalizations.length + 1;
  const event = { id: crypto.randomUUID(), kind: "DEPOSITION_FINALIZED", finalVersionId: `FINAL-v${sequence}`, sequence, depositionId, profile: readiness.profile, transcriptCompletionEventId: completion.id, bindingDigest, binding, ...attributed(actor), predecessorFinalVersionId: predecessor?.finalVersionId ?? null };
  ledger.finalizations.push(event); atomicJson(location.file, ledger); return { event, created: true };
}

export async function getCanonicalFinalizationStatus(root, { depositionId, storageRoot } = {}) {
  const location = paths(root, depositionId, storageRoot), ledger = readLedger(location.file, depositionId), readiness = await getFinalizationReadiness(root, { depositionId, storageRoot }), completion = currentEffective(ledger.transcriptCompletions), completionCurrent = completionIsCurrent(completion, readiness), latest = ledger.finalizations.at(-1) ?? null;
  let state = "WORKING";
  if (completionCurrent) state = readiness.ready ? "FINALIZATION_READY" : "TRANSCRIPT_COMPLETION_RECORDED";
  const currentBinding = completionCurrent && readiness.ready ? await finalizationBinding(root, { depositionId, storageRoot, readiness }) : null;
  const currentBindingDigest = currentBinding ? digest({ completionEventId: completion.id, profile: readiness.profile, ...currentBinding }) : null;
  const currentFinal = currentBindingDigest ? ledger.finalizations.find(item => item.bindingDigest === currentBindingDigest) ?? null : null;
  if (currentFinal) state = "FINALIZED";
  return { schemaVersion: CANONICAL_FINALIZATION_VERSION, recordType: "CANONICAL_FINALIZATION_STATUS", depositionId, state, readiness, transcriptCompletion: completion ? { event: structuredClone(completion), current: completionCurrent } : null, currentFinalVersion: currentFinal ? structuredClone(currentFinal) : null, latestFinalVersion: latest ? structuredClone(latest) : null, history: structuredClone(ledger) };
}

export const _testing = { completionIsCurrent, completionState, currentEffective, digest };
