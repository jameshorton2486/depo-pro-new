import { isLayoutProfileVerified } from "./layout-profile.mjs";
import { pageOverflowFindings } from "./page-model.mjs";
import { captionJurisdiction } from "./variants.mjs";

// What is left is exactly the set with no producer: submittedToWitnessDate, dueDate and serviceDate
// are declared WORKFLOW_DERIVED in the canonical record, and no workflow writes them. They are
// blank because nothing can answer them yet, which is a different fact from blank because nobody
// has been asked.
//
// The six a reporter can answer came off this list when the certificate form began collecting
// them. Leaving them here would have meant a reporter who skips the form still gets a certificate
// with a dropped clause and a clean bill of health -- the defect this list is next to, not a use
// for it. An entry added merely to make validation pass is how the guard stops meaning anything.
export const INTENTIONAL_BLANKS = Object.freeze({
  TEXAS_STATE_SIGNATURE_REQUESTED: Object.freeze([
    "cert.submissionDate", "cert.returnDeadline", "cert.serviceDate",
  ]),
  TEXAS_STATE_SIGNATURE_WAIVED: Object.freeze(["cert.serviceDate"]),
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
  // Two different facts, and a reader has to be able to tell them apart. UNAVAILABLE means no
  // reviewed template exists for this variant at all -- the federal stubs, where the answer is to
  // supply the source. UNAPPROVED means a reviewed template exists, its bytes match its manifest
  // hashes, and the content it now has is not the content anyone approved -- where the answer is
  // to look at the edit and re-approve it. Reporting the second as the first would send whoever
  // reads it looking for a missing file that is sitting right there.
  const approval = input.template?.approval;
  if (approval && approval.state !== "current") {
    findings.push(blocking("CERT_TEMPLATE_UNAPPROVED", `template.${input.variant}`, approval.state === "stale"
      ? `The ${input.variant} templates were edited after their last approval (approved content ${String(approval.approvedDigest).slice(0, 12)}, current content ${approval.contentDigest.slice(0, 12)}). Review the edit, then record approval with: node scripts/approve-insertion-template.mjs ${input.variant} --by "<name>".`
      : `No approval is recorded for ${input.variant} in templates/insertion-pages/approvals.json, so its reviewed templates cannot generate certified pages.`,
    { path: "template" }));
  } else if (!input.template?.available) {
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

// How the deposition was conducted is a fact about the deposition, not about each attorney --
// ADR-0020, grounded in three certified specimens that state it once in the page-1 preamble and
// list every attorney plainly. This replaced a per-attorney APPEARANCE_METHOD_MISSING that
// blocked counsel who had appeared, on a field the certified record does not render.
//
// Blocking, and deliberately so. The preamble cannot be written without knowing whether testimony
// was taken in person or by remote platform, and a certificate that guesses is worse than one
// that is refused. It fails where the fact is missing rather than where it is finally needed.
function validateDepositionMethod(input, findings) {
  const remote = input.deposition?.remote;
  const platform = input.deposition?.proceedingLocation?.platform;
  const physical = input.deposition?.proceedingLocation?.physicalAddress;
  if (remote === null || remote === undefined) {
    findings.push(blocking("DEPOSITION_METHOD_MISSING", "deposition.remote",
      "The record does not say whether this deposition was taken in person or remotely, and the page-1 preamble states that for every participant."));
    return;
  }
  if (remote === true && !platform) {
    findings.push(blocking("DEPOSITION_METHOD_MISSING", "deposition.remotePlatform",
      "The deposition is recorded as remote, but no platform is named. The preamble reads \"via <platform>\"."));
  }
  if (remote === false && !physical) {
    findings.push(blocking("DEPOSITION_METHOD_MISSING", "deposition.location",
      "The deposition is recorded as in person, but no location is recorded. The preamble names where testimony was taken."));
  }
}

function validateCounsel(input, findings) {
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

// A field has three states here, not two: it has a value, it is unanswered, or it is waived --
// absent on purpose, with a recorded reason saying why. Only the middle one is a defect.
//
// The distinction already existed at the credentials layer, where validateCredentials reads
// reporter.firmRegistration and accepts a waiver as satisfying the certificate requirement. It
// did not exist here, where isBlank collapsed waived back into unanswered, so recording a waiver
// merely exchanged CERT_FIRM_REGISTRATION_UNRESOLVED for UNEXPECTED_BLANK. Answering the
// requirement left the reporter exactly as blocked as ignoring it.
//
// A Texas CSR certifying under an individual licence has no firm, and the waiver answers the
// registration number the certificate asks for: certification-2 and certification-3 print
// "Firm Registration No. ^reporter.firmRegistrationNumber^". It answers nothing else -- an
// unwaived blank is still a blank.
//
// It used to waive reporter.firmName as well. No reviewed template prints a firm name, so that
// entry cleared a guard on a field that reached no page; the inventory no longer names it and the
// waiver no longer needs to. If a reviewed template ever prints the firm name, the inventory entry
// and this waiver come back together -- the reason a solo CSR has no registration number is the
// same reason they have no firm to name.
function waivedFields(input) {
  const waived = new Set();
  const firmRegistration = input.reporter?.firmRegistration;
  if (firmRegistration?.applicable === false && String(firmRegistration.reason ?? "").trim()) {
    waived.add("reporter.firmRegistrationNumber");
  }
  return waived;
}

function validateFields(input, findings) {
  // Validate the canonical pre-render inventory here. There is no second pass: a caret cannot
  // survive substitution to be caught later, because renderTemplatePage omits any line whose
  // fields are all absent before it substitutes anything. A field that reaches a page but is
  // named in no inventory is therefore checked nowhere, and its line disappears silently --
  // which is how the waived certificate came to print "That the original deposition was
  // delivered to" with no object and no finding. This set is the only guard there is.
  const fields = new Set(input.template?.templates?.fieldInventory?.fields ?? []);
  const allowed = new Set(INTENTIONAL_BLANKS[input.variant] ?? []);
  const waived = waivedFields(input);
  // Distinct from a waiver: this suppresses a second finding about a field the specific gate has
  // already reported, and applies only when that gate fired -- which is precisely when no waiver
  // was recorded.
  const coveredBySpecificGate = new Set();
  if (findings.some(({ code }) => code === "CERT_FIRM_REGISTRATION_UNRESOLVED")) coveredBySpecificGate.add("reporter.firmRegistrationNumber");
  for (const field of fields) if (isBlank(input.fieldValues?.[field]) && !allowed.has(field) && !waived.has(field)) {
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
  validateDepositionMethod(input, findings);
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
