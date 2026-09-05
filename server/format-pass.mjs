// The formatting corrections Depo-Pro can prove for itself, without asking a model.
//
// WHY DETERMINISTIC. Measured over a 75-page human-corrected transcript, 38 of 546 differences were
// legal under the format validators -- a caption, six honorifics and a cause number. Asking Claude
// to make them would cost a paid pass over 46 chunks to produce transformations the application can
// derive from its own canonical record and a table of six words. The principle this settles:
//
//     if Depo-Pro can prove the correction, it does not ask the AI to decide it.
//
// A generator here proposes; the validator in format-pass-rules.mjs still decides. Being
// deterministic is not a licence to skip validation -- a generator with a bug would otherwise write
// whatever it computed, and the validator is the only thing that has ever stood between a proposal
// and the record.
//
// WHAT IS DELIBERATELY NOT GENERATED. The corpus contains 31 punctuation differences the validators
// would admit -- a comma added here, a dash there. Those are the reporter's judgement about how a
// sentence reads, not facts the application can derive, and a rule that guessed them would be
// wrong as often as right. Legality is not derivability, and the gap between the two belongs to the
// reporter.
import { validateFormatCorrection } from "./format-pass-rules.mjs";

export const FORMAT_PASS_VERSION = "deterministic-format-v1.0.0";

const bare = value => String(value ?? "").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
const trailing = value => (String(value ?? "").match(/[^\p{L}\p{N}]+$/u) ?? [""])[0];

/**
 * An initialism the recogniser split into separate tokens: "U. S. A." for U.S.A.
 *
 * Restricted to UPPER-CASE single letters, which is what carries the finding. Lower-case runs are
 * ordinary words -- the same transcript contains "A k a", where the reporter wrote "a/k/a" rather
 * than the "A.k.a." this would have produced. A rule that cannot tell those apart should decline
 * both, so it declines on case and leaves the mixed one alone.
 */
export function joinInitialism(words, at) {
  // The period is required, not optional. Without it this joined "I I" -- a speaker stuttering the
  // pronoun -- into "I.I.", four times in one deposition, because "I" is a single capital letter.
  // A stutter turned into an initialism is invented text in a certified record. Every token in the
  // run must carry its own period, which "U. S. A." does and no disfluency does.
  const isInitial = word => /^\p{Lu}\.$/u.test(String(word?.text ?? "").replace(/[^\p{L}.]/gu, ""));
  let end = at;
  while (end + 1 < words.length && isInitial(words[end + 1])) end++;
  if (end - at < 1 || !isInitial(words[at])) return null;
  const letters = words.slice(at, end + 1).map(word => bare(word.text)).join(".");
  return { span: [at, end], proposedValue: `${letters}.${trailing(words[end].text).replace(/^\./, "")}`, correctionType: "tokenization" };
}

/** A courtesy title spoken in full, standing before a name. The table and the context both decide. */
export function abbreviateTitle(words, at) {
  const next = words[at + 1]?.text;
  const proposedValue = { mister: "Mr.", missus: "Mrs.", misses: "Mrs.", miss: "Ms." }[bare(words[at]?.text).toLowerCase()];
  if (!proposedValue || !next) return null;
  return { span: [at, at], proposedValue: `${proposedValue}${trailing(words[at].text)}`, correctionType: "abbreviation" };
}

/**
 * A canonical identifier the recogniser rendered as speech: "25 c v 00598DashOLG" for the cause
 * number the deposition's own record holds.
 *
 * Anchored on the digits, because those are the part nobody says in words. A run of tokens whose
 * combined digits equal the canonical value's digits is that identifier; anything else is not, and
 * no similarity score is consulted.
 */
export function normalizeIdentifier(words, at, canonicalValues = []) {
  const digitsOf = value => String(value ?? "").replace(/\D/g, "");
  for (const canonical of canonicalValues) {
    const target = digitsOf(canonical);
    if (target.length < 4) continue;
    let digits = "";
    for (let end = at; end < words.length && end - at < 12; end++) {
      digits += digitsOf(words[end].text);
      if (!digits) break;
      if (!target.startsWith(digits)) break;
      if (digits === target) {
        if (end === at && bare(words[at].text) === bare(canonical)) return null;
        return { span: [at, end], proposedValue: `${canonical}${trailing(words[end].text)}`, correctionType: "canonical_identifier" };
      }
    }
  }
  return null;
}

/**
 * Every formatting correction this deposition's own data proves, as overlay operations.
 *
 * `words` is the current projection in order -- read from the transcript, never from a model. Each
 * candidate is put through the same validator an AI proposal would face, and one that fails is
 * recorded with its reason rather than dropped, so a generator that starts producing rubbish is
 * visible instead of merely quiet.
 */
export function planFormatCorrections({ words = [], canonicalValues = [] } = {}) {
  const applied = [], omitted = [], operations = [];
  let index = 0;
  while (index < words.length) {
    const candidate = joinInitialism(words, index)
      ?? normalizeIdentifier(words, index, canonicalValues)
      ?? abbreviateTitle(words, index);
    if (!candidate) { index++; continue; }
    const [from, to] = candidate.span;
    const span = words.slice(from, to + 1);
    const original = span.map(word => word.text).join(" ");
    const proposal = { wordId: span[0].id, proposedValue: candidate.proposedValue, correctionType: candidate.correctionType };
    const verdict = validateFormatCorrection({
      proposal, original, canonicalValues, nextWord: words[to + 1]?.text ?? null,
    });
    if (!verdict.ok) { omitted.push({ original, proposal, reason: verdict.reason }); index = to + 1; continue; }
    operations.push({ op: "replace", wordId: span[0].id, text: candidate.proposedValue });
    for (const word of span.slice(1)) operations.push({ op: "delete", wordId: word.id });
    applied.push({ kind: "format", correctionType: candidate.correctionType, wordId: span[0].id,
      before: original, after: candidate.proposedValue, evidenceSource: candidate.correctionType === "canonical_identifier" ? "CANONICAL_RECORD" : "TRANSCRIPT_FORM" });
    index = to + 1;
  }
  return { operations, applied, omitted };
}

/** What one deterministic pass changed. Its own identity, never mistaken for AI or for a reporter. */
export function formatPassRecord({ passId, startedAt, reviewStateHash, resultingReviewStateHash, applied, omitted, operations }) {
  return {
    schemaVersion: "1.0.0",
    recordType: "DETERMINISTIC_FORMAT_PASS",
    passVersion: FORMAT_PASS_VERSION,
    passId, startedAt: startedAt ?? null, appliedAt: new Date().toISOString(),
    reviewStateHash: reviewStateHash ?? null,
    resultingReviewStateHash: resultingReviewStateHash ?? null,
    operationCount: operations.length,
    operations, applied, omitted,
    // No model was consulted, and the record says so: the authority is the deposition's own data.
    model: null,
    appliedBy: "DETERMINISTIC_FORMAT_PASS",
  };
}
