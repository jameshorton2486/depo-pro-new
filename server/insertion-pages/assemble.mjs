import { counselSidePhrase } from "../../app/manual-intake.mjs";
import { UFM_FREELANCE_LAYOUT_PROFILE } from "./layout-profile.mjs";
import { selectInsertionVariant } from "./variants.mjs";

export function canonicalValue(value) {
  return value && typeof value === "object" && "value" in value ? value.value : value;
}

// The words that follow FOR on an appearance page, and the same words the certificate names.
// Null where the side was never recorded -- validateInsertionInput blocks on that, so nothing
// downstream has to decide what an unrecorded side should say.
//
// Read from the phrase map for a named side and from the reporter's own wording for OTHER. Never
// from : that holds party names, and printing them here is the defect this replaced.
export function appearancePhrase(attorney) {
  if (attorney.side === "OTHER") return attorney.sideOther || null;
  return counselSidePhrase(attorney.side);
}

function attorneyFromCanonical(attorney) {
  return {
    id: attorney.id,
    name: canonicalValue(attorney.fullName ?? attorney.name),
    firm: canonicalValue(attorney.firm),
    address: canonicalValue(attorney.address),
    phone: canonicalValue(attorney.phone),
    email: canonicalValue(attorney.email),
    barNumber: canonicalValue(attorney.barNumber),
    representing: canonicalValue(attorney.represents) ?? [],
    side: canonicalValue(attorney.side) ?? null,
    sideOther: canonicalValue(attorney.sideOther) ?? null,
    actualAppearance: canonicalValue(attorney.actualAppearance),
    participation: {
      method: canonicalValue(attorney.participation?.method) ?? null,
      detail: canonicalValue(attorney.participation?.detail) ?? "",
    },
  };
}

const waiverFrom = reason => (String(reason ?? "").trim() ? { applicable:false, reason:String(reason).trim() } : null);

// The caption's party lines, derived once. build-pages imports this to compose the printed line so
// that the value the guard checks and the value the page prints come from the same read of the
// record -- the two had drifted apart, and the drift was the defect: the caption printed party
// names that no inventory named, so nothing checked them.
//
// Absent is null rather than "". `[].join(", ")` answers "this case has no plaintiffs", which the
// record does not say; what it says is that no party carries the role. Only the caller composing a
// line turns that into text.
// THE RULE, and the whole class it governs.
//
// A template that writes a label must not accept a value containing it. Two templates do, and both
// reached certified pages before anyone noticed: "That $^cert.charges^" printed $1,240.00, and
// "Texas CSR ^reporter.csrNumber^" printed CSR CSR 9174. In both cases the form field invited
// exactly the thing that doubled -- a field called "Deposition officer's charges" asks for a sum of
// money, and money has a dollar sign on it.
//
// The strip below is the cheap correct fix. The durable one is the form label, which now says who
// writes the prefix ("Digits only; the certificate prints \"Texas CSR\" before it", and
// "Deposition officer's charges (amount only)"). A strip that silently corrects the reporter is
// weaker than a label that stops them typing it, and both are cheaper than a defect on a certified
// page.
//
// Every template token was checked against the last word of the literal preceding it. The result:
//
//   DOUBLES, stripped here:
//     cert.charges              after "That $"
//     reporter.csrNumber        after "Texas CSR "
//
//   LATENT -- would double if a reporter typed the label, clean today, deliberately NOT stripped:
//     caption.causeNumber              after "NO.: "
//     reporter.firmRegistrationNumber  after "Firm Registration No. "
//   Stripping these would be guessing at values that do not exist yet, and a strip nobody needs is
//   a way to damage a value nobody typed wrong. If one ever doubles, the fix is one line and this
//   comment says where.
//
//   CONSIDERED AND EXCLUDED -- prose, not labels. A value beginning with the word reads correctly:
//     cert.chargesResponsibleParty     after "charges to the "   ("the Brazos Ridge Defense Group")
//     cert.custodialAttorney           after "delivered to "
//     reporter.csrExpirationDate       after "Expiration Date: "
//   Recorded so a later reader knows they were examined rather than missed.
//
// One leading $, with any space after it, and nothing else. A value of "$1,240.00" becomes
// "1,240.00"; "1,240.00" is untouched; "$$5" becomes "$5" rather than "5", because a reporter who
// typed two meant something this cannot guess at and a certified page should not silently invent
// the answer. null stays null so an unrecorded amount keeps blocking.
export function stripLeadingCurrency(value) {
  if (value === null || value === undefined) return value;
  return String(value).replace(/^\s*\$\s?/, "");
}

// The certificate reads "^reporter.name^, Texas CSR ^reporter.csrNumber^", and the reporter modal
// labels the field "CSR number" -- so "CSR 9174" is the natural thing to type and printed
// "Texas CSR CSR 9174". Same defect as the doubled dollar sign, one token over: the template writes
// a label the field also accepts.
//
// Stripped here rather than at the write boundary, for the same reason: the reporter profile keeps
// what was entered, and the page prints what its own sentence needs. One leading CSR only, so
// "CSR CSR 9174" prints "CSR 9174" and stays visibly odd rather than being silently made right.
export function stripLeadingCsrLabel(value) {
  if (value === null || value === undefined) return value;
  return String(value).replace(/^\s*CSR\b\s*(?:(?:NO|NUMBER)\b\.?\s*)?[.:-]?\s*/i, "");
}

export function captionParties(record) {
  const parties = record?.parties ?? [];
  const inRole = pattern => parties
    .filter(party => pattern.test(String(canonicalValue(party.role) ?? "")))
    .map(party => canonicalValue(party.captionDisplayName) || canonicalValue(party.name));
  return { plaintiffs: inRole(/plaintiff/i), defendants: inRole(/defendant/i) };
}

// `override` is operator.reporter, an unvalidated construction path into the reporter profile
// that bypasses the store entirely. The app never populates it, so it is not a live path -- but it
// has now defeated three separate guards, and a fourth will meet it too.
//
//   reporter-store-drops-firm-registration pins that no stored profile can carry a
//   firmRegistrationNumber; this override supplies one anyway, and that test names the gap.
//
//   a-waiver-is-an-answer needs waivedFields to reject a waiver with no reason. waiverFrom below
//   already refuses a blank reason by returning null, so through the canonical path the check is
//   unreachable -- it is reachable only because this override can hand over
//   { applicable:false, reason:"" } directly.
//
//   the-reporter-profile-reaches-the-certificate and verification-never-reaches-a-certified-page
//   both render through it, because a waived reporter could not otherwise clear UNEXPECTED_BLANK
//   on reporter.firmName. That is the third: two guards on a certified page are satisfied there by
//   a value no stored profile could hold.
//
// Anything written here that assumes a reporter arrived through reporter-store.mjs is assuming
// something this parameter can falsify. Validate what you read from it, or read it from the store.
function reporterFromCanonical(reporter = {}, override = {}) {
  return {
    name: override.name ?? canonicalValue(reporter.fullName),
    csrNumber: stripLeadingCsrLabel(override.csrNumber ?? canonicalValue(reporter.csrNumber)),
    csrExpirationDate: override.csrExpirationDate ?? canonicalValue(reporter.csrExpiration),
    address: override.address ?? canonicalValue(reporter.address),
    phone: override.phone ?? canonicalValue(reporter.phone),
    firmName: override.firmName ?? canonicalValue(reporter.firm),
    firmRegistrationNumber: override.firmRegistrationNumber ?? canonicalValue(reporter.firmRegistrationNumber),
    // A recorded waiver reason satisfies the certificate requirement the same way a registration
    // number does. The reason travels so a reader can see what the omission rests on, rather than
    // finding a field that is simply empty.
    firmRegistration: override.firmRegistration ?? waiverFrom(canonicalValue(reporter.firmRegistrationWaiver)),
  };
}

// The reporter's answer to "how much time did each party use", in the shape build-pages prints and
// validateWarnings reconciles. operator.timeUsed stays ahead of it on the same terms as
// operator.certification: a value handed in carries no source, so nothing may treat it as one the
// reporter gave.
//
// Null when nothing is recorded, never an empty parties list. The two are different answers -- an
// empty list says no party used any time, silence says nobody was asked -- and the gate that
// refuses the clause has to be able to tell them apart.
//
// totalOnRecordMinutes is deliberately absent. It is a fact about the recording, no writer
// produces it, and summing the parties to fill it would make the reconciliation warning compare a
// number against itself.
function recordedTimeUsed(record) {
  const entries = record?.certification?.attorneyTime ?? [];
  if (!entries.length) return null;
  return { parties: entries.map((party) => ({ name: canonicalValue(party.name), minutes: canonicalValue(party.minutes) })) };
}

export function assembleInsertionInput({ record, intake = {}, operator = {}, pagination = {}, template = null, layoutProfile = UFM_FREELANCE_LAYOUT_PROFILE }) {
  const jurisdiction = operator.jurisdiction ?? null;
  const signatureDisposition = operator.signatureDisposition ?? null;
  const variant = selectInsertionVariant({ jurisdiction, signatureDisposition });
  // Counsel of record who did not appear are not appearances. Two certified specimens settle it
  // and they cover both shapes: on the Etminan page Marco Crawford is absent while MARCO CRAWFORD
  // LAW, PLLC still prints, because Bentley appeared from that firm; on the Thomas page both
  // Cukjatis AND Cukjati Law Firm are absent entirely, because nobody from it was there. So a
  // firm reaches the page only through an attorney who appeared, and no separate firm handling is
  // needed -- filtering the attorney is the whole rule.
  //
  // `!== false` rather than `=== true`: actualAppearance defaults to missing(), and "never
  // recorded" is a different fact from "did not appear". A strict test would silently drop
  // counsel whose attendance nobody has entered yet.
  const appeared = attorney => canonicalValue(attorney?.actualAppearance) !== false;
  const counsel = (operator.appearances ?? record.counsel ?? []).filter(appeared).map(attorneyFromCanonical);
  const volumes = operator.volumes ?? record.transcript?.volumes ?? [];
  const volumeCount = operator.volumeCount ?? (volumes.length || 1);
  const court = canonicalValue(record.case?.court);
  const causeNumber = canonicalValue(record.case?.causeNumber);
  // Captured and deliberately NOT rendered. No template references ^caption.caseStyle^, and that is
  // the ruling rather than an oversight: the caption block composes its parties from the party array
  // so that it is provably the recorded parties, which reporter-typed text could not be. This holds
  // the reporter's record of what the docket actually says, and it is the input if that is ever
  // reopened -- see the note above captionValues in build-pages.mjs. Do not wire it up, and do not
  // delete it as unused.
  const caseStyle = canonicalValue(record.case?.caseStyle);
  const depositionDate = canonicalValue(record.deposition?.depositionDate);
  const witness = canonicalValue(record.deposition?.witness);
  const reporter = reporterFromCanonical(record.reporter, operator.reporter ?? {});
  const { plaintiffs, defendants } = captionParties(record);
  const proceedingLocation = operator.proceedingLocation ?? { platform: canonicalValue(record.deposition?.remotePlatform), physicalAddress: canonicalValue(record.deposition?.location) };

  return {
    record,
    intake,
    operator,
    pagination,
    layoutProfile,
    template,
    jurisdiction,
    signatureDisposition,
    signatureDispositionBasis: operator.signatureDispositionBasis ?? null,
    // What the reporter recorded on the Opening screen about how the witness was put under.
    // Lifted rather than read out of `operator` so the validator asserts on a named field.
    // Null is the ordinary case and is not a refusal -- see validateOathBasis.
    witnessOathSelection: operator.witnessOathSelection ?? null,
    variant,
    caption: { court, causeNumber, caseStyle, label: operator.captionLabel ?? null },
    deposition: { witness, date: depositionDate, volumeCount, proceedingLocation, remote: canonicalValue(record.deposition?.remote) },
    reporter,
    appearances: counsel,
    counselReconciliation: {
      expectedNames: intake.counselOfRecord ?? [],
      appearingCounselPhrasingDecision: operator.appearingCounselPhrasingDecision ?? null,
    },
    locations: {
      proceeding: proceedingLocation,
      reporter: operator.reporterLocation ?? { physicalAddress: null },
      witness: operator.witnessLocation ?? { physicalAddress: null },
    },
    index: pagination.index ?? { entries: [], actualSectionPages: {}, declaredSectionPages: {} },
    timeUsed: operator.timeUsed ?? recordedTimeUsed(record),
    presentation: operator.presentation ?? {},
    // validateFields reads this map, not the values build-pages composes later -- so a name in a
    // variant's field inventory that is absent here is blank on every render, and blocks
    // unconditionally.
    //
    // The cert.* values are read from the canonical record, which is where the certificate form
    // writes them with REPORTER_ENTERED provenance. operator.certification stays ahead of it as a
    // construction path for fixtures, on the same terms as operator.reporter above: a value handed
    // over here carries no source, so nothing may treat it as one the reporter answered.
    fieldValues: {
      "caption.court": court,
      "caption.causeNumber": causeNumber,
      "caption.plaintiffs": plaintiffs.length ? plaintiffs : null,
      "caption.defendants": defendants.length ? defendants : null,
      "deposition.witness": witness,
      "deposition.date": depositionDate,
      "deposition.volumeLabel": volumeCount === 1 ? "VOLUME 1 OF 1" : null,
      "appearances.counsel": counsel.length ? counsel : null,
      "index.examinations": pagination.index?.examinations ?? null,
      "index.changesAndSignature": pagination.index?.changesAndSignature?.startPage ?? null,
      "index.reportersCertification": pagination.index?.reportersCertification?.startPage ?? null,
      "cert.submissionDate": operator.certification?.submissionDate ?? null,
      "cert.returnDeadline": operator.certification?.returnDeadline ?? null,
      "cert.returnStatus": operator.certification?.returnStatus ?? canonicalValue(record.signature?.returnedDate) ?? null,
      "cert.custodialAttorney": operator.certification?.custodialAttorney ?? canonicalValue(record.certification?.custodialAttorney) ?? null,
      // The template writes the dollar sign -- "That $^cert.charges^ is the deposition officer's" --
      // so a reporter who types the natural thing, $1,240.00, put $$1,240.00 on a certified page.
      // Stripped here, at the print site, and deliberately not at the write boundary: the record
      // keeps what the reporter typed, and the page prints what the sentence needs.
      "cert.charges": stripLeadingCurrency(operator.certification?.charges ?? canonicalValue(record.certification?.officerCharges) ?? null),
      "cert.chargesResponsibleParty": operator.certification?.chargesResponsibleParty ?? canonicalValue(record.certification?.chargesResponsibleParty) ?? null,
      "cert.serviceDate": operator.certification?.serviceDate ?? null,
      "cert.certificationDate": operator.certification?.certificationDate ?? canonicalValue(record.certification?.certificationDate) ?? null,
      "cert.furtherCertificationDate": operator.certification?.furtherCertificationDate ?? canonicalValue(record.certification?.furtherCertificationDate) ?? null,
      "reporter.name": reporter.name,
      "reporter.csrNumber": reporter.csrNumber,
      "reporter.csrExpirationDate": reporter.csrExpirationDate,
      "reporter.firmRegistrationNumber": reporter.firmRegistrationNumber,
      "reporter.address": reporter.address,
      "reporter.phone": reporter.phone,
    },
  };
}
