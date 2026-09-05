// What a general transcript-format correction is allowed to be, and how each class is proven.
//
// WHY A SECOND PASS RATHER THAN A WIDER FIRST ONE. The entity pass corrects spellings of names, and
// its validator enforces that: every proposed value must appear verbatim in the deposition's
// authoritative name list, and the only correction type is "spelling". Measured against a 75-page
// human-corrected Heath Thomas transcript, 546 differences separated the machine transcript from
// the reporter's -- and the entity pass was structurally permitted to attempt about 89 of them.
// "25 c v 00598DashOLG" is not a name. Neither is "U. S. A. Inc. A k a,". Widening the entity pass
// to admit them would have removed the property that makes it safe.
//
// THE INVARIANT THAT MAKES MOST OF THIS PROVABLE. Nearly every formatting correction preserves the
// letters and digits and changes only how they are punctuated, spaced or capitalised:
//
//     "U. S. A. Inc. A k a,"  ->  "U.S.A., Inc., a.k.a."      usaincaka === usaincaka
//
// That is checkable without trusting the model at all. A proposal whose alphanumeric content differs
// from the original is changing what was said, not how it is written, and is refused here whatever
// class it claims. Two narrow classes are exempt because their authority comes from somewhere else:
// a canonical identifier must match the deposition's own record, and an abbreviation must appear in
// a fixed table. Nothing else may add or remove a letter.
//
// WHAT THIS DELIBERATELY CANNOT DO. The same corrected transcript establishes that the oath was
// "so help you God" and that the witness answered "I do." Three AI passes refused to guess both, and
// were right to: the machine evidence did not establish them. Knowing the answers retrospectively
// does not authorise guessing them prospectively, and both are refused below by the same rule that
// refuses everything else that changes a word.

export const FORMAT_CORRECTION_TYPES = Object.freeze([
  "punctuation",            // "that" -> "that," -- letters identical
  "capitalization",         // "federal rules" -> "Federal Rules"
  "tokenization",           // "U. S. A." -> "U.S.A." -- ASR split one token into several
  "abbreviation",           // "mister" -> "Mr." -- from a fixed table, never inferred
  "canonical_identifier",   // "25 c v 00598DashOLG" -> the cause number the record already holds
]);

export const FORMAT_REFUSALS = Object.freeze({
  UNKNOWN_TYPE: "UNKNOWN_TYPE",
  EMPTY_VALUE: "EMPTY_VALUE",
  NO_CHANGE: "NO_CHANGE",
  CONTENT_CHANGED: "CONTENT_CHANGED",
  NOT_A_KNOWN_ABBREVIATION: "NOT_A_KNOWN_ABBREVIATION",
  NOT_IN_CANONICAL_RECORD: "NOT_IN_CANONICAL_RECORD",
  IDENTIFIER_UNRELATED: "IDENTIFIER_UNRELATED",
  NO_ANCHOR: "NO_ANCHOR",
});

/**
 * The abbreviations a transcript may standardise, and nothing else.
 *
 * A table rather than a rule, because "doctor" is a word people say about their profession as often
 * as they say it as a title, and a rule that shortened both would rewrite testimony. These are the
 * courtesy titles whose spoken and written forms differ by convention alone. An abbreviation is only
 * accepted when the word after it looks like a name, which is checked separately.
 */
export const ABBREVIATIONS = Object.freeze({
  mister: "Mr.", missus: "Mrs.", missus_: "Mrs.", miss: "Ms.", misses: "Mrs.",
});

const alnum = value => String(value ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const collapse = value => String(value ?? "").replace(/\s+/g, " ").trim();

/** Whether the words a proposal replaces still say the same thing, letter for letter. */
export function preservesContent(original, proposed) {
  return alnum(original) === alnum(proposed) && alnum(proposed).length > 0;
}

/**
 * Whether a malformed spoken identifier plausibly refers to a canonical one.
 *
 * Speech recognition renders a cause number as words and fragments -- "25 c v 00598DashOLG" for
 * 25-CV-00598-OLG -- so the letters cannot be required to match exactly: "Dash" is the spoken
 * hyphen. What must match is the part nobody says in words: the digits, in order. A proposal whose
 * digits differ from what was spoken is not a formatting correction, it is a different number.
 */
export function identifierMatches(original, canonicalValue) {
  const digits = value => String(value ?? "").replace(/\D/g, "");
  const spoken = digits(original), authoritative = digits(canonicalValue);
  return Boolean(authoritative) && spoken === authoritative;
}

/**
 * Whether one proposed correction may be applied, and why not when it may not.
 *
 * `original` is the text the transcript currently holds at the anchor -- read from the projection by
 * the caller, never taken from the model, so a proposal cannot describe a passage that is not there.
 * `canonicalValues` are the identifiers the deposition's own record establishes.
 *
 * @returns {{ ok:true, type:string } | { ok:false, reason:string }}
 */
export function validateFormatCorrection({ proposal, original, canonicalValues = [], nextWord = null } = {}) {
  const type = String(proposal?.correctionType ?? "").toLowerCase();
  const proposed = collapse(proposal?.proposedValue);
  const was = collapse(original);

  if (!proposal?.wordId) return { ok: false, reason: FORMAT_REFUSALS.NO_ANCHOR };
  if (!FORMAT_CORRECTION_TYPES.includes(type)) return { ok: false, reason: FORMAT_REFUSALS.UNKNOWN_TYPE };
  if (!proposed) return { ok: false, reason: FORMAT_REFUSALS.EMPTY_VALUE };
  if (proposed === was) return { ok: false, reason: FORMAT_REFUSALS.NO_CHANGE };

  if (type === "abbreviation") {
    const expected = ABBREVIATIONS[alnum(was)];
    if (!expected || expected !== proposed) return { ok: false, reason: FORMAT_REFUSALS.NOT_A_KNOWN_ABBREVIATION };
    // A courtesy title stands before a name. Without that, "miss" is as likely to be the verb.
    if (!/^\p{Lu}/u.test(String(nextWord ?? ""))) return { ok: false, reason: FORMAT_REFUSALS.NOT_A_KNOWN_ABBREVIATION };
    return { ok: true, type };
  }

  if (type === "canonical_identifier") {
    // Compared without the punctuation the sentence puts around it. A cause number at the end of a
    // sentence arrives as "25-CV-00598-OLG." and the record holds "25-CV-00598-OLG"; requiring exact
    // equality refused every real proposal while proving nothing extra. The identifier itself must
    // still match the record character for character, and the digits check below is unaffected.
    const bare = value => String(value ?? "").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    const match = canonicalValues.map(collapse).find(value => value && bare(value) === bare(proposed));
    if (!match) return { ok: false, reason: FORMAT_REFUSALS.NOT_IN_CANONICAL_RECORD };
    if (!identifierMatches(was, match)) return { ok: false, reason: FORMAT_REFUSALS.IDENTIFIER_UNRELATED };
    return { ok: true, type };
  }

  // punctuation, capitalization, tokenization: the letters and digits must survive untouched.
  if (!preservesContent(was, proposed)) return { ok: false, reason: FORMAT_REFUSALS.CONTENT_CHANGED };
  return { ok: true, type };
}
