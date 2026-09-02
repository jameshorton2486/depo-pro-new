// Accepting one range proposal, on the server, as one act.
//
// The client sends which proposal the reporter accepted. It does not send operations, and it is not
// trusted to have worked out what they would be. Everything between "the reporter said yes" and
// "the overlay changed" happens here.
//
// HOW THE PROJECTION IS RECOVERED, which is the question Phase A left open.
//
// A range is a pair of word ids, and word ids do not move. But WHICH SEGMENT holds a word does
// move -- a split puts the same word at the head of a new segment -- so the plan for a range
// depends on the segment projection it is planned against. Planning against a projection the
// reporter has since changed would emit operations that cut in the wrong places.
//
// There is no snapshot to store, because the review-state hash already answers it. That hash is
// taken over the stored transcript, the speaker map, and every overlay operation in order -- which
// is exactly the input set applyOverlay reduces to a segment projection. So:
//
//     carried hash === current hash  =>  the current projection IS the analyzed projection
//
// and the proposal may be planned against what is on disk now. A difference in either direction
// means the projection has moved, and the proposal is REFUSED. It is never rebased onto the new
// one: the reporter accepted a range of words shown in a particular arrangement, and re-resolving
// it against a different arrangement accepts something they never saw.
//
// ATOMICITY. planRangeAcceptance may return up to four operations for one accepted range. They are
// appended as ONE transaction, so undo removes the whole plan and redo restores the whole plan.
// Nothing is written until the plan is complete and valid; a plan that cannot be made writes
// nothing at all.
import { planRangeAcceptance } from "./range-acceptance-planner.mjs";
import { applyOverlay, emptyOverlay } from "./reporter-overlay.mjs";
import { STALE_CORRECTION_PROPOSAL, assertProposalIsCurrent, computeReviewStateHash } from "./review-state-hash.mjs";

export const RANGE_ACCEPTANCE_REFUSED = "RANGE_ACCEPTANCE_REFUSED";

/** A refusal carries its reason as a code, because the reporter is owed the actual cause. */
function refuse(reason, detail = {}) {
  const error = new Error(MESSAGES[reason] ?? "This speaker proposal cannot be applied.");
  error.code = reason === STALE_CORRECTION_PROPOSAL ? STALE_CORRECTION_PROPOSAL : RANGE_ACCEPTANCE_REFUSED;
  error.reason = reason;
  Object.assign(error, detail);
  return error;
}

const MESSAGES = {
  [STALE_CORRECTION_PROPOSAL]: "The transcript changed after this proposal was generated. Re-run the speaker-range pass; this proposal cannot be applied to the current record.",
  IDENTITY_NOT_IN_ROSTER: "That speaker is not a participant in this deposition.",
  SPEAKER_REQUIRED: "A speaker proposal with no participant cannot be applied.",
  RANGE_INCOMPLETE: "This proposal does not carry both ends of its range.",
  START_WORD_NOT_FOUND: "The first word of this range is no longer in the transcript.",
  END_WORD_NOT_FOUND: "The last word of this range is no longer in the transcript.",
  END_PRECEDES_START: "This proposal's range runs backwards.",
  NOT_A_SPEAKER_RANGE: "Only a speaker-range proposal can be applied this way.",
};

/**
 * Turns one accepted proposal into one reporter transaction.
 *
 * Every gate is checked before anything is written, and a failure at any of them writes nothing.
 *
 * @param {object} deps store access, injected so this is testable without a filesystem
 * @returns {{overlay:object, operations:object[], reviewStateHash:string}}
 */
export function acceptRangeProposal(root, {
  depositionId, storageRoot, proposal, expectedReviewStateHash = null,
  getWorkingTranscript, readReporterOverlay, getSpeakerCandidates, appendReporterOperations,
} = {}) {
  if (proposal?.correctionType !== "speaker_assignment") throw refuse("NOT_A_SPEAKER_RANGE");

  const store = { depositionId, storageRoot };
  const transcript = getWorkingTranscript(root, store);
  const overlay = readReporterOverlay(root, store);
  const current = computeReviewStateHash({ transcript, overlay });

  // Two hashes must agree with the current state, and they are not the same question. The proposal
  // carries the state it was ANALYZED against; the client carries the state the reporter was
  // LOOKING AT when they pressed Accept. A proposal generated against a stale transcript and a
  // reporter acting on a stale screen are different failures, and both end the same way.
  const currency = assertProposalIsCurrent(proposal, current);
  if (!currency.ok) throw refuse(STALE_CORRECTION_PROPOSAL, { expected: current, carried: currency.carried });
  if (expectedReviewStateHash !== null && expectedReviewStateHash !== current) {
    throw refuse(STALE_CORRECTION_PROPOSAL, { expected: current, carried: expectedReviewStateHash });
  }

  // The roster is re-checked here even though the validator checked it when the proposal was made.
  // A participant can be removed from the record between the two, and the validator's verdict was
  // about the roster as it stood then.
  const { candidates } = getSpeakerCandidates(root, store);
  const person = candidates.find(item => item.id === proposal.speakerIdentity);
  if (!person) throw refuse("IDENTITY_NOT_IN_ROSTER", { attemptedIdentity: proposal.speakerIdentity ?? null });

  // The projection the proposal was analyzed against, which the hash agreement above proves this is.
  const projection = applyOverlay(transcript?.segments ?? [], overlay ?? emptyOverlay(depositionId));

  const plan = planRangeAcceptance(projection.segments, {
    startWordId: proposal.wordId,
    endWordId: proposal.endWordId ?? proposal.wordId,
    speakerIdentity: person.id,
    // The role the record already gives this person. The pass has no authority to propose one and
    // its schema has no field for it, so there is nothing here to override.
    transcriptRole: person.defaultRole || null,
  });
  if (!plan.ok) throw refuse(plan.reason);

  const saved = appendReporterOperations(root, {
    depositionId, storageRoot,
    operations: plan.operations,
    expectedReviewStateHash: current,
  });
  return { overlay: saved, operations: plan.operations, reviewStateHash: current };
}
