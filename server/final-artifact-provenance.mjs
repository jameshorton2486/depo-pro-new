import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { depositionDirectory } from "./deposition-store.mjs";
import { getCanonicalFinalizationStatus, getFinalizationVersion } from "./canonical-finalization.mjs";
import { getCompleteTranscriptModel } from "./complete-transcript-model.mjs";
import { createFixedPageDocxSpec, createTranscriptDocxArtifact } from "./final-document-docx.mjs";
import { createTranscriptPdfArtifact } from "./final-document-pdf.mjs";
import { getFinalizationReadiness } from "./finalization-readiness.mjs";

export const FINAL_ARTIFACT_PROVENANCE_VERSION = "1.0.0";
const generationLocks = new Map();
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const clean = value => String(value ?? "").trim();
function atomicJson(file, value) { const temporary = `${file}.${crypto.randomUUID()}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }); fs.renameSync(temporary, file); }
function locations(root, { depositionId, storageRoot, finalVersionId }) {
  if (!/^FINAL-v[1-9]\d*$/.test(clean(finalVersionId))) throw new Error("FINAL_VERSION_ID_INVALID: A canonical FINAL-vN identity is required.");
  const directory = depositionDirectory(root, depositionId, { storageRoot }), finalDirectory = path.join(directory, "final", finalVersionId);
  return { directory, finalDirectory, manifestFile: path.join(finalDirectory, "manifest.json"), docxFile: path.join(finalDirectory, "transcript.docx"), pdfFile: path.join(finalDirectory, "transcript.pdf") };
}
function readManifest(file) { return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null; }
function artifact(file) { const bytes = fs.readFileSync(file); return { bytes: bytes.length, sha256: sha256(bytes) }; }
const errorCode = error => String(error instanceof Error ? error.message : error ?? "").match(/^([A-Z][A-Z0-9_]+)/)?.[1] ?? "FINAL_ARTIFACT_EVALUATION_FAILED";
function assertStored(item, file, kind) {
  if (!fs.existsSync(file)) throw new Error(`FINAL_ARTIFACT_${kind}_MISSING: The qualified ${kind} artifact is missing.`);
  const actual = artifact(file);
  if (actual.bytes !== item.byteCount || actual.sha256 !== item.sha256) throw new Error(`FINAL_ARTIFACT_${kind}_INTEGRITY_FAILURE: Stored ${kind} bytes do not match the immutable manifest.`);
  return actual;
}
export function verifyFinalArtifacts(root, options = {}) {
  const location = locations(root, options), manifest = readManifest(location.manifestFile);
  if (!manifest) throw new Error("FINAL_ARTIFACT_MANIFEST_NOT_FOUND: No qualified artifacts exist for this final version.");
  const finalization = getFinalizationVersion(root, options);
  if (manifest.finalizationEventId !== finalization.id || manifest.finalizationBindingDigest !== finalization.bindingDigest) throw new Error("FINAL_ARTIFACT_FINALIZATION_MISMATCH: The manifest is not bound to the requested finalization event.");
  assertStored(manifest.artifacts.docx, location.docxFile, "DOCX"); assertStored(manifest.artifacts.pdf, location.pdfFile, "PDF");
  return { status: "FINAL_ARTIFACTS_QUALIFIED", verified: true, manifest };
}
async function assertRenderableState(root, options, finalization) {
  const readiness = await getFinalizationReadiness(root, options), model = await getCompleteTranscriptModel(root, options), spec = createFixedPageDocxSpec(model);
  const bound = finalization.binding;
  if (!readiness.ready || model.modelHash !== bound.document.completeDocumentModelHash) throw new Error("FINAL_ARTIFACT_MODEL_MISMATCH: Current authoritative document state does not match the requested final version.");
  if (readiness.source.administrativeProjectionDigest !== bound.readiness.source.administrativeProjectionDigest) throw new Error("FINAL_ARTIFACT_ADMINISTRATIVE_INDEX_MISMATCH: Administrative/index state does not match the requested final version.");
  if (spec.sha256 !== bound.document.renderingSpecificationHash || spec.renderer !== bound.document.renderer) throw new Error("FINAL_ARTIFACT_RENDERING_SPEC_MISMATCH: Rendering authority does not match the requested final version.");
  return { readiness, model, spec };
}
async function withGenerationOwnership(key, work) {
  const predecessor = generationLocks.get(key) ?? Promise.resolve();
  let release;
  const ownership = new Promise(resolve => { release = resolve; });
  const tail = predecessor.then(() => ownership);
  generationLocks.set(key, tail);
  await predecessor;
  try { return await work(); }
  finally { release(); if (generationLocks.get(key) === tail) generationLocks.delete(key); }
}
async function generateOwned(root, { depositionId, storageRoot, finalVersionId, actor }, hooks = {}) {
  const options = { depositionId, storageRoot, finalVersionId }, location = locations(root, options), existing = readManifest(location.manifestFile);
  if (existing) return { ...verifyFinalArtifacts(root, options), created: false };
  const finalization = getFinalizationVersion(root, options), { model, spec } = await assertRenderableState(root, options, finalization);
  if (fs.existsSync(location.finalDirectory)) throw new Error("FINAL_ARTIFACT_INCOMPLETE_SET: Final-version storage exists without a valid manifest and will not be overwritten.");
  fs.mkdirSync(path.dirname(location.finalDirectory), { recursive: true });
  let staging = fs.mkdtempSync(path.join(path.dirname(location.finalDirectory), `.${finalVersionId}-staging-`));
  try {
    await hooks.afterOwnership?.({ staging, location });
    const renderedDocx = createTranscriptDocxArtifact(root, { depositionId, storageRoot, printModel: model, outputDirectory: staging });
    createTranscriptPdfArtifact(root, { depositionId, storageRoot, printModel: model, outputDirectory: staging });
    const stagedDocx = path.join(staging, "complete-transcript.docx"), stagedPdf = path.join(staging, "complete-transcript.pdf");
    const docx = artifact(stagedDocx), pdf = artifact(stagedPdf);
    fs.renameSync(stagedDocx, path.join(staging, "transcript.docx")); fs.renameSync(stagedPdf, path.join(staging, "transcript.pdf"));
    fs.rmSync(renderedDocx.specPath, { force: true }); fs.rmSync(renderedDocx.mappingPath, { force: true });
    const manifest = {
      schemaVersion: FINAL_ARTIFACT_PROVENANCE_VERSION, recordType: "FINAL_ARTIFACT_MANIFEST", provenanceEventId: crypto.randomUUID(), depositionId, finalVersionId,
      finalizationEventId: finalization.id, finalizationBindingDigest: finalization.bindingDigest, generatedAt: new Date().toISOString(), generatedBy: clean(actor), verificationResult: "VERIFIED",
      bindings: { completeDocumentModelDigest: model.modelHash, administrativeIndexProjectionDigest: finalization.binding.readiness.source.administrativeProjectionDigest, renderingSpecificationDigest: spec.sha256, renderer: spec.renderer, certification: finalization.binding.certification, exhibits: finalization.binding.exhibits },
      parity: { status: "PASS", authority: "SHARED_FIXED_PAGE_RENDERING_SPEC", renderingSpecificationDigest: spec.sha256 },
      artifacts: { docx: { artifactId: crypto.randomUUID(), filename: "transcript.docx", relativePath: `final/${finalVersionId}/transcript.docx`, byteCount: docx.bytes, sha256: docx.sha256 }, pdf: { artifactId: crypto.randomUUID(), filename: "transcript.pdf", relativePath: `final/${finalVersionId}/transcript.pdf`, byteCount: pdf.bytes, sha256: pdf.sha256 } },
    };
    assertStored(manifest.artifacts.docx, path.join(staging, "transcript.docx"), "DOCX"); assertStored(manifest.artifacts.pdf, path.join(staging, "transcript.pdf"), "PDF"); atomicJson(path.join(staging, "manifest.json"), manifest);
    await hooks.beforePublish?.({ staging, location, manifest });
    fs.renameSync(staging, location.finalDirectory); staging = null;
    assertStored(manifest.artifacts.docx, location.docxFile, "DOCX"); assertStored(manifest.artifacts.pdf, location.pdfFile, "PDF");
    return { status: "FINAL_ARTIFACTS_QUALIFIED", verified: true, created: true, manifest };
  } finally { if (staging) fs.rmSync(staging, { recursive: true, force: true }); }
}
export async function qualifyFinalArtifacts(root, { depositionId, storageRoot, finalVersionId, actor } = {}) {
  if (!clean(actor)) throw new Error("FINAL_ARTIFACT_ACTOR_REQUIRED: Server-established generating actor is required.");
  const key = `${path.resolve(storageRoot ?? root)}\0${clean(depositionId)}\0${clean(finalVersionId)}`;
  return withGenerationOwnership(key, () => generateOwned(root, { depositionId, storageRoot, finalVersionId, actor }));
}

export function getFinalArtifactStatus(root, options = {}) {
  let location;
  try { location = locations(root, options); }
  catch (error) {
    if (/Deposition was not found/.test(String(error instanceof Error ? error.message : error))) return { status: "UNKNOWN_DEPOSITION", verified: false, finalVersionId: options.finalVersionId };
    throw error;
  }
  try { getFinalizationVersion(root, options); }
  catch (error) {
    if (errorCode(error) === "FINAL_VERSION_NOT_FOUND") return { status: "UNKNOWN_FINALIZATION", verified: false, finalVersionId: options.finalVersionId };
    throw error;
  }
  if (!fs.existsSync(location.finalDirectory)) return { status: "ARTIFACTS_NOT_GENERATED", verified: false, finalVersionId: options.finalVersionId };
  if (!fs.existsSync(location.manifestFile)) return { status: "ARTIFACT_INTEGRITY_FAILURE", verified: false, finalVersionId: options.finalVersionId, finding: { code: "FINAL_ARTIFACT_MANIFEST_MISSING", message: "Final-version storage exists without its immutable manifest." } };
  try { return { ...verifyFinalArtifacts(root, options), finalVersionId: options.finalVersionId }; }
  catch (error) { return { status: "ARTIFACT_INTEGRITY_FAILURE", verified: false, finalVersionId: options.finalVersionId, finding: { code: errorCode(error), message: error instanceof Error ? error.message : String(error) } }; }
}

/** Read-only Phase E authority used by the reporter projection. It does not acquire a generation lock. */
export async function getFinalArtifactProjection(root, options = {}) {
  const status = getFinalArtifactStatus(root, options);
  if (["UNKNOWN_DEPOSITION", "UNKNOWN_FINALIZATION", "ARTIFACT_INTEGRITY_FAILURE"].includes(status.status)) return { ...status, generationEligibility: "NOT_APPLICABLE" };
  if (status.verified) {
    return {
      status: "ARTIFACTS_VERIFIED", verified: true, finalVersionId: options.finalVersionId, generationEligibility: "ALREADY_GENERATED",
      artifacts: Object.fromEntries(Object.entries(status.manifest.artifacts).map(([kind, item]) => [kind, { kind, filename: item.filename, byteCount: item.byteCount, sha256: item.sha256 }])),
      provenance: { provenanceEventId: status.manifest.provenanceEventId, finalizationEventId: status.manifest.finalizationEventId, finalizationBindingDigest: status.manifest.finalizationBindingDigest, generatedAt: status.manifest.generatedAt },
    };
  }
  const finalization = getFinalizationVersion(root, options);
  const canonical = await getCanonicalFinalizationStatus(root, options);
  if (canonical.currentFinalVersion?.id !== finalization.id) return { ...status, status: "HISTORICAL_ARTIFACTS_MISSING", generationEligibility: "PROHIBITED_HISTORICAL_REGENERATION" };
  try {
    await assertRenderableState(root, options, finalization);
    return { ...status, generationEligibility: "PERMITTED" };
  } catch (error) {
    return { ...status, status: "ARTIFACT_GENERATION_PROHIBITED", generationEligibility: "PROHIBITED_STATE_MISMATCH", finding: { code: errorCode(error), message: error instanceof Error ? error.message : String(error) } };
  }
}

/** Reads bytes only after the whole immutable set and the requested member verify against Phase E authority. */
export function readVerifiedFinalArtifact(root, { kind, ...options } = {}) {
  const normalizedKind = clean(kind).toLowerCase();
  if (!["docx", "pdf"].includes(normalizedKind)) throw new Error("FINAL_ARTIFACT_KIND_INVALID: Artifact kind must be docx or pdf.");
  getFinalizationVersion(root, options);
  const verified = verifyFinalArtifacts(root, options), location = locations(root, options), item = verified.manifest.artifacts[normalizedKind];
  if (!item) throw new Error(`FINAL_ARTIFACT_${normalizedKind.toUpperCase()}_MISSING: The immutable manifest does not identify the requested artifact.`);
  const file = normalizedKind === "docx" ? location.docxFile : location.pdfFile, bytes = fs.readFileSync(file), actual = { bytes: bytes.length, sha256: sha256(bytes) };
  if (actual.bytes !== item.byteCount || actual.sha256 !== item.sha256) throw new Error(`FINAL_ARTIFACT_${normalizedKind.toUpperCase()}_INTEGRITY_FAILURE: Stored ${normalizedKind.toUpperCase()} bytes changed before download.`);
  return { bytes, filename: `Deposition-${options.finalVersionId}.${normalizedKind}`, contentType: normalizedKind === "docx" ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "application/pdf", manifest: verified.manifest };
}

export const _testing = { errorCode, generateOwned, generationLocks, locations, sha256, withGenerationOwnership };
