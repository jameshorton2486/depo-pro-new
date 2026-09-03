import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { depositionDirectory } from "./deposition-store.mjs";
import { getTranscriptPrintModel } from "./transcript-print-model.mjs";

export const EXHIBIT_LIFECYCLE_VERSION = "1.0.0";
export const EXHIBIT_AUDIT_RESULTS = Object.freeze(["NO_EXHIBITS", "EXHIBITS_PRESENT"]);
export const EXHIBIT_STATES = Object.freeze(["ACTIVE", "WITHDRAWN", "SUBSTITUTED"]);
export const EXHIBIT_MATERIAL_KINDS = Object.freeze(["DIGITAL_FILE", "PHYSICAL", "RETAINED_BY_COUNSEL", "NONE"]);
export const EXHIBIT_PACKAGE_DISPOSITIONS = Object.freeze(["INCLUDED", "EXCLUDED", "NOT_APPLICABLE", "UNRESOLVED"]);
export const EXHIBIT_CUSTODY_STATUSES = Object.freeze(["RESOLVED", "UNRESOLVED"]);
export const EXHIBIT_SEALED_HANDLING_STATUSES = Object.freeze(["NOT_APPLICABLE", "RESOLVED", "UNRESOLVED"]);

const clean = (value, limit = 4000) => String(value ?? "").trim().slice(0, limit);
const requireText = (value, message, limit) => { const result = clean(value, limit); if (!result) throw new Error(message); return result; };
const requireTime = (value, message) => { const result = requireText(value, message, 80), date = new Date(result); if (Number.isNaN(date.valueOf())) throw new Error(message); return date.toISOString(); };
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex");

function fileFor(root, depositionId, storageRoot) {
  return path.join(depositionDirectory(root, depositionId, { storageRoot }), "intake", "canonical-deposition-record.json");
}
function atomicJson(file, value) {
  const temporary = `${file}.${crypto.randomUUID()}.tmp`, descriptor = fs.openSync(temporary, "wx");
  try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8"); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
}
function ledger(record) {
  record.exhibitLifecycle ??= {};
  record.exhibitLifecycle.schemaVersion = EXHIBIT_LIFECYCLE_VERSION;
  record.exhibitLifecycle.auditEvents ??= [];
  record.exhibitLifecycle.exhibitEvents ??= [];
  return record.exhibitLifecycle;
}
function currentEffective(events, predicate = () => true) {
  const eligible = Array.isArray(events) ? events.filter(predicate) : [];
  const superseded = new Set(eligible.map(item => item.supersedesEventId).filter(Boolean));
  return [...eligible].reverse().find(item => !superseded.has(item.id)) ?? null;
}
function currentExhibits(events) {
  const identities = [...new Set((events ?? []).map(item => item.exhibitId).filter(Boolean))];
  return identities.map(exhibitId => currentEffective(events, item => item.exhibitId === exhibitId)).filter(Boolean);
}
function loadForWrite(root, depositionId, storageRoot) {
  const file = fileFor(root, depositionId, storageRoot);
  if (!fs.existsSync(file)) throw new Error("The Canonical Deposition Data Record was not found.");
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  return { file, record, exhibits: ledger(record), directory: path.dirname(path.dirname(file)) };
}
function attributed(actor, input) {
  return {
    sourceAnchor: requireText(input?.sourceAnchor, "An evidence source anchor is required.", 500),
    recordedBy: requireText(actor, "Server-established attribution is required.", 300),
    recordedAt: new Date().toISOString(),
  };
}
function evidenceState(root, depositionId, storageRoot) {
  const model = getTranscriptPrintModel(root, { depositionId, storageRoot });
  return { transcriptModelHash: model.modelHash, reviewStateHash: model.source?.reviewStateHash ?? null };
}
function safeStoredFile(directory, relativePath) {
  const relative = requireText(relativePath, "Choose an existing deposition file.", 1000).replaceAll("\\", "/");
  if (path.isAbsolute(relative) || relative.split("/").includes("..")) throw new Error("The exhibit file must be inside this deposition.");
  const file = path.resolve(directory, relative);
  const base = `${path.resolve(directory)}${path.sep}`;
  if (!file.startsWith(base) || !fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error("The exhibit file was not found inside this deposition.");
  const bytes = fs.readFileSync(file);
  const extension = path.extname(file).toLowerCase();
  const mimeType = extension === ".pdf" ? "application/pdf" : extension === ".png" ? "image/png" : [".jpg", ".jpeg"].includes(extension) ? "image/jpeg" : "application/octet-stream";
  const pageCount = extension === ".pdf" ? Math.max(0, (bytes.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length) || null : null;
  return { relativePath: path.relative(directory, file).replaceAll("\\", "/"), sha256: sha256(bytes), bytes: bytes.length, mimeType, pageCount };
}

function uploadedFile(directory, material) {
  const name = path.basename(requireText(material?.fileName, "Choose a PDF, PNG, or JPEG exhibit file.", 255));
  const extension = path.extname(name).toLowerCase();
  if (![".pdf", ".png", ".jpg", ".jpeg"].includes(extension)) throw new Error("Digital exhibit files must be PDF, PNG, or JPEG.");
  const encodedValue = String(material?.fileBase64 ?? "").trim();
  if (encodedValue.length > 35 * 1024 * 1024) throw new Error("Digital exhibit files must not exceed 25 MB.");
  const encoded = requireText(encodedValue, "The selected exhibit file is empty.", 35 * 1024 * 1024);
  let bytes;
  try { bytes = Buffer.from(encoded, "base64"); } catch { throw new Error("The selected exhibit file could not be decoded."); }
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new Error("Digital exhibit files must be between 1 byte and 25 MB.");
  const signatureOk = extension === ".pdf" ? bytes.subarray(0,5).toString() === "%PDF-" : extension === ".png" ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!signatureOk) throw new Error("The selected exhibit file contents do not match its file type.");
  const safeName = name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120), relativePath = `exhibits/source/${crypto.randomUUID()}-${safeName}`;
  const file = path.join(directory, ...relativePath.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive:true }); fs.writeFileSync(file, bytes, { flag:"wx" });
  return { identity:safeStoredFile(directory, relativePath), createdFile:file };
}

export function recordExhibitAudit(root, { depositionId, storageRoot, actor, input } = {}) {
  const result = clean(input?.result, 80);
  if (!EXHIBIT_AUDIT_RESULTS.includes(result)) throw new Error("Choose whether no exhibits were marked or exhibits were present.");
  const state = loadForWrite(root, depositionId, storageRoot), prior = currentEffective(state.exhibits.auditEvents);
  const expectedEventId = clean(input?.expectedEventId, 100) || null;
  if (Object.hasOwn(input ?? {}, "expectedEventId") && (prior?.id ?? null) !== expectedEventId) throw new Error("The exhibit audit changed after this screen loaded. Refresh and review the current record before trying again.");
  if (prior && !clean(input?.correctionReason, 1000)) throw new Error("Explain why the exhibit audit is being corrected or renewed.");
  const event = {
    id: crypto.randomUUID(), kind: "EXHIBIT_AUDIT_COMPLETED", result,
    ...evidenceState(root, depositionId, storageRoot), ...attributed(actor, input),
    correctionReason: clean(input?.correctionReason, 1000) || null,
    supersedesEventId: prior?.id ?? null,
  };
  state.exhibits.auditEvents.push(event); atomicJson(state.file, state.record); return event;
}

export function recordExhibit(root, { depositionId, storageRoot, actor, input } = {}) {
  const state = loadForWrite(root, depositionId, storageRoot);
  const requestedId = clean(input?.exhibitId, 100), prior = requestedId ? currentEffective(state.exhibits.exhibitEvents, item => item.exhibitId === requestedId) : null;
  if (requestedId && !prior) throw new Error("The exhibit being corrected was not found.");
  if (prior && !clean(input?.correctionReason, 1000)) throw new Error("Explain why the exhibit record is being corrected.");
  if (prior && Object.hasOwn(input ?? {}, "expectedEventId") && prior.id !== clean(input?.expectedEventId, 100)) throw new Error("This exhibit changed after this screen loaded. Refresh and review the current record before trying again.");
  const status = clean(input?.status, 80) || "ACTIVE";
  if (!EXHIBIT_STATES.includes(status)) throw new Error("Choose a recognized exhibit state.");
  const materialKind = clean(input?.material?.kind, 80) || "NONE";
  if (!EXHIBIT_MATERIAL_KINDS.includes(materialKind)) throw new Error("Choose a recognized exhibit material kind.");
  const packageDisposition = clean(input?.packageDisposition, 80) || "UNRESOLVED";
  if (!EXHIBIT_PACKAGE_DISPOSITIONS.includes(packageDisposition)) throw new Error("Choose a recognized final-package disposition.");
  const custodyStatus = clean(input?.custody?.status, 80) || "UNRESOLVED";
  if (!EXHIBIT_CUSTODY_STATUSES.includes(custodyStatus)) throw new Error("Choose a recognized custody status.");
  const sealedHandlingStatus = clean(input?.sealedHandling?.status, 80) || "UNRESOLVED";
  if (!EXHIBIT_SEALED_HANDLING_STATUSES.includes(sealedHandlingStatus)) throw new Error("Choose a recognized confidential/sealed handling status.");
  if (packageDisposition === "EXCLUDED" && !clean(input?.packageDispositionReason, 2000)) throw new Error("Explain why the exhibit is excluded from the final package.");
  const transcriptReferences = (Array.isArray(input?.transcriptReferences) ? input.transcriptReferences : []).map(reference => ({
    sourceAnchor: requireText(reference?.sourceAnchor, "Each transcript reference requires a stable source anchor.", 500),
    paragraphId: clean(reference?.paragraphId, 500) || null,
    sourceWordId: clean(reference?.sourceWordId, 500) || null,
    quotedText: clean(reference?.quotedText, 2000) || null,
  }));
  const label = requireText(input?.label, "Record the displayed exhibit number or label.", 200);
  const description = requireText(input?.description, "Record an exhibit description.", 2000);
  const markedAt = requireTime(input?.markedAt, "Record when the exhibit was marked.");
  const markedBy = requireText(input?.markedBy, "Record who marked or identified the exhibit.", 500);
  const attribution = attributed(actor, input);
  let createdFile = null;
  const uploaded = materialKind === "DIGITAL_FILE" && input?.material?.fileBase64 ? uploadedFile(state.directory, input.material) : null;
  if (uploaded) createdFile = uploaded.createdFile;
  const file = materialKind === "DIGITAL_FILE" ? uploaded?.identity ?? safeStoredFile(state.directory, input?.material?.relativePath) : null;
  const exhibitId = prior?.exhibitId ?? crypto.randomUUID();
  const event = {
    id: crypto.randomUUID(), exhibitId, kind: "CANONICAL_EXHIBIT_RECORDED", status,
    label, description, markedAt, markedBy,
    transcriptReferences, material: { kind: materialKind, file },
    custody: { status: custodyStatus, holder: clean(input?.custody?.holder, 500) || null, sourceAnchor: clean(input?.custody?.sourceAnchor, 500) || null },
    sealedHandling: { status: sealedHandlingStatus, instructions: clean(input?.sealedHandling?.instructions, 2000) || null, sourceAnchor: clean(input?.sealedHandling?.sourceAnchor, 500) || null },
    packageDisposition, packageDispositionReason: clean(input?.packageDispositionReason, 2000) || null,
    replacementExhibitId: status === "SUBSTITUTED" ? requireText(input?.replacementExhibitId, "Identify the replacement exhibit.", 100) : null,
    ...attribution, correctionReason: clean(input?.correctionReason, 1000) || null,
    supersedesEventId: prior?.id ?? null,
  };
  try { state.exhibits.exhibitEvents.push(event); atomicJson(state.file, state.record); return event; }
  catch (error) { if (createdFile) fs.rmSync(createdFile, { force:true }); throw error; }
}

export function resolveExhibitLifecycle(record, { transcriptModelHash = null, reviewStateHash = null } = {}) {
  const source = record?.exhibitLifecycle ?? {}, audit = currentEffective(source.auditEvents), exhibits = currentExhibits(source.exhibitEvents);
  const findings = [];
  if (!transcriptModelHash || !reviewStateHash) findings.push({ code: "EXHIBIT_EVIDENCE_STATE_UNAVAILABLE", target: "transcript", message: "The authoritative transcript and review state must be available before exhibit status can be qualified." });
  if (!audit) findings.push({ code: "EXHIBIT_AUDIT_REQUIRED", target: "exhibitLifecycle.auditEvents", message: "A reporter must complete the exhibit audit." });
  else if (audit.transcriptModelHash !== transcriptModelHash || audit.reviewStateHash !== reviewStateHash)
    findings.push({ code: "EXHIBIT_AUDIT_STALE", target: "exhibitLifecycle.auditEvents", message: "The transcript or review state changed after the exhibit audit." });
  const active = exhibits.filter(item => item.status === "ACTIVE");
  if (audit?.result === "NO_EXHIBITS" && active.length) findings.push({ code: "EXHIBIT_AUDIT_CONFLICT", target: "exhibitLifecycle", message: "The audit says no exhibits, but current canonical exhibits exist." });
  if (audit?.result === "EXHIBITS_PRESENT" && !exhibits.length) findings.push({ code: "EXHIBIT_RECORD_REQUIRED", target: "exhibitLifecycle.exhibitEvents", message: "The audit says exhibits were present, but none have been reconciled." });
  const labels = new Map();
  for (const exhibit of exhibits) {
    if (!exhibit.transcriptReferences?.length) findings.push({ code: "EXHIBIT_REFERENCE_UNRESOLVED", exhibitId: exhibit.exhibitId, target: "transcriptReferences", message: `${exhibit.label} has no reconciled transcript evidence.` });
    if (exhibit.material?.kind === "DIGITAL_FILE" && !exhibit.material.file) findings.push({ code: "EXHIBIT_FILE_MISSING", exhibitId: exhibit.exhibitId, target: "material.file", message: `${exhibit.label} has no associated file.` });
    if (exhibit.material?.kind === "DIGITAL_FILE" && !exhibit.material.file?.sha256) findings.push({ code: "EXHIBIT_HASH_MISSING", exhibitId: exhibit.exhibitId, target: "material.file.sha256", message: `${exhibit.label} has no verified file identity.` });
    if (exhibit.custody?.status !== "RESOLVED" || !exhibit.custody?.holder || !exhibit.custody?.sourceAnchor) findings.push({ code: "EXHIBIT_CUSTODY_UNRESOLVED", exhibitId: exhibit.exhibitId, target: "custody", message: `${exhibit.label} custody is not fully attributable.` });
    if (!["NOT_APPLICABLE", "RESOLVED"].includes(exhibit.sealedHandling?.status) || (exhibit.sealedHandling.status === "RESOLVED" && !exhibit.sealedHandling.sourceAnchor)) findings.push({ code: "EXHIBIT_SEALED_HANDLING_UNRESOLVED", exhibitId: exhibit.exhibitId, target: "sealedHandling", message: `${exhibit.label} confidential/sealed handling is unresolved.` });
    if (exhibit.packageDisposition === "UNRESOLVED") findings.push({ code: "EXHIBIT_PACKAGE_DISPOSITION_UNRESOLVED", exhibitId: exhibit.exhibitId, target: "packageDisposition", message: `${exhibit.label} final-package disposition is unresolved.` });
    if (exhibit.status === "SUBSTITUTED" && !exhibits.some(item => item.exhibitId === exhibit.replacementExhibitId)) findings.push({ code: "EXHIBIT_SUBSTITUTION_UNRESOLVED", exhibitId: exhibit.exhibitId, target: "replacementExhibitId", message: `${exhibit.label} references a replacement that is not canonical.` });
  }
  for (const exhibit of active) { const key = exhibit.label.toLocaleLowerCase(); labels.set(key, [...(labels.get(key) ?? []), exhibit.exhibitId]); }
  for (const [label, ids] of labels) if (ids.length > 1) findings.push({ code: "EXHIBIT_NUMBER_CONFLICT", target: "label", message: `More than one current active exhibit uses label ${label}.`, exhibitIds: ids });
  const status = !audit || findings.some(item => ["EXHIBIT_AUDIT_STALE", "EXHIBIT_EVIDENCE_STATE_UNAVAILABLE"].includes(item.code)) ? "UNKNOWN" : findings.length ? "EXHIBITS_PRESENT_INCOMPLETE" : audit.result === "NO_EXHIBITS" ? "NO_EXHIBITS" : "EXHIBITS_PRESENT_COMPLETE";
  const history = { auditEvents: structuredClone(source.auditEvents ?? []), exhibitEvents: structuredClone(source.exhibitEvents ?? []) };
  return { schemaVersion: EXHIBIT_LIFECYCLE_VERSION, lifecycleDigest: sha256(JSON.stringify(history)), status, ready: findings.length === 0 && Boolean(audit), audit: audit ? structuredClone(audit) : null, exhibits: structuredClone(exhibits), findings, history };
}

export function getExhibitReadiness(root, { depositionId, storageRoot } = {}) {
  const file = fileFor(root, depositionId, storageRoot), record = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  if (!record) return { schemaVersion: EXHIBIT_LIFECYCLE_VERSION, status: "UNKNOWN", ready: false, audit: null, exhibits: [], findings: [{ code: "EXHIBIT_CANONICAL_RECORD_REQUIRED", target: "canonicalRecord", message: "The canonical deposition record is missing." }], history: { auditEvents: [], exhibitEvents: [] }, source: { transcriptModelHash: null, reviewStateHash: null } };
  let evidence;
  try { evidence = evidenceState(root, depositionId, storageRoot); }
  catch { evidence = { transcriptModelHash: null, reviewStateHash: null }; }
  const resolved = resolveExhibitLifecycle(record, evidence), findings = [...resolved.findings], directory = path.dirname(path.dirname(file));
  for (const exhibit of resolved.exhibits.filter(item => item.material?.kind === "DIGITAL_FILE" && item.material?.file)) {
    const stored = exhibit.material.file, candidate = path.resolve(directory, stored.relativePath);
    if (!candidate.startsWith(`${path.resolve(directory)}${path.sep}`) || !fs.existsSync(candidate) || !fs.statSync(candidate).isFile())
      findings.push({ code: "EXHIBIT_FILE_MISSING", exhibitId: exhibit.exhibitId, target: "material.file", message: `${exhibit.label} associated file is no longer present.` });
    else if (sha256(fs.readFileSync(candidate)) !== stored.sha256)
      findings.push({ code: "EXHIBIT_FILE_HASH_MISMATCH", exhibitId: exhibit.exhibitId, target: "material.file.sha256", message: `${exhibit.label} associated file no longer matches its recorded identity.` });
  }
  return { ...resolved, status: findings.length ? (resolved.audit ? "EXHIBITS_PRESENT_INCOMPLETE" : "UNKNOWN") : resolved.status, ready: findings.length === 0 && resolved.ready, findings, source: evidence };
}

export const _testing = { currentEffective, currentExhibits, safeStoredFile, uploadedFile };
