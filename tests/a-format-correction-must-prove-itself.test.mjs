// A formatting correction is admitted because it can be proven, never because Claude proposed it.
//
// Measured against a 75-page human-corrected Heath Thomas transcript: 546 differences separated the
// machine transcript from the reporter's, and the entity pass -- restricted to spellings of names
// from the deposition's own list -- was structurally permitted to attempt about 89 of them. The rest
// were formatting: "U. S. A. Inc. A k a," and "25 c v 00598DashOLG" are not names.
//
// The invariant this file defends is that a formatting correction changes how words are written and
// not which words they are. Everything that changes a word is refused here, including the two the
// human transcript happens to answer -- "so happy" was "so help you", and "Who?" was "I do." Three
// AI passes refused both and were right to. Knowing the answers afterwards does not authorise
// guessing them beforehand.
import assert from "node:assert/strict";
import test from "node:test";
import {
  ABBREVIATIONS, FORMAT_CORRECTION_TYPES, FORMAT_REFUSALS,
  identifierMatches, preservesContent, validateFormatCorrection,
} from "../server/format-pass-rules.mjs";

const CAUSE = "25-CV-00598-OLG";
const check = (original, proposedValue, correctionType, extra = {}) =>
  validateFormatCorrection({ proposal: { wordId: "w1", proposedValue, correctionType }, original, canonicalValues: [CAUSE], ...extra });

test("punctuation and capitalisation pass when the letters survive", () => {
  assert.deepEqual(check("federal rules.", "Federal Rules.", "capitalization"), { ok: true, type: "capitalization" });
  assert.deepEqual(check("transcript", "transcript,", "punctuation"), { ok: true, type: "punctuation" });
  assert.deepEqual(check("Herber defendants.", "Herber, Defendants.", "punctuation"), { ok: true, type: "punctuation" });
});

test("an ASR that split one token into several may be put back together", () => {
  // The case the entity pass cannot touch, because none of this is a name.
  assert.deepEqual(check("U. S. A. Inc. A k a,", "U.S.A., Inc., a.k.a.", "tokenization"), { ok: true, type: "tokenization" });
  assert.deepEqual(check("1 9 6 8.", "1968.", "tokenization"), { ok: true, type: "tokenization" });
});

test("a proposal that changes a word is refused whatever class it claims", () => {
  // THE CENTRAL GUARD. Every formatting class asserts the same thing: the letters and digits are
  // the transcript's, and only their presentation is in question.
  for (const type of ["punctuation", "capitalization", "tokenization"]) {
    assert.equal(check("so happy God?", "so help you God?", type).reason, FORMAT_REFUSALS.CONTENT_CHANGED,
      `${type} must not be able to rewrite the oath`);
    assert.equal(check("Who?", "I do.", type).reason, FORMAT_REFUSALS.CONTENT_CHANGED,
      `${type} must not be able to answer for the witness`);
    assert.equal(check("I am", "I'm", type).reason, FORMAT_REFUSALS.CONTENT_CHANGED, "nor contract what was said");
    assert.equal(check("wasn't", "was", type).reason, FORMAT_REFUSALS.CONTENT_CHANGED, "nor reverse it");
  }
});

test("a deletion cannot arrive dressed as formatting", () => {
  // The corrected document omits "Yep." where the recording has it. That is a reporter's editorial
  // judgement, and it must never become an automatic correction.
  assert.equal(check("Yep. Steven", "Steven", "punctuation").reason, FORMAT_REFUSALS.CONTENT_CHANGED);
  assert.equal(check("Yep.", "", "punctuation").reason, FORMAT_REFUSALS.EMPTY_VALUE);
});

test("a canonical identifier is authorised by the record, not by the model", () => {
  assert.deepEqual(check("25 c v 00598DashOLG.", CAUSE, "canonical_identifier"), { ok: true, type: "canonical_identifier" });
  // A cause number at the end of a sentence arrives with the sentence's period. Requiring exact
  // equality with the record refused every real proposal while proving nothing extra.
  assert.deepEqual(check("25 c v 00598DashOLG.", CAUSE + ".", "canonical_identifier"), { ok: true, type: "canonical_identifier" });
  // The identifier itself must still match the record character for character.
  assert.equal(check("25 c v 00598DashOLG.", "25-CV-598-OLG.", "canonical_identifier").reason,
    FORMAT_REFUSALS.NOT_IN_CANONICAL_RECORD);
  // Not in the record: refused even though it looks like a cause number.
  assert.equal(check("25 c v 00598DashOLG.", "25-CV-00599-OLG", "canonical_identifier").reason,
    FORMAT_REFUSALS.NOT_IN_CANONICAL_RECORD);
  // In the record, but the spoken digits are somebody else's number.
  assert.equal(check("24 c v 11111 abc", CAUSE, "canonical_identifier").reason,
    FORMAT_REFUSALS.IDENTIFIER_UNRELATED);
});

test("the digits are what an identifier must keep", () => {
  // "Dash" is the spoken hyphen, so letters cannot be required to match. Digits can.
  assert.equal(identifierMatches("25 c v 00598DashOLG.", CAUSE), true);
  assert.equal(identifierMatches("25 c v 00599DashOLG.", CAUSE), false);
  assert.equal(identifierMatches("no digits here", CAUSE), false);
  assert.equal(identifierMatches("25 c v 00598", ""), false, "no canonical value, no authority");
});

test("abbreviations come from a table, and only before a name", () => {
  assert.deepEqual(check("mister", "Mr.", "abbreviation", { nextWord: "Nunez" }), { ok: true, type: "abbreviation" });
  assert.deepEqual(check("Mister", "Mr.", "abbreviation", { nextWord: "Thomas" }), { ok: true, type: "abbreviation" });
  // "miss" before a lower-case word is the verb, not a courtesy title.
  assert.equal(check("miss", "Ms.", "abbreviation", { nextWord: "the" }).reason, FORMAT_REFUSALS.NOT_A_KNOWN_ABBREVIATION);
  assert.equal(check("miss", "Ms.", "abbreviation").reason, FORMAT_REFUSALS.NOT_A_KNOWN_ABBREVIATION, "and never with nothing after it");
  // Not in the table: refused, however plausible.
  assert.equal(check("doctor", "Dr.", "abbreviation", { nextWord: "Okonkwo" }).reason, FORMAT_REFUSALS.NOT_A_KNOWN_ABBREVIATION,
    "doctor is a profession as often as a title, and shortening both would rewrite testimony");
  assert.equal(check("mister", "Monsieur", "abbreviation", { nextWord: "Nunez" }).reason, FORMAT_REFUSALS.NOT_A_KNOWN_ABBREVIATION);
});

test("a class nobody defined is not a licence", () => {
  assert.equal(check("anything", "something", "meaning").reason, FORMAT_REFUSALS.UNKNOWN_TYPE);
  assert.equal(check("anything", "something", "").reason, FORMAT_REFUSALS.UNKNOWN_TYPE);
  assert.equal(check("anything", "something", "spelling").reason, FORMAT_REFUSALS.UNKNOWN_TYPE,
    "spellings belong to the entity pass, which checks them against the name list");
});

test("a proposal with no anchor corrects nothing", () => {
  assert.equal(validateFormatCorrection({ proposal: { proposedValue: "Federal Rules.", correctionType: "capitalization" }, original: "federal rules." }).reason,
    FORMAT_REFUSALS.NO_ANCHOR);
});

test("a proposal that changes nothing is not a correction", () => {
  assert.equal(check("Federal Rules.", "Federal Rules.", "capitalization").reason, FORMAT_REFUSALS.NO_CHANGE);
  assert.equal(check("Federal Rules.", "  Federal Rules.  ", "capitalization").reason, FORMAT_REFUSALS.NO_CHANGE,
    "and whitespace alone is not a change worth an operation");
});

test("the content check is the property, not a list of examples", () => {
  assert.equal(preservesContent("U. S. A.", "U.S.A."), true);
  assert.equal(preservesContent("a k a", "a.k.a."), true);
  assert.equal(preservesContent("so happy", "so help you"), false);
  assert.equal(preservesContent("", ""), false, "nothing is not preserved content");
  assert.equal(preservesContent("word", ""), false);
});

test("every declared type has a validator that can refuse it", () => {
  // Guards against a class being added to the vocabulary without a rule behind it -- a prompt
  // saying something is allowed is not a validator.
  for (const type of FORMAT_CORRECTION_TYPES) {
    const refusal = check("so happy God?", "so help you God?", type);
    assert.equal(refusal.ok, false, `${type} admitted a correction that changes the words`);
  }
  assert.ok(Object.keys(ABBREVIATIONS).length > 0);
});
