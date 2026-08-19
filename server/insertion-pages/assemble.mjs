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

function reporterFromCanonical(reporter = {}, override = {}) {
  return {
    name: override.name ?? canonicalValue(reporter.fullName),
    csrNumber: override.csrNumber ?? canonicalValue(reporter.csrNumber),
    csrExpirationDate: override.csrExpirationDate ?? canonicalValue(reporter.csrExpiration),
    address: override.address ?? canonicalValue(reporter.address),
    phone: override.phone ?? canonicalValue(reporter.phone),
    firmName: override.firmName ?? canonicalValue(reporter.firm),
    firmRegistrationNumber: override.firmRegistrationNumber ?? canonicalValue(reporter.firmRegistrationNumber),
    firmRegistration: override.firmRegistration ?? null,
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
    deposition: { witness, date: depositionDate, volumeCount, proceedingLocation },
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
    fieldValues: {
      "caption.court": court,
      "caption.causeNumber": causeNumber,
      "caption.caseStyle": caseStyle,
      "deposition.witness": witness,
      "deposition.date": depositionDate,
      "deposition.volumeLabel": volumeCount === 1 ? "VOLUME 1 OF 1" : null,
      "deposition.proceedingLocation": proceedingLocation?.platform ?? proceedingLocation?.physicalAddress,
      "appearances.counsel": counsel.length ? counsel : null,
      "index.examinations": pagination.index?.examinations ?? null,
      "index.changesAndSignature": pagination.index?.changesAndSignature?.startPage ?? null,
      "index.reportersCertification": pagination.index?.reportersCertification?.startPage ?? null,
      "cert.signatureDispositionBasis": operator.signatureDispositionBasis ?? null,
      "cert.submissionDate": operator.certification?.submissionDate ?? null,
      "cert.returnDeadline": operator.certification?.returnDeadline ?? null,
      "cert.returnStatus": operator.certification?.returnStatus ?? null,
      "cert.custodialAttorney": operator.certification?.custodialAttorney ?? null,
      "cert.charges": operator.certification?.charges ?? null,
      "cert.serviceDate": operator.certification?.serviceDate ?? null,
      "cert.certificationDate": operator.certification?.certificationDate ?? null,
      "reporter.name": reporter.name,
      "reporter.csrNumber": reporter.csrNumber,
      "reporter.csrExpirationDate": reporter.csrExpirationDate,
      "reporter.firmName": reporter.firmName,
      "reporter.firmRegistrationNumber": reporter.firmRegistrationNumber,
      "reporter.address": reporter.address,
      "reporter.phone": reporter.phone,
    },
  };
}
