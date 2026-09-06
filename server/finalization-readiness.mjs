import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { assemblyReadiness } from "./complete-transcript-assembly.mjs";
import { getCompleteTranscriptModel } from "./complete-transcript-model.mjs";
import { depositionDirectory } from "./deposition-store.mjs";
import { getTranscriptPrintModel } from "./transcript-print-model.mjs";
import { getExhibitReadiness } from "./canonical-exhibit-lifecycle.mjs";
import { validateAdministrativeIndexReadiness } from "./administrative-index-readiness.mjs";

export const FINALIZATION_READINESS_VERSION = "1.1.0";
export const READINESS_SEVERITY = Object.freeze({
  HARD_BLOCKER: "HARD_BLOCKER",
  WARNING: "WARNING",
  INFORMATIONAL: "INFORMATIONAL",
});

const CATEGORY_NAMES = Object.freeze([
  "transcript",
  "administration",
  "review",
  "certification",
  "administrativePages",
  "exhibits",
  "output",
]);

const canonical = value => Array.isArray(value)
  ? value.map(canonical)
  : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
    : value;
const digest = value => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const codeOf = error => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.match(/^([A-Z][A-Z0-9_]+)/)?.[1] ?? "FINALIZATION_READINESS_EVALUATION_FAILED";
};

function finding({ code, severity, sourceSubsystem, remediation, message, target = null, details = null }) {
  return { code, severity, sourceSubsystem, remediation, message, target, details };
}

function category(findings = [], evaluated = true) {
  const hard = findings.some(item => item.severity === READINESS_SEVERITY.HARD_BLOCKER);
  const warning = findings.some(item => item.severity === READINESS_SEVERITY.WARNING);
  return {
    status: !evaluated ? "NOT_EVALUATED" : hard ? "BLOCKED" : warning ? "READY_WITH_WARNINGS" : "READY",
    findings,
  };
}

function profileOf(record, assembly) {
  const value = assembly?.assembly?.operator?.jurisdiction ?? record?.case?.jurisdictionType?.value;
  return value === "federal" ? "FEDERAL_DEPOSITION" : value === "texas-state" || value === "Texas" ? "TEXAS_FREELANCE_DEPOSITION" : "UNRESOLVED_DEPOSITION_PROFILE";
}

function modelFailureCategory(code) {
  if (/RULE_30E|SIGNATURE|REVIEW/.test(code)) return ["review", "CERTIFICATION_PAGES"];
  if (/OATH|AFFIRMATION|INTERPRETER|ADMINISTRATION|CLOSING/.test(code)) return ["administration", "OPENING"];
  if (/TEMPLATE|CERTIF|INSERTION/.test(code)) return ["certification", "CERTIFICATION_PAGES"];
  if (/ASSEMBLY|VARIANT|EXAMINER/.test(code)) return ["certification", "CERTIFICATION_PAGES"];
  return ["transcript", "WORKSPACE"];
}

function modelFailureCodes(error) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!message.startsWith("COMPLETE_TRANSCRIPT_VALIDATION_BLOCKED:")) return [codeOf(error)];
  return [...new Set(message.slice(message.indexOf(":") + 1).split(",").map(item => item.split(":", 1)[0].trim()).filter(Boolean))];
}

function existingFinding(item, sourceSubsystem, remediation) {
  return finding({
    code: item.code ?? "AUTHORITATIVE_VALIDATOR_FINDING",
    severity: item.severity === "blocking" ? READINESS_SEVERITY.HARD_BLOCKER : READINESS_SEVERITY.WARNING,
    sourceSubsystem,
    remediation,
    message: item.message ?? String(item.code ?? "The authoritative validator reported a finding."),
    target: item.target ?? item.field ?? null,
    details: item.details ?? null,
  });
}

/**
 * Pure aggregation boundary. It owns no deposition rules: readiness is exactly the absence of
 * HARD_BLOCKER findings returned or characterized from the authoritative subsystems.
 */
export function projectFinalizationReadiness({ profile, evaluatedAt, source, categories }) {
  const normalized = Object.fromEntries(CATEGORY_NAMES.map(name => [name, categories[name] ?? category([], false)]));
  const blockers = Object.entries(normalized).flatMap(([name, item]) =>
    item.findings.filter(entry => entry.severity === READINESS_SEVERITY.HARD_BLOCKER).map(entry => ({ category: name, ...entry })));
  const unsigned = {
    schemaVersion: FINALIZATION_READINESS_VERSION,
    recordType: "FINAL_TRANSCRIPT_READINESS_REPORT",
    profile,
    ready: blockers.length === 0,
    source,
    categories: normalized,
    blockers,
  };
  return { ...unsigned, evaluatedAt, evaluationDigest: digest(unsigned) };
}

/** Read-only orchestration over existing authorities. This function creates no artifacts or events. */
export async function getFinalizationReadiness(root, { depositionId, storageRoot, evaluatedAt = new Date().toISOString() } = {}) {
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const canonicalFile = path.join(directory, "intake", "canonical-deposition-record.json");
  const record = fs.existsSync(canonicalFile) ? JSON.parse(fs.readFileSync(canonicalFile, "utf8")) : null;
  const assembly = assemblyReadiness(root, { depositionId, storageRoot });
  const categories = Object.fromEntries(CATEGORY_NAMES.map(name => [name, category([])]));
  categories.administrativePages = category([finding({ code:"ADMINISTRATIVE_MODEL_NOT_EVALUATED", severity:READINESS_SEVERITY.INFORMATIONAL, sourceSubsystem:"ADMINISTRATIVE_INDEX_READINESS", remediation:"PRINT_PREVIEW", message:"Administrative pages and indexes have not yet been evaluated." })], false);
  const source = {
    depositionId,
    canonicalRecordSchemaVersion: record?.schemaVersion ?? null,
    canonicalRecordDigest: record ? digest(record) : null,
    assemblyRevision: assembly.revision,
    transcriptModelHash: null,
    reviewStateHash: null,
    completeDocumentModelHash: null,
    insertionPageSetHash: null,
  };

  categories.certification = category((assembly.blocking ?? []).map(item =>
    finding({ code: item.code, severity: READINESS_SEVERITY.HARD_BLOCKER, sourceSubsystem: "COMPLETE_TRANSCRIPT_ASSEMBLY", remediation: "CERTIFICATION_PAGES", message: item.message, target: item.field ?? null })));
  if (!record) categories.administration = category([finding({ code: "FINALIZATION_CANONICAL_RECORD_REQUIRED", severity: READINESS_SEVERITY.HARD_BLOCKER, sourceSubsystem: "CANONICAL_DEPOSITION_RECORD", remediation: "OPENING", message: "The canonical deposition record is missing, so administrative evidence cannot be evaluated." })]);

  let printModel = null;
  try {
    printModel = getTranscriptPrintModel(root, { depositionId, storageRoot });
    source.transcriptModelHash = printModel.modelHash;
    source.reviewStateHash = printModel.source?.reviewStateHash ?? null;
    categories.transcript = category([
      ...(printModel.findings?.transcript ?? []).map(item => existingFinding(item, "TRANSCRIPT_RENDERER", "WORKSPACE")),
      ...(printModel.findings?.print ?? []).map(item => existingFinding(item, "TRANSCRIPT_PRINT_MODEL", "PRINT_PREVIEW")),
    ]);
  } catch (error) {
    categories.transcript = category([finding({ code: codeOf(error), severity: READINESS_SEVERITY.HARD_BLOCKER, sourceSubsystem: "TRANSCRIPT_PRINT_MODEL", remediation: "WORKSPACE", message: error instanceof Error ? error.message : String(error) })]);
  }

  if (assembly.ready && printModel) {
    try {
      const model = await getCompleteTranscriptModel(root, { depositionId, storageRoot });
      source.completeDocumentModelHash = model.modelHash;
      source.insertionPageSetHash = model.source?.insertionPageSetHash ?? null;
      const exhibitReadiness = getExhibitReadiness(root, { depositionId, storageRoot });
      const administrative = validateAdministrativeIndexReadiness(model, exhibitReadiness);
      source.administrativeProjectionDigest = administrative.projectionDigest;
      categories.administrativePages = category(administrative.findings.map(item => finding({ code:item.code, severity:READINESS_SEVERITY.HARD_BLOCKER, sourceSubsystem:"ADMINISTRATIVE_INDEX_READINESS", remediation:"PRINT_PREVIEW", message:item.message, target:item.target })));
      categories.administration = category([]);
      categories.review = category([]);
      categories.certification = category((model.findings?.assembly ?? []).map(item => existingFinding(item, "CERTIFICATION_VALIDATOR", "CERTIFICATION_PAGES")));
    } catch (error) {
      for (const code of modelFailureCodes(error)) {
        const [name, remediation] = code.includes("INDEX") || code.includes("ADMINISTRATIVE") ? ["administrativePages", "PRINT_PREVIEW"] : modelFailureCategory(code);
        const prior = categories[name]?.findings ?? [];
        categories[name] = category([...prior, finding({ code, severity: READINESS_SEVERITY.HARD_BLOCKER, sourceSubsystem: code === "COMPLETE_TRANSCRIPT_VALIDATION_BLOCKED" ? "CERTIFICATION_VALIDATOR" : "COMPLETE_TRANSCRIPT_MODEL", remediation, message: error instanceof Error ? error.message : String(error) })]);
      }
    }
  } else {
    for (const name of ["administration", "review"])
      if (!categories[name].findings.some(item => item.severity === READINESS_SEVERITY.HARD_BLOCKER))
        categories[name] = category([finding({ code: "COMPLETE_DOCUMENT_PREREQUISITES_UNAVAILABLE", severity: READINESS_SEVERITY.INFORMATIONAL, sourceSubsystem: "COMPLETE_TRANSCRIPT_MODEL", remediation: "CERTIFICATION_PAGES", message: "This category cannot be evaluated until transcript and assembly prerequisites are available." })], false);
  }

  const exhibitReadiness = getExhibitReadiness(root, { depositionId, storageRoot });
  categories.exhibits = category(exhibitReadiness.findings.map(item => finding({
    code: item.code, severity: READINESS_SEVERITY.HARD_BLOCKER,
    sourceSubsystem: "CANONICAL_EXHIBIT_LIFECYCLE", remediation: "EXHIBITS",
    message: item.message, target: item.target ?? null,
    details: item.exhibitId ? { exhibitId: item.exhibitId } : item.exhibitIds ? { exhibitIds: item.exhibitIds } : null,
  })));
  source.exhibitLifecycleVersion = exhibitReadiness.schemaVersion;
  source.exhibitLifecycleDigest = exhibitReadiness.lifecycleDigest ?? null;
  source.exhibitAuditId = exhibitReadiness.audit?.id ?? null;
  source.exhibitState = exhibitReadiness.status;
  categories.output = category([finding({ code: "FINAL_ARTIFACTS_NOT_EVALUATED", severity: READINESS_SEVERITY.INFORMATIONAL, sourceSubsystem: "FINAL_ARTIFACT_RENDERERS", remediation: "FINALIZATION", message: "Phase A is read-only and does not generate or qualify final artifacts." })], false);

  return projectFinalizationReadiness({ profile: profileOf(record, assembly), evaluatedAt, source, categories });
}

export const _testing = { category, digest, modelFailureCategory, modelFailureCodes, profileOf };
