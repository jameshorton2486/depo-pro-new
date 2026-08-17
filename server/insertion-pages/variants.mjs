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

// Every US state other than Texas. A caption naming one of these is a court Depo-Pro has no
// reviewed certificate for, and saying so is the whole point -- see UNSUPPORTED below.
const OTHER_STATES = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|district of columbia)\b/i;
const TEXAS = /\btex(?:as\b|\.)/i;
const FEDERAL = /\b(united states|u\.?\s?s\.?)\s+(district|bankruptcy)\s+court\b/i;

/**
 * Returns "federal", "texas-state", "unsupported", or null.
 *
 * "unsupported" means the caption names a state Depo-Pro has no reviewed certificate for.
 * null means undetermined -- the caption could not be read either way.
 *
 * The distinction matters because the previous version matched a bare "district court" as
 * Texas, so `IN THE DISTRICT COURT OF DOUGLAS COUNTY, NEBRASKA` returned "texas-state". That
 * is a confident wrong answer rather than an absent one, and the mismatch gate could not see
 * it: the gate only fires when detection DISAGREES with the operator, so a wrong detection
 * agreeing with a wrong selection produced no finding at all. Texas certification language
 * would reach a Nebraska transcript with nothing raised.
 *
 * Texas is now required explicitly. A court type alone -- district, county, justice -- says
 * nothing about which state it sits in.
 */
export function captionJurisdiction(court = "") {
  const value = String(court || "");
  if (FEDERAL.test(value)) return "federal";
  if (TEXAS.test(value)) return "texas-state";
  if (OTHER_STATES.test(value)) return "unsupported";
  return null;
}
