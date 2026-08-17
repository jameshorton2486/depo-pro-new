// The keyterm caps live here, alone and with no imports, because the browser needs them too.
//
// They used to exist twice: KEYTERM_PRODUCT_CAP = 50 in transcription-jobs.mjs, and the
// literal 60 in IntakeScreen's "x/60" counter and its "caps this artifact at 60" copy. The
// mismatch was invisible only because extraction truncates to 50 before the UI ever renders a
// count -- the moment the reporter can add a term, a set of 55 reaches authoritativeKeyterms
// and is rejected there with no way to have seen it coming.
//
// transcription-jobs.mjs re-exports these so its own consumers are unaffected. Import them
// from either place; there is only one value.
export const KEYTERM_PRODUCT_CAP = 50;
export const KEYTERM_TOKEN_BUDGET = 400;
// Deepgram's own API limit, well above Depo-Pro's product cap. Kept here so the two ceilings
// are visibly different numbers rather than one number someone might "correct" to the other.
export const KEYTERM_API_LIMIT = 100;

// Must stay identical to the estimate local-api.mjs writes into the extraction artifact and to
// the one authoritativeKeyterms enforces against. A UI that estimates differently from the
// server would show a set as within budget and have it rejected at transcription time.
export function estimateKeytermTokens(terms) {
  return terms.reduce((total, term) => total + Math.ceil(String(term).length / 4) + 1, 0);
}
