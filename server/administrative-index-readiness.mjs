import crypto from "node:crypto";
import { resolveExhibitLifecycle } from "./canonical-exhibit-lifecycle.mjs";

export const ADMINISTRATIVE_INDEX_READINESS_VERSION = "1.0.0";
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

function referencedTestimonyPage(printModel, reference) {
  const paragraphId = reference?.paragraphId ?? (String(reference?.sourceAnchor ?? "").startsWith("paragraph:") ? String(reference.sourceAnchor).slice(10) : null);
  const sourceWordId = reference?.sourceWordId ?? (String(reference?.sourceAnchor ?? "").startsWith("word:") ? String(reference.sourceAnchor).slice(5) : null);
  const page = printModel.pages.find(candidate => candidate.lines.some(line =>
    (paragraphId && line.paragraphId === paragraphId) ||
    (sourceWordId && (line.fragments ?? []).some(fragment => fragment.sourceWordId === sourceWordId))));
  return page?.pageNumber ?? null;
}

export function deriveExhibitIndexEntries(record, printModel, frontPageCount) {
  const lifecycle = resolveExhibitLifecycle(record, { transcriptModelHash: printModel.modelHash, reviewStateHash: printModel.source?.reviewStateHash ?? null });
  const entries = [];
  for (const exhibit of lifecycle.exhibits.filter(item => item.status !== "WITHDRAWN")) {
    const testimonyPage = (exhibit.transcriptReferences ?? []).map(reference => referencedTestimonyPage(printModel, reference)).find(Boolean) ?? null;
    if (!testimonyPage) { const error = new Error(`EXHIBIT_INDEX_REFERENCE_UNRESOLVED:${exhibit.exhibitId}: ${exhibit.label} has no stable transcript reference that resolves in the final pagination.`); error.code = "EXHIBIT_INDEX_REFERENCE_UNRESOLVED"; throw error; }
    entries.push({ exhibitId: exhibit.exhibitId, eventId: exhibit.id, number: exhibit.label, description: exhibit.description, testimonyPage, page: frontPageCount + testimonyPage });
  }
  return entries;
}

export function validateAdministrativeIndexReadiness(model, exhibitReadiness) {
  const findings = [], pages = model?.pages ?? [], roles = pages.map(page => page.role), federal = String(model?.variant ?? "").startsWith("FEDERAL_");
  const required = federal ? ["certification"] : ["title", "appearances", "index", "certification1"];
  if (!federal && model.signatureDisposition === "requested") required.push("changes", "signature", "certification2", "certification3");
  for (const role of required) if (!roles.includes(role)) findings.push({ code: "ADMINISTRATIVE_PAGE_REQUIRED", target: role, message: `The ${role} administrative page is required by the selected qualified profile.` });
  if (pages.some((page, index) => page.pageNumber !== index + 1)) findings.push({ code: "ADMINISTRATIVE_PAGE_SEQUENCE_INVALID", target: "pages", message: "Administrative and testimony pages are not in one final sequential pagination." });
  if (pages.some(page => page.lines.length !== model.layoutProfile?.linesPerPage)) findings.push({ code: "ADMINISTRATIVE_PAGE_GEOMETRY_INVALID", target: "pages", message: "A page does not use the qualified physical line count." });
  const index = model?.pagination?.index ?? {}, max = pages.length;
  for (const [target, page] of [["appearances", index.appearances?.startPage], ["reportersCertification", index.reportersCertification?.startPage]])
    if (!federal && (!Number.isInteger(page) || page < 1 || page > max)) findings.push({ code: "INDEX_PAGE_REFERENCE_INVALID", target, message: `The ${target} index reference is outside final pagination.` });
  for (const exam of index.examinations ?? []) if (![exam.startPage, exam.endPage].every(page => Number.isInteger(page) && page >= 1 && page <= max) || exam.endPage < exam.startPage) findings.push({ code: "EXAMINATION_INDEX_RANGE_INVALID", target: exam.examiner, message: `The examination range for ${exam.examiner} is not derived from valid final pages.` });
  const expected = new Map((exhibitReadiness?.exhibits ?? []).filter(item => item.status !== "WITHDRAWN").map(item => [item.exhibitId, item]));
  const indexed = new Map((index.exhibits ?? []).map(item => [item.exhibitId, item]));
  for (const [id, exhibit] of expected) if (!indexed.has(id)) findings.push({ code: "EXHIBIT_INDEX_ENTRY_REQUIRED", target: id, message: `${exhibit.label} is not represented in the final exhibit index.` });
  for (const [id, entry] of indexed) if (!expected.has(id) || !Number.isInteger(entry.page) || entry.page < 1 || entry.page > max) findings.push({ code: "EXHIBIT_INDEX_ENTRY_INVALID", target: id, message: "An exhibit index entry does not match a current-effective exhibit and final page." });
  const projection = { modelHash: model?.modelHash ?? null, roles, pagination: model?.pagination ?? null, administrativePages: pages.filter(page => page.sectionKind === "administrative").map(page => ({ pageNumber: page.pageNumber, role: page.role, lines: page.lines.map(line => line.content) })), exhibitLifecycleDigest: exhibitReadiness?.lifecycleDigest ?? null };
  return { schemaVersion: ADMINISTRATIVE_INDEX_READINESS_VERSION, ready: findings.length === 0, projectionDigest: digest(projection), findings, projection };
}

export const _testing = { referencedTestimonyPage };
