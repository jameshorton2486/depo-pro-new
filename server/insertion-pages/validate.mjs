import { appearancePhrase } from "./assemble.mjs";
import { captionOverflowFindings } from "./build-pages.mjs";
import { isLayoutProfileVerified } from "./layout-profile.mjs";
import { pageOverflowFindings } from "./page-model.mjs";
import { STAGE_ONE_DEFERRED_RULE_WIDTHS, captionJurisdiction } from "./variants.mjs";

// What is left is exactly the set with no producer: submittedToWitnessDate, dueDate and serviceDate
// are declared WORKFLOW_DERIVED in the canonical record, and no workflow writes them. They are
// blank because nothing can answer them yet, which is a different fact from blank because nobody
// has been asked.
//
// The six a reporter can answer came off this list when the certificate form began collecting
// them. Leaving them here would have meant a reporter who skips the form still gets a certificate
// with a dropped clause and a clean bill of health -- the defect this list is next to, not a use
// for it. An entry added merely to make validation pass is how the guard stops meaning anything.
// Fields a variant may legitimately leave blank.
//
// The eight below are DEFERRED, not optional. Rule 203 certification happens in stages: the initial
// certification is signed when the transcript is produced, the witness then examines and returns it,
// and only afterwards can return, custody, charges and service be certified. A transcript produced
// at stage one cannot state facts that have not occurred, and the reviewed template says so in its
// own words on the page: "Further certification requirements pursuant to Rule 203 of TRCP will be
// certified to after they have occurred."
//
// Measured against the reporter's own certified 72-page Etminan transcript, which is the known-good
// output this application is trying to reproduce: eight of these nine fields are blank on the
// delivered document. Requiring them at stage one asked the reporter for facts their own certified
// practice defers.
//
// Do not read this list as "these fields are optional". Each becomes required at the certification
// stage that can establish it, and nothing here produces that later page yet. If a further-
// certification document is ever generated, these must be required there -- a field permitted to be
// blank forever is how a certificate ends up asserting nothing where it should assert something.
//
// cert.chargesResponsibleParty is deliberately NOT here. The certified transcript states it at stage
// one -- "THE DEPOSITION OFFICER'S CHARGES TO THE PLAINTIFF" -- so it is knowable when the initial
// certificate is signed, and it stays required.
//
// Scoped to the one variant a real deposition has exercised. The waived and federal variants are not
// changed for symmetry: no source document has been read for them, and a blank permitted without
// evidence is the same mistake in the other direction.
// One table, in variants.mjs, so validation and rendering cannot disagree about which fields are
// deferred. A field permitted to be blank here that has no printed rule there would render an empty
// clause; a field with a rule but no permission here would block a document it can already print.
const RULE_203_DEFERRED_UNTIL_THE_EVENTS_OCCUR = Object.freeze(Object.keys(STAGE_ONE_DEFERRED_RULE_WIDTHS));

export const INTENTIONAL_BLANKS = Object.freeze({
  TEXAS_STATE_SIGNATURE_REQUESTED: RULE_203_DEFERRED_UNTIL_THE_EVENTS_OCCUR,
  TEXAS_STATE_SIGNATURE_WAIVED: Object.freeze([]),
  FEDERAL_SIGNATURE_REQUESTED: Object.freeze([]),
  FEDERAL_SIGNATURE_WAIVED: Object.freeze([]),
});

// The reviewed certificates that state, in their own words, how much time each party used. Both
// Texas certification-1 templates print "That the amount of time used by each party at the
// deposition is as follows:" followed by ^cert.timeUsedLines^.
//
// A list, not a blanket rule, because the clause is a property of a reviewed certificate rather
// than of certification in general -- the federal templates are stubs and nobody has read what
// theirs will say. And a list beside the templates is a list that can drift from them, so
// tests/the-certificate-states-the-time-each-party-used.test.mjs reads the reviewed template
// bodies and asserts this set is exactly the ones carrying the caret.
export const TIME_USED_CERTIFIED = Object.freeze([
  "TEXAS_STATE_SIGNATURE_REQUESTED", "TEXAS_STATE_SIGNATURE_WAIVED",
]);

const blocking = (code, target, message, extra = {}) => ({ code, target, severity: "blocking", message, ...extra });
const warning = (code, target, message, extra = {}) => ({ code, target, severity: "warning", message, ...extra });
const normalizedName = (name) => String(name ?? "").toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
const isBlank = (value) => value == null || value === "" || (Array.isArray(value) && value.length === 0);

// Both Texas certification templates state, as a literal, that the witness "was duly sworn by the
// officer". When the record carries an attestation that the witness did not swear, that sentence is
// false and it goes out under the reporter's name and CSR number. Refuse rather than print it.
//
// Phase 2, and the reason it waited. MISSING used to generate: nobody had attested, and an
// unattested certificate was treated as a gap in the record rather than a false statement. But the
// sentence is a literal in both templates, so an unattested certificate does not omit the claim --
// it makes it, under the reporter's name and CSR number, resting on nothing the record holds.
//
// Two codes, because the remedies are not the same and a reporter must be able to tell them apart:
//
//   MISSING   nobody has said what happened. The remedy is to attest, in Opening -> Scripts &
//             Oaths, from actual knowledge. The record can be completed.
//   false     the record says the witness affirmed. There is nothing to complete. No Texas
//             authority publishes affirmation certificate wording and no certified specimen
//             contains any, so refusal is the whole remedy -- do not "fix" this by writing that
//             sentence.
//
// FALSE is not MISSING. Collapsing them would tell a reporter whose witness affirmed to go and
// attest something they have already correctly attested.
//
// See docs/opening-procedures/authorization-o10-oath-basis-on-the-record.md.
function validateOathBasis(input, findings) {
  const administration = input.deposition?.oathAdministration;
  if (administration) {
    const required=["selection","spokenText","response","occurredAt","verificationSource","recordedAt","recordedBy"];
    const missing=required.filter(key => !administration[key]);
    if (!administration.officer?.role || !administration.officer?.name) missing.push("officer");
    if (missing.length) {
      findings.push(blocking("CERT_STRUCTURED_OATH_INCOMPLETE", "deposition.oathAdministration", `The canonical administration record is incomplete (${missing.join(", ")}). Certificate wording cannot be selected from a partial event.`));
      return;
    }
  }
  if (administration?.selection === "AFFIRMATION") {
    findings.push(blocking("CERT_AFFIRMATION_TEMPLATE_UNAVAILABLE", "deposition.oathAdministration.selection", "The canonical record establishes that the witness affirmed. The reviewed Texas certificate says the witness was duly sworn, so that certificate cannot be generated until an approved affirmation variant is supplied."));
    return;
  }
  if (administration?.selection === "OATH") return;
  if (input.deposition?.witnessSworn !== null && input.deposition?.witnessSworn !== undefined)
    findings.push(blocking("CERT_STRUCTURED_OATH_MISSING", "deposition.oathAdministration", "A legacy sworn flag exists, but only an attributable canonical administration record may select certificate wording. Record the administration in Opening before generating the certificate."));
  else
  findings.push(blocking(
    "CERT_OATH_BASIS_UNRESOLVED", "deposition.witnessSworn",
    "The certification page states that the witness was duly sworn by the officer, and nothing on this record establishes that. Record the oath attestation in Opening, under Scripts & Oaths, before generating the certificate.",
  ));
}

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
  // A side nobody recorded blocks the page rather than being omitted or guessed.
  //
  // Omitting the line would ship an appearance page missing an attorney who was present -- a
  // defective certified document that looks complete, which nobody reviewing it would know to
  // question. Falling back to `represents` would reinstate the party-name coupling this replaced.
  const unsided = input.appearances.filter((attorney) => !appearancePhrase(attorney)).map((attorney) => attorney.name);
  if (unsided.length) {
    findings.push(blocking("APPEARANCE_SIDE_MISSING", "appearances.side",
      `Record which side each attorney appears for before generating; missing for: ${unsided.join(", ")}.`,
      { details: { missingNames: unsided } }));
  }

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

// The certificate states the time each party used; this refuses to let it state it over nothing.
//
// The blank guard cannot cover this. cert.timeUsedLines is composed in build-pages from
// input.timeUsed and never reaches fieldValues, so it is named in no inventory and isBlank never
// sees it -- and renderTemplatePage drops a line whose fields are all absent, so the empty result
// was not even visible as a gap on the page. The sentence introducing it printed anyway.
//
// Blocking, on the same grounds as validateDepositionMethod: the clause is a certification about
// the deposition, and one made over an empty list is worse than one refused. It fails where the
// fact is missing rather than where a reader would eventually notice.
function validateTimeUsed(input, findings) {
  if (!TIME_USED_CERTIFIED.includes(input.variant)) return;
  const parties = input.timeUsed?.parties ?? [];
  if (!parties.length) {
    findings.push(blocking("CERT_TIME_USED_UNRECORDED", "cert.timeUsedLines", "The certificate states the amount of time used by each party, and no party time is recorded for this deposition.", { path: "timeUsed.parties" }));
    return;
  }
  for (const [position, party] of parties.entries()) {
    // Zero is an answer. Absent, negative and fractional are not: each would print a duration the
    // reporter did not give, and "00 HOURS:00 MINUTES" from an unanswered field is the same
    // manufactured value as any other.
    if (!String(party?.name ?? "").trim() || !Number.isInteger(party?.minutes) || party.minutes < 0) {
      findings.push(blocking("CERT_TIME_USED_INCOMPLETE", "cert.timeUsedLines", `Party time entry ${position + 1} must name a party and give a whole, non-negative number of minutes.`, { path: `timeUsed.parties.${position}` }));
    }
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

function validateVideographer(input,findings){
  if(input.deposition?.videotaped===true&&!(input.record?.participants?.videographers??[]).length){
    findings.push(blocking("VIDEOGRAPHER_UNRECORDED","participants.videographers","The deposition is marked videotaped, but no videographer is recorded. The appearance page will not state that no videographer attended.",{path:"record.participants.videographers"}));
  }
}

export function validateInsertionInput(input) {
  const findings = [];
  validateVideographer(input,findings);
  validateOathBasis(input, findings);
  validateVariant(input, findings);
  validateCredentials(input, findings);
  validateDepositionMethod(input, findings);
  validateCounsel(input, findings);
  validateIndex(input, findings);
  validateTimeUsed(input, findings);
  if ((input.deposition?.volumeCount ?? 1) > 1) findings.push(blocking("MULTI_VOLUME_UNSUPPORTED", "deposition.volumeCount", `This renderer supports one volume; received ${input.deposition.volumeCount}.`));
  findings.push(...captionOverflowFindings(input));
  findings.push(...pageOverflowFindings(input.pages ?? [], input.layoutProfile));
  validateFields(input, findings);
  validateWarnings(input, findings);
  return findings;
}

export function hasBlockingFindings(findings) {
  return findings.some((finding) => finding.severity === "blocking");
}
