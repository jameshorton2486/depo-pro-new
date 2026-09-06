// What a deposition with a cross-examination renders as today. Phase A of §246.
//
// tests/transcript-labels.test.mjs is thorough about one examiner: Q. and A., objections that keep
// the pending question open, resumption by-lines, the first questioning attorney adopting the role.
// What no test covers is a second examiner taking over -- and cross-examination by defending
// counsel is standard practice, so that gap is the ordinary case rather than an edge.
//
// `labelParagraphs` holds a single `examinerIdentity`. Its branches, in order: witness with a
// question open -> A.; identity matching the examiner -> Q.; first questioning attorney seen adopts
// the role; any other attorney -> colloquy. Defending counsel lands in that last branch, so her
// questions are conversation and the witness's answers to her are THE WITNESS:.
//
// These tests assert that as it stands. They are expected to fail when the examination model lands,
// and failing is what makes the change visible: a characterization nobody has watched break is a
// claim about the past that nothing checks.
//
// Nothing here proposes a fix. No production code is touched by this file.
import assert from "node:assert/strict";
import test from "node:test";
import { labelParagraphs } from "../server/transcript-labels.mjs";
import { WORKING } from "./fixtures/long-deposition.mjs";

const LABELS = { alvarez: "MR. ALVAREZ", whitfield: "MS. WHITFIELD", ramirez: "MS. RAMIREZ", witness: "THE WITNESS" };
const say = (id, role, text) => ({ id: `${id}-${text.slice(0, 8)}`, speakerIdentity: id, transcriptRole: role, text });
const shape = paragraphs => labelParagraphs(paragraphs, { labels: LABELS, examinerIdentity: "alvarez" }).paragraphs
  .map(p => `${p.elementType}:${p.label ?? "-"}`);

test("direct examination by the named examiner is testimony, as it should be", () => {
  assert.deepEqual(shape([
    say("alvarez", "QUESTIONING_ATTORNEY", "Where were you going?"),
    say("witness", "WITNESS", "Home."),
  ]), ["QUESTION:Q.", "ANSWER:A."]);
});

test("cross-examination by defending counsel is not testimony today", () => {
  // The defect, stated as it currently behaves. Her question is conversation and the answer to it
  // is the witness talking, rather than Q. and A. under a CROSS-EXAMINATION heading.
  assert.deepEqual(shape([
    say("alvarez", "QUESTIONING_ATTORNEY", "Pass the witness."),
    say("witness", "WITNESS", "All right."),
    say("ramirez", "DEFENDING_ATTORNEY", "Did you see the vehicle?"),
    say("witness", "WITNESS", "I did."),
  ]), ["QUESTION:Q.", "ANSWER:A.", "COLLOQUY:MS. RAMIREZ:", "COLLOQUY:THE WITNESS:"]);
});

test("a second questioning attorney fares no better than defending counsel", () => {
  // Role is not the reason. Even an attorney whose participant role IS questioning falls to
  // colloquy, because the examiner is one identity and she is not it. The rule keys on identity,
  // so no assignment of roles fixes this from the outside.
  assert.deepEqual(shape([
    say("whitfield", "QUESTIONING_ATTORNEY", "May I follow up?"),
    say("witness", "WITNESS", "Yes."),
  ]), ["COLLOQUY:MS. WHITFIELD:", "COLLOQUY:THE WITNESS:"]);
});

test("redirect returns to the named examiner and becomes testimony again", () => {
  // The one transition that already works, and only because authority never actually moved.
  assert.deepEqual(shape([
    say("ramirez", "DEFENDING_ATTORNEY", "Nothing further."),
    say("alvarez", "QUESTIONING_ATTORNEY", "Briefly, on redirect."),
    say("witness", "WITNESS", "Understood."),
  ]), ["COLLOQUY:MS. RAMIREZ:", "QUESTION:Q.", "ANSWER:A."]);
});

test("an objection during direct keeps the question open, and must keep doing so", () => {
  // Already correct, already covered in transcript-labels.test.mjs, and repeated here for one
  // reason: the examination model must not break it. An implementation that tracks the active
  // examiner but clears the pending question on colloquy would pass every test above and turn
  // every answer following an objection into THE WITNESS:.
  assert.deepEqual(shape([
    say("alvarez", "QUESTIONING_ATTORNEY", "Did you see the vehicle?"),
    say("ramirez", "DEFENDING_ATTORNEY", "Objection, form."),
    say("witness", "WITNESS", "Yes."),
  ]), ["QUESTION:Q.", "COLLOQUY:MS. RAMIREZ:", "ANSWER:A."]);
});

test("the reporter interjecting closes the question, and the witness is not answering", () => {
  assert.deepEqual(shape([
    say("alvarez", "QUESTIONING_ATTORNEY", "Did you see the vehicle?"),
    say("reporter", "COURT_REPORTER", "I am sorry, could you repeat that?"),
    say("witness", "WITNESS", "I said yes."),
  ]), ["QUESTION:Q.", "COLLOQUY:-", "COLLOQUY:THE WITNESS:"]);
});

// Scale. The unit cases show the rule; this shows what it costs on a deposition, which is the
// argument for solving it structurally rather than by correcting paragraphs.
test("on a realistic deposition the correction is hundreds of paragraphs, not a few", () => {
  let crossTurns = 0, answersToCross = 0, previousWasCross = false;
  for (const segment of WORKING.segments) {
    if (segment.speakerIdentity === "counsel-whitfield") { crossTurns += 1; previousWasCross = true; continue }
    if (segment.transcriptRole === "WITNESS" && previousWasCross) { answersToCross += 1; continue }
    if (segment.transcriptRole !== "WITNESS") previousWasCross = false;
  }
  const affected = crossTurns + answersToCross;
  assert.ok(crossTurns > 0, "the fixture must contain a second examiner or it characterizes nothing");
  assert.equal(affected, 450, "the measured cost of the missing examination model");
  assert.ok(affected / WORKING.segments.length > 0.25,
    `${affected} of ${WORKING.segments.length} paragraphs is the scale that rules out per-paragraph correction`);
});
