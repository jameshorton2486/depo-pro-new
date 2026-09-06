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

// Rule 203 facts a stage-one signature-requested certificate cannot yet state, and the width of the
// rule printed in their place.
//
// Three states, not two. A missing required fact refuses; a known fact prints; a fact that has not
// happened yet prints an intentional fill-in rule so the clause stays whole. The reviewed template
// carries bare carets, so a deferred field resolving to null silently ate its own sentence --
// measured, "submitted on ^cert.submissionDate^ to the witness" rendered as "submitted on" and the
// rest of the clause disappeared. That is what this exists to prevent.
//
// Widths. The first six are measured from the reporter's own certified Etminan transcript, clause by
// clause: a dollar amount gets a shorter rule than an attorney name because that is what the
// certified form does. The two certification dates are Depo-Pro presentation policy, NOT
// measurements -- the certified transcript segments them as "___ day of ___, ___" while this
// reviewed template gives one caret the whole phrase, so there was nothing to measure. Twenty
// matches the other date rules here.
//
// There is deliberately no default. A deferred field with no width refuses rather than receiving a
// plausible-looking blank, because something the application does not understand must never reach a
// certified page looking like something it does.
//
// Scoped to the one variant a real deposition has exercised. Waived and federal are untouched: no
// source document has been read for them, and a blank permitted without evidence is the same
// mistake in the other direction.
export const STAGE_ONE_DEFERRED_VARIANT = "TEXAS_STATE_SIGNATURE_REQUESTED";
export const STAGE_ONE_DEFERRED_RULE_WIDTHS = Object.freeze({
  "cert.submissionDate": 20,
  "cert.returnDeadline": 20,
  "cert.returnStatus": 25,
  "cert.custodialAttorney": 25,
  "cert.charges": 10,
  "cert.serviceDate": 11,
  "cert.certificationDate": 20,
  "cert.furtherCertificationDate": 20,
});

/** The printed rule for a deferred field, or a refusal if no width was declared for it. */
export function deferredRule(field) {
  const width = STAGE_ONE_DEFERRED_RULE_WIDTHS[field];
  if (!Number.isInteger(width) || width < 1) {
    throw new Error(`STAGE_ONE_DEFERRED_WIDTH_REQUIRED: ${field} is deferred at stage one but no printed-rule width is declared for it.`);
  }
  return "_".repeat(width);
}
