// A model may propose where examination begins. It may not decide it.
//
// The division this file defends:
//
//   AI proposes            -- the transition is linguistic, and a rule cannot recognise it
//   the validator decides  -- against the deposition's own record, never against the proposal
//   the labeller reads     -- the resulting boundary, and nothing else
//   the reporter overrules -- absolutely, and without being outvoted
//
// The model never labels a paragraph, never writes a heading and never puts a word on the page. It
// answers one question -- which word does this examination begin at, and who is conducting it --
// and every answer is checked against facts it did not supply.
import assert from "node:assert/strict";
import test from "node:test";
import { BOUNDARY_REFUSALS, planExaminationBoundaries, validateExaminationBoundary } from "../server/examination-boundary-rules.mjs";

const HASH = "state-abc";
const PARTICIPANTS = [
  { id:"nunez", defaultRole:"QUESTIONING_ATTORNEY" },
  { id:"zhan", defaultRole:"DEFENDING_ATTORNEY" },
  { id:"witness", defaultRole:"WITNESS" },
  { id:"reporter", defaultRole:"COURT_REPORTER" },
  { id:"video", defaultRole:"VIDEOGRAPHER" },
];
const PRINTED = ["w1", "w2", "w3", "w4"];
const propose = (extra = {}) => ({ atWordId:"w3", examinerPersonId:"nunez", type:"DIRECT", reviewStateHash:HASH, ...extra });
const check = (proposal, options = {}) => validateExaminationBoundary({
  proposal, printedWordIds:PRINTED, participants:PARTICIPANTS, reviewStateHash:HASH, ...options });

test("a supported proposal becomes a boundary, and nothing more", () => {
  const verdict = check(propose());
  assert.deepEqual(verdict, { ok:true, boundary:{ atWordId:"w3", examinerPersonId:"nunez", type:"DIRECT" } });
  // Three fields. No heading text, no label, no paragraph -- the proposal cannot carry anything
  // onto the page, because a boundary is all the labeller reads.
  assert.deepEqual(Object.keys(verdict.boundary), ["atWordId", "examinerPersonId", "type"]);
});

test("the anchor must be a word the transcript actually holds", () => {
  assert.equal(check(propose({ atWordId:"" })).reason, BOUNDARY_REFUSALS.NO_ANCHOR);
  assert.equal(check(propose({ atWordId:"invented" })).reason, BOUNDARY_REFUSALS.ANCHOR_NOT_IN_TRANSCRIPT,
    "a model that names a word nobody said cannot anchor anything to it");
});

test("a struck anchor is refused, and says so distinctly", () => {
  // The reporter struck the word after the analysis ran. That is a different problem from an
  // invented anchor and has a different remedy, so it must not arrive as the same refusal.
  const verdict = check(propose({ atWordId:"w9" }), { printedWordIds:PRINTED, knownWordIds:[...PRINTED, "w9"] });
  assert.equal(verdict.reason, BOUNDARY_REFUSALS.ANCHOR_NOT_PRINTED);
});

test("the examiner must be somebody the canonical record already holds", () => {
  assert.equal(check(propose({ examinerPersonId:"" })).reason, BOUNDARY_REFUSALS.NO_EXAMINER);
  assert.equal(check(propose({ examinerPersonId:"counsel-nobody" })).reason, BOUNDARY_REFUSALS.EXAMINER_NOT_A_PARTICIPANT,
    "a structural fact naming a person the deposition does not list is evidence of nothing");
});

test("only counsel examine", () => {
  for (const id of ["witness", "reporter", "video"]) {
    assert.equal(check(propose({ examinerPersonId:id })).reason, BOUNDARY_REFUSALS.EXAMINER_NOT_COUNSEL, id);
  }
  // Defending counsel may examine -- that is what a cross-examination is.
  assert.equal(check(propose({ examinerPersonId:"zhan", type:"CROSS" })).ok, true);
});

test("a stale proposal fails closed", () => {
  // The transcript moved after the model read it. Every other check would now be run against
  // different words than the model saw, so passing them would prove nothing.
  assert.equal(check(propose({ reviewStateHash:"a-different-state" })).reason, BOUNDARY_REFUSALS.STALE_ANALYSIS);
  assert.equal(check(propose({ reviewStateHash:"" })).reason, BOUNDARY_REFUSALS.STALE_ANALYSIS,
    "and a proposal that claims no state at all is not tied to one");
  assert.equal(check({ ...propose(), reviewStateHash:undefined }).reason, BOUNDARY_REFUSALS.STALE_ANALYSIS);
});

test("staleness is checked before anything else, so a stale proposal cannot pass on old facts", () => {
  // A proposal whose anchor and examiner are both wrong AND which is stale must report staleness.
  // Checking the anchor first would have compared a word the model never read against a transcript
  // it never saw, and reported that comparison as though it meant something.
  assert.equal(check(propose({ atWordId:"invented", examinerPersonId:"nobody", reviewStateHash:"old" })).reason,
    BOUNDARY_REFUSALS.STALE_ANALYSIS);
});

test("an examination type nobody defined is not a licence", () => {
  assert.equal(check(propose({ type:"OPENING" })).reason, BOUNDARY_REFUSALS.UNKNOWN_TYPE);
  // Absent and blank are different. A field the model omitted means the ordinary case; a field it
  // sent empty is malformed, and defaulting it would be inventing an answer for a broken response.
  assert.equal(check(propose({ type:undefined })).ok, true, "absent means DIRECT");
  assert.equal(check(propose({ type:"" })).reason, BOUNDARY_REFUSALS.UNKNOWN_TYPE, "blank is malformed, not absent");
  assert.equal(check(propose({ type:"direct" })).ok, true, "and case is not what makes it valid");
});

// --- authority ----------------------------------------------------------------------------------

test("a reporter boundary is not outvoted, it is unchallenged", () => {
  // Anchored somewhere else entirely: the reporter said the direct examination begins at w1, the
  // model thinks w3. There is no reconciliation to perform -- the question is closed.
  const reporter = [{ atWordId:"w1", examinerPersonId:"nunez", type:"DIRECT" }];
  assert.equal(check(propose(), { existingBoundaries:reporter }).reason, BOUNDARY_REFUSALS.REPORTER_BOUNDARY_EXISTS);
});

test("a boundary with no recorded provenance is treated as the reporter's", () => {
  // The overlay does not record who made an examination operation. Absence of provenance is
  // ambiguous, and the conservative reading of an ambiguous authority refuses.
  const anonymous = [{ atWordId:"w1", examinerPersonId:"nunez", type:"DIRECT" }];
  assert.equal(check(propose(), { existingBoundaries:anonymous }).ok, false);
});

test("a reporter boundary on a different examination does not block this one", () => {
  // The reporter marked the cross. That says nothing about where the direct began, and refusing
  // here would leave the first examination permanently underived.
  const cross = [{ atWordId:"w4", examinerPersonId:"zhan", type:"CROSS" }];
  assert.equal(check(propose(), { existingBoundaries:cross }).ok, true);
});

test("re-analysing an unchanged transcript adds nothing", () => {
  // What one-click idempotence rests on. The pass ran, its boundary stands, and running it again
  // must not produce a second heading for the same examination.
  const mine = [{ atWordId:"w3", examinerPersonId:"nunez", type:"DIRECT", source:"AI" }];
  assert.equal(check(propose(), { existingBoundaries:mine }).reason, BOUNDARY_REFUSALS.DUPLICATE_BOUNDARY);
});

test("the model does not get to move a boundary that already exists", () => {
  const mine = [{ atWordId:"w1", examinerPersonId:"nunez", type:"DIRECT", source:"AI" }];
  assert.equal(check(propose(), { existingBoundaries:mine }).reason, BOUNDARY_REFUSALS.DUPLICATE_BOUNDARY,
    "one examination of a type is one examination; correcting it is the reporter's act");
});

// --- planning a whole response -------------------------------------------------------------------

test("two proposals cannot both claim the same examination", () => {
  const plan = planExaminationBoundaries({
    proposals:[propose(), propose({ atWordId:"w4" })],
    printedWordIds:PRINTED, participants:PARTICIPANTS, reviewStateHash:HASH,
  });
  assert.equal(plan.operations.length, 1, "the first is recorded");
  assert.equal(plan.omitted.length, 1);
  assert.equal(plan.omitted[0].reason, BOUNDARY_REFUSALS.DUPLICATE_BOUNDARY, "and the second is refused against it");
});

test("what it produces is an overlay operation, attributable to the analysis", () => {
  const plan = planExaminationBoundaries({ proposals:[propose()], printedWordIds:PRINTED, participants:PARTICIPANTS, reviewStateHash:HASH });
  assert.deepEqual(plan.operations, [{ op:"examination", atWordId:"w3", examinerPersonId:"nunez", type:"DIRECT" }]);
  assert.equal(plan.applied[0].evidenceSource, "AI_STRUCTURAL_ANALYSIS",
    "auditable as AI-derived, so the reporter can tell it from their own boundary");
});

test("a refused proposal is recorded with its reason, not dropped", () => {
  // A model that starts proposing rubbish must be visible rather than merely quiet.
  const plan = planExaminationBoundaries({
    proposals:[propose({ examinerPersonId:"witness" }), propose({ atWordId:"invented" })],
    printedWordIds:PRINTED, participants:PARTICIPANTS, reviewStateHash:HASH,
  });
  assert.equal(plan.operations.length, 0);
  assert.deepEqual(plan.omitted.map(item => item.reason),
    [BOUNDARY_REFUSALS.EXAMINER_NOT_COUNSEL, BOUNDARY_REFUSALS.ANCHOR_NOT_IN_TRANSCRIPT]);
});

test("a cross and a direct in one response are both recorded", () => {
  const plan = planExaminationBoundaries({
    proposals:[propose(), propose({ atWordId:"w4", examinerPersonId:"zhan", type:"CROSS" })],
    printedWordIds:PRINTED, participants:PARTICIPANTS, reviewStateHash:HASH,
  });
  assert.deepEqual(plan.operations.map(item => item.type), ["DIRECT", "CROSS"]);
});
