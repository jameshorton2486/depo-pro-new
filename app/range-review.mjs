// What a reporter has to see before accepting a range, and what happens to the rest afterwards.
//
// This is in a module rather than inside the component because both of those are rules, and a rule
// inside JSX is a rule nothing can check.
//
// A range proposal and a whole-cluster proposal are different claims. "Machine speaker 3 is the
// witness" asks the reporter to believe something about 163 words they have not read; "these four
// words are the witness" asks them to believe something they can read on the screen. The review
// surface must not blur them, so a range summary always says which it is.

/** Stable across a re-render, and unique: two proposals may not claim the same words. */
export const rangeProposalKey = proposal => `${proposal?.wordId ?? ""}:${proposal?.endWordId ?? ""}`;

/**
 * The fields the reporter is owed, gathered in one place so a missing one is a test failure rather
 * than a blank space on a screen.
 *
 * `label` falls back to the raw identity rather than to a friendly placeholder. A participant id
 * showing through is a bug worth seeing; "Unknown speaker" would hide it behind something that
 * reads as deliberate.
 */
export function rangeProposalSummary(proposal, candidates = []) {
  const find = id => candidates.find(item => item.id === id) ?? null;
  const proposed = find(proposal?.speakerIdentity);
  const currently = find(proposal?.currentSpeakerIdentity);
  return {
    key: rangeProposalKey(proposal),
    proposalLevel: "RANGE",
    text: proposal?.text ?? "",
    wordCount: proposal?.wordCount ?? 0,
    speakerIdentity: proposal?.speakerIdentity ?? null,
    speakerLabel: proposed?.label ?? proposal?.speakerIdentity ?? null,
    speakerRole: proposed?.defaultRole ?? null,
    // Stated even when there is none, because "currently unattributed" is the common case and the
    // reporter should not have to infer it from an absence.
    currentSpeakerLabel: currently?.label ?? proposal?.currentSpeakerIdentity ?? null,
    startTime: proposal?.startTime ?? null,
    endTime: proposal?.endTime ?? null,
    // What the machine thought, kept beside what the model claims so the two can be weighed.
    deepgramSpeakers: proposal?.deepgramSpeakers ?? [],
    confidenceScore: proposal?.confidenceScore ?? null,
    evidenceSource: proposal?.evidenceSource ?? null,
  };
}

/**
 * The proposals still offerable after one has been accepted, which is none of them.
 *
 * Every proposal in a pass carries the review-state hash of the transcript it was generated
 * against, and accepting one changes that state. So the others are stale the moment the first is
 * applied -- the server will refuse them, correctly. Leaving them on the screen would offer the
 * reporter a row of buttons that all fail, and imply the pass found work still to do.
 *
 * The reporter runs the pass again. That is the honest answer and it is cheap.
 */
export function remainingAfterAcceptance() {
  return [];
}

/**
 * What an empty list means, which is not one thing.
 *
 * Found in the browser gate: after accepting a proposal the list clears, and the empty state read
 * "No speaker ranges were proposed." Three had been, and one had just been applied. A screen that
 * says nothing was found when something was is worse than one that says nothing at all.
 */
export function emptyRangeListMessage({ accepted = false } = {}) {
  return accepted
    ? "Applied. The other proposals were made against the transcript as it was before this change, so they are no longer offered. Run the check again to see what remains."
    : "No speaker ranges were proposed.";
}

/** Rejecting is a local act: the proposal leaves the screen and the transcript never knew of it. */
export function remainingAfterRejection(proposals = [], rejected) {
  const key = rangeProposalKey(rejected);
  return proposals.filter(item => rangeProposalKey(item) !== key);
}
