// Depo-Pro makes the formatting corrections it can prove, and asks nobody.
//
// Measured over a 75-page human-corrected transcript: 38 of 546 differences were legal under the
// format validators -- a caption, six honorifics, a cause number. Paying for a Claude pass over 46
// chunks to produce those would buy variability, not judgement. The principle:
//
//     if Depo-Pro can prove the correction, it does not ask the AI to decide it.
//
// Being deterministic is not a licence to skip validation. Every candidate below goes through the
// same validator an AI proposal faces, so a generator with a bug is refused rather than trusted.
import assert from "node:assert/strict";
import test from "node:test";
import { appendTransaction, emptyOverlay, undoLastTransaction } from "../server/reporter-overlay.mjs";
import { abbreviateTitle, formatPassRecord, joinInitialism, normalizeIdentifier, planFormatCorrections } from "../server/format-pass.mjs";

const CAUSE = "25-CV-00598-OLG";
const say = text => text.split(" ").map((word, i) => ({ id: `w${i}`, text: word }));
const plan = (text, canonicalValues = [CAUSE]) => planFormatCorrections({ words: say(text), canonicalValues });

test("an initialism the recogniser split apart is put back together", () => {
  const result = plan("Home Depot U. S. A. Inc.");
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].before, "U. S. A.");
  assert.equal(result.applied[0].after, "U.S.A.");
  assert.equal(result.applied[0].correctionType, "tokenization");
  // One replace and the rest deleted, so the words it merged are accounted for.
  assert.deepEqual(result.operations.map(o => o.op), ["replace", "delete", "delete"]);
});

test("a lower-case run is left alone, because the application cannot tell what it is", () => {
  // The same transcript contains "A k a", where the reporter wrote "a/k/a" -- not the "A.k.a." this
  // would otherwise produce. A rule that cannot distinguish them should decline, and declines here
  // on case rather than on a guess about the phrase.
  assert.equal(plan("Inc. A k a, The Home Depot").applied.length, 0);
  assert.equal(plan("the a b c of it").applied.length, 0);
});

test("a stutter is not an initialism", () => {
  // FOUND BY MEASUREMENT, not by review. The first version of this joiner turned "I I" into "I.I."
  // -- four times in one deposition -- because "I" is a single capital letter. A speaker repeating
  // the pronoun is a disfluency the transcript must keep, and joining it invents text nobody said.
  assert.equal(plan("So I I mean, I did not").applied.length, 0);
  assert.equal(plan("I I don't know.").applied.length, 0);
  assert.equal(joinInitialism(say("I I don't"), 0), null);
  // The period is what separates an initial from a word, and the real caption has one on each.
  assert.equal(joinInitialism(say("U. S. A."), 0).proposedValue, "U.S.A.");
  assert.equal(joinInitialism(say("U S A"), 0), null, "no periods, no proof it is an initialism");
});

test("a canonical identifier is rebuilt from the record, anchored on its digits", () => {
  const result = plan("Civil action number 25 c v 00598DashOLG.");
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].before, "25 c v 00598DashOLG.");
  assert.equal(result.applied[0].after, "25-CV-00598-OLG.", "and it keeps the sentence's period");
  assert.equal(result.applied[0].evidenceSource, "CANONICAL_RECORD");
});

test("an identifier the record does not hold is not invented", () => {
  assert.equal(plan("case number 99 c v 12345 abc", [CAUSE]).applied.length, 0);
  assert.equal(plan("Civil action number 25 c v 00598DashOLG.", []).applied.length, 0,
    "with no canonical record there is no authority to correct against");
});

test("a number that merely contains the digits is not the cause number", () => {
  // Anchored on the WHOLE digit sequence, so an ordinary number cannot absorb the identifier.
  assert.equal(plan("we received 25 boxes").applied.length, 0);
  assert.equal(normalizeIdentifier(say("in 2005 98 items"), 1, [CAUSE]), null);
});

test("a courtesy title is abbreviated only in front of a name", () => {
  assert.equal(plan("Good afternoon, mister Nunez.").applied[0].after, "Mr.");
  assert.equal(plan("I did not miss the meeting").applied.length, 0, "miss is a verb here");
  assert.equal(abbreviateTitle(say("mister"), 0), null, "and nothing follows it at all");
});

test("the deterministic generator does not get to skip the validator", () => {
  // A generator proposing something the validator refuses must be recorded and dropped, not applied.
  // Asserted through the public plan: a title before a lower-case word never reaches operations.
  const result = plan("please do not miss the deposition");
  assert.equal(result.operations.length, 0);
  assert.equal(result.applied.length, 0);
});

test("it cannot invent speech, whatever the transcript looks like", () => {
  // The corpus contains 134 places where the corrected document holds words the recogniser never
  // captured -- and the oath is the one that matters. Nothing here can add a word.
  for (const text of ["truth so happy God?", "Who?", "the witness said"]) {
    const result = plan(text);
    assert.equal(result.applied.length, 0, `${JSON.stringify(text)} must be left exactly as spoken`);
    assert.equal(result.operations.length, 0);
  }
});

test("it cannot delete a spoken word, however the reporter's document reads", () => {
  // The corrected document omits "Yep." where the recording has it. That is editorial judgement and
  // must never become a deterministic rule.
  const result = plan("Yep. Steven Nunez for Plaintiff");
  assert.equal(result.applied.length, 0);
  assert.equal(result.operations.filter(o => o.op === "delete").length, 0);
});

test("a whole caption is corrected in one pass", () => {
  const result = plan("versus Home Depot U. S. A. Inc. and Shawn Herber. Civil action number 25 c v 00598DashOLG. Before mister Nunez.");
  assert.deepEqual(result.applied.map(item => item.after), ["U.S.A.", "25-CV-00598-OLG.", "Mr."]);
  assert.equal(result.omitted.length, 0);
});

test("the pass is one transaction, and one Undo takes it back", () => {
  const result = plan("Home Depot U. S. A. Inc.");
  const overlay = appendTransaction(emptyOverlay("DEP-1"), result.operations);
  assert.deepEqual(overlay.transactionSizes, [3]);
  assert.deepEqual(undoLastTransaction(overlay).overlay.operations, []);
});

test("the pass says who made it, and it was not a model or a reporter", () => {
  const result = plan("Home Depot U. S. A. Inc.");
  const record = formatPassRecord({ passId: "p1", startedAt: "2026-09-05T00:00:00.000Z",
    reviewStateHash: "before", resultingReviewStateHash: "after", ...result });
  assert.equal(record.recordType, "DETERMINISTIC_FORMAT_PASS");
  assert.equal(record.appliedBy, "DETERMINISTIC_FORMAT_PASS");
  assert.equal(record.model, null, "no model was consulted and the record says so");
  assert.equal(record.reviewStateHash, "before");
  assert.equal(record.resultingReviewStateHash, "after");
  assert.equal(record.operationCount, record.operations.length);
});
