import { UFM_FREELANCE_LAYOUT_PROFILE } from "./layout-profile.mjs";
import { selectInsertionVariant } from "./variants.mjs";

export function canonicalValue(value) {
  return value && typeof value === "object" && "value" in value ? value.value : value;
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
    csrNumber: override.csrNumber ?? canonicalValue(reporter.csrNumber),
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
    timeUsed: operator.timeUsed ?? null,
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
      "cert.charges": operator.certification?.charges ?? canonicalValue(record.certification?.officerCharges) ?? null,
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
