import { isLayoutProfileVerified } from "./layout-profile.mjs";
import { pageOverflowFindings } from "./page-model.mjs";
import { captionJurisdiction } from "./variants.mjs";

export const INTENTIONAL_BLANKS = Object.freeze({
  TEXAS_STATE_SIGNATURE_REQUESTED: Object.freeze([
    "cert.submissionDate", "cert.returnDeadline", "cert.returnStatus", "cert.custodialAttorney",
    "cert.charges", "cert.serviceDate", "cert.certificationDate",
  ]),
  TEXAS_STATE_SIGNATURE_WAIVED: Object.freeze(["cert.serviceDate", "cert.certificationDate"]),
  FEDERAL_SIGNATURE_REQUESTED: Object.freeze([]),
  FEDERAL_SIGNATURE_WAIVED: Object.freeze([]),
});

const blocking = (code, target, message, extra = {}) => ({ code, target, severity: "blocking", message, ...extra });
const warning = (code, target, message, extra = {}) => ({ code, target, severity: "warning", message, ...extra });
const normalizedName = (name) => String(name ?? "").toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
const isBlank = (value) => value == null || value === "" || (Array.isArray(value) && value.length === 0);

function validateVariant(input, findings) {
  if (!input.jurisdiction || !input.signatureDisposition || !input.variant || !input.signatureDispositionBasis) {
    findings.push(blocking("CERT_VARIANT_UNSPECIFIED", "cert.variant", "Jurisdiction, signature disposition, and its source basis must all be explicitly provided."));
    return;
  }
  const detected = captionJurisdiction(input.caption?.court);
  // A caption naming a state Depo-Pro has no reviewed certificate for must block regardless
  // of what the operator selected. The mismatch check below cannot cover this on its own: it
  // fires only when detection disagrees, so an operator selecting texas-state for a Nebraska
  // caption would have produced no finding at all once detection stopped calling it Texas.
  if (detected === "unsupported") {
    findings.push(blocking("CERT_JURISDICTION_UNSUPPORTED", "cert.jurisdiction", `Caption court '${input.caption?.court}' names a jurisdiction Depo-Pro has no reviewed certificate for. Texas state and federal are the only supported variants.`, { path: "jurisdiction" }));
  } else if (detected && detected !== input.jurisdiction) {
    findings.push(blocking("CERT_JURISDICTION_MISMATCH", "cert.jurisdiction", `Caption court '${input.caption.court}' indicates ${detected}, but the operator selected ${input.jurisdiction}.`, { path: "jurisdiction" }));
  }
  if (!input.template?.available) {
    findings.push(blocking("CERT_TEMPLATE_UNAVAILABLE", `template.${input.variant}`, `No reviewed template is available for ${input.variant}; expected ${input.template?.expectedPath ?? "its variant template directory"}.`, { path: "template" }));
  }
}

function validateCredentials(input, findings) {
  const reporter = input.reporter ?? {};
  const waived = reporter.firmRegistration?.applicable === false && Boolean(reporter.firmRegistration.reason);
  if (!reporter.firmRegistrationNumber && !waived) findings.push(blocking("CERT_FIRM_REGISTRATION_UNRESOLVED", "reporter.firmRegistrationNumber", "Reporter profile has no firm registration number and no explicit inapplicable reason.", { path: "reporter.firmRegistrationNumber" }));
  const certificationDate = input.operator?.certification?.certificationDate;
  const comparisonDate = certificationDate ?? input.deposition?.date;
  if (reporter.csrExpirationDate && comparisonDate && new Date(reporter.csrExpirationDate) < new Date(comparisonDate)) {
    findings.push(warning("CSR_EXPIRATION_BEFORE_CERTIFICATION", "reporter.csrExpirationDate", `CSR expiration ${reporter.csrExpirationDate} precedes ${comparisonDate}.`));
  }
}

function validateCounsel(input, findings) {
  const missingMethods = input.appearances.filter((attorney) => !attorney.participation?.method).map((attorney) => attorney.name);
  if (missingMethods.length) findings.push(blocking("APPEARANCE_METHOD_MISSING", "appearances.participation.method", `Participation method is missing for: ${missingMethods.join(", ")}.`, { details: { names: missingMethods } }));
  const appearing = new Set(input.appearances.map((attorney) => normalizedName(attorney.name)));
  const missing = input.counselReconciliation.expectedNames.filter((name) => !appearing.has(normalizedName(name)));
  if (missing.length && !input.counselReconciliation.appearingCounselPhrasingDecision?.reason) {
    findings.push(blocking("CERT_COUNSEL_INCOMPLETE", "cert.counselOfRecord", `The all-parties recital is unsupported; missing counsel: ${missing.join(", ")}.`, { details: { missingNames: missing } }));
  }
}

function validateIndex(input, findings) {
  const index = input.index ?? {};
  for (const [position, entry] of (index.entries ?? []).entries()) {
    if (!entry.section || !Number.isInteger(entry.page)) {
      const target = entry.section ? `index.section.${entry.section}` : `index.page.${entry.page ?? "missing"}`;
      findings.push(blocking("INDEX_UNRESOLVED_ENTRY", target, `Index entry ${position + 1} must have both a section and page.`, { path: `index.entries.${position}` }));
    }
  }
  const actual = index.actualSectionPages ?? {};
  for (const [section, page] of Object.entries(index.declaredSectionPages ?? {})) {
    if (Number.isInteger(page) && Number.isInteger(actual[section]) && page !== actual[section]) {
      findings.push(blocking("INDEX_PAGE_MISMATCH", `index.section.${section}`, `Index lists ${section} at page ${page}, but the assembled position is ${actual[section]}.`, { path: `index.declaredSectionPages.${section}`, details: { declaredPage: page, actualPage: actual[section], attributionRule: index.attributionRules?.[section] ?? null } }));
    }
  }
}

function validateFields(input, findings) {
  // Validate the canonical pre-render inventory here. Page-specific composition fields
  // are produced by build-pages and are checked after substitution for surviving carets.
  const fields = new Set(input.template?.templates?.fieldInventory?.fields ?? []);
  const allowed = new Set(INTENTIONAL_BLANKS[input.variant] ?? []);
  const coveredBySpecificGate = new Set();
  if (findings.some(({ code }) => code === "CERT_FIRM_REGISTRATION_UNRESOLVED")) coveredBySpecificGate.add("reporter.firmRegistrationNumber");
  for (const field of fields) if (isBlank(input.fieldValues?.[field]) && !allowed.has(field)) {
    if (coveredBySpecificGate.has(field)) continue;
    findings.push(blocking("UNEXPECTED_BLANK", field, `Template field ${field} is blank and is not intentional for ${input.variant}.`, { path: `fieldValues.${field}` }));
  }
}

function validateWarnings(input, findings) {
  if (!isLayoutProfileVerified(input.layoutProfile)) findings.push(warning("LAYOUT_PROFILE_UNVERIFIED", "layoutProfile", `Layout profile ${input.layoutProfile.id} has not been reporter-verified.`));
  if (!input.locations?.witness?.physicalAddress) findings.push(warning("WITNESS_LOCATION_UNSTATED", "locations.witness.physicalAddress", "Witness physical location is not stated."));
  const flags = input.presentation ?? {};
  if (flags.multipleDefendantsSingularLabel) findings.push(warning("CAPTION_PLURALIZATION", "caption.partyLabel", "Multiple defendants are rendered with the singular label 'Defendant'."));
  if (flags.causeNumberMissingSpace) findings.push(warning("CAPTION_PUNCTUATION", "caption.causeNumber", "Caption cause-number label is missing a space after 'NO.:'."));
  if (flags.addressMissingComma) findings.push(warning("ADDRESS_PUNCTUATION", "appearances.address", "Address is missing city/state punctuation."));
  if (flags.videographerNoneBlock) findings.push(warning("ALSO_PRESENT_AWKWARD", "participants.videographer", "Use 'ALSO PRESENT: None' or omit the block instead of 'THE VIDEOGRAPHER: NONE'."));
  if (flags.locationPlatformConflated) findings.push(warning("LOCATION_PLATFORM_CONFLATED", "locations.proceeding", "The proceeding platform is conflated with a participant's physical location."));
  const time = input.timeUsed;
  if (time && Number.isFinite(time.totalOnRecordMinutes)) {
    const sum = (time.parties ?? []).reduce((total, party) => total + (party.minutes ?? 0), 0);
    if (Math.abs(sum - time.totalOnRecordMinutes) > (time.toleranceMinutes ?? 1)) findings.push(warning("TIME_USED_UNRECONCILED", "timeUsed", `Attributed time (${sum} minutes) differs from on-record time (${time.totalOnRecordMinutes} minutes).`));
  }
}

export function validateInsertionInput(input) {
  const findings = [];
  validateVariant(input, findings);
  validateCredentials(input, findings);
  validateCounsel(input, findings);
  validateIndex(input, findings);
  if ((input.deposition?.volumeCount ?? 1) > 1) findings.push(blocking("MULTI_VOLUME_UNSUPPORTED", "deposition.volumeCount", `This renderer supports one volume; received ${input.deposition.volumeCount}.`));
  findings.push(...pageOverflowFindings(input.pages ?? [], input.layoutProfile));
  validateFields(input, findings);
  validateWarnings(input, findings);
  return findings;
}

export function hasBlockingFindings(findings) {
  return findings.some((finding) => finding.severity === "blocking");
}
