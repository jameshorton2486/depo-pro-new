export const INSERTION_VARIANTS = Object.freeze({
  TEXAS_STATE_SIGNATURE_REQUESTED: "TEXAS_STATE_SIGNATURE_REQUESTED",
  TEXAS_STATE_SIGNATURE_WAIVED: "TEXAS_STATE_SIGNATURE_WAIVED",
  FEDERAL_SIGNATURE_REQUESTED: "FEDERAL_SIGNATURE_REQUESTED",
  FEDERAL_SIGNATURE_WAIVED: "FEDERAL_SIGNATURE_WAIVED",
});

const SELECTIONS = Object.freeze({
  "texas-state:requested": INSERTION_VARIANTS.TEXAS_STATE_SIGNATURE_REQUESTED,
  "texas-state:waived": INSERTION_VARIANTS.TEXAS_STATE_SIGNATURE_WAIVED,
  "federal:requested": INSERTION_VARIANTS.FEDERAL_SIGNATURE_REQUESTED,
  "federal:waived": INSERTION_VARIANTS.FEDERAL_SIGNATURE_WAIVED,
});

export function selectInsertionVariant({ jurisdiction, signatureDisposition } = {}) {
  // Reporter credentials, location, and prior matters must never participate in selection.
  return SELECTIONS[`${jurisdiction}:${signatureDisposition}`] ?? null;
}

export function captionJurisdiction(court = "") {
  if (/\b(united states|u\.?s\.?)\s+(district|bankruptcy|court of appeals)\s+court\b/i.test(court) || /\bunited states district court\b/i.test(court)) return "federal";
  if (/\b(texas|district court|county court|justice court)\b/i.test(court)) return "texas-state";
  return null;
}
