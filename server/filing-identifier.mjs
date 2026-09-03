const FEDERAL = "federal";

/**
 * Jurisdiction-aware presentation for the single canonical filing identifier.
 *
 * `case.causeNumber` remains the only stored fact for schema 1.x.  `filingNumber`
 * and `caseNumber` are projections only; accepting either as another persisted
 * value would allow two docket identifiers to disagree.
 */
export function filingIdentifier(recordOrCase = {}, jurisdictionOverride = null) {
  const caseRecord = recordOrCase?.case ?? recordOrCase;
  const unwrap = value => value && typeof value === "object" && "value" in value ? value.value : value;
  const jurisdiction = jurisdictionOverride ?? unwrap(caseRecord?.jurisdictionType ?? caseRecord?.jurisdiction);
  const value = unwrap(caseRecord?.causeNumber);
  const federal = jurisdiction === FEDERAL;
  return {
    value: value ?? null,
    semantic: federal ? "CIVIL_ACTION_NUMBER" : "CAUSE_NUMBER",
    displayLabel: federal ? "Civil Action No." : "Cause Number",
    legacyPath: "case.causeNumber",
  };
}

export function reconcileFilingIdentifier({ causeNumber, filingNumber, caseNumber } = {}) {
  const supplied = [causeNumber, filingNumber, caseNumber]
    .filter(value => value !== undefined && value !== null && String(value).trim() !== "")
    .map(value => String(value).trim());
  const distinct = [...new Set(supplied)];
  if (distinct.length > 1) throw new Error("CONFLICTING_FILING_IDENTIFIERS");
  return distinct[0] ?? null;
}
