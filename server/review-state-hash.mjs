// The identity of the transcript a correction run was generated against.
//
// transcriptContentHash answers "which stored projection is this" -- segments and speaker map,
// nothing else. That is the right question for a rebuild and the wrong one for a correction
// pass, because the reporter's overlay lives beside working.json and is applied at render. Two
// transcripts differing only by a deletion carry the same transcriptContentHash, so a pass
// invalidating against it alone would treat an edited transcript as unedited and keep proposals
// anchored to text the reporter has since struck.
//
// This is the other question: what was the reporter looking at, and can a proposal generated
// then still be applied now. It does not replace transcriptContentHash and does not change its
// meaning -- both are returned, and they answer different things.
//
// What it covers, and the rule for deciding: anything that can change what a correction targets.
// The stored projection, the speaker assignments, and every reporter operation. What it must not
// cover: anything that cannot. Which paragraph is selected, where the cursor sits, whether audio
// is playing, which panel is open -- none of that changes the transcript, and folding it in would
// invalidate every pending proposal on a scroll.
//
// Two deliberate exclusions inside covered structures, both for the same reason:
//
//   reconciledAt and updatedAt. Reconciliation writes a fresh timestamp every time it runs, so
//   including it would invalidate every pending proposal when a reporter re-saves an unchanged
//   speaker map. A timestamp moving without an assignment changing is not a change to the
//   correction target.
//
//   Rendered text. It carries style and presentation -- April 24, 2026 for 04/24/2026 -- so
//   hashing it would make a change to transcript-style.mjs invalidate every proposal in flight
//   for every deposition. The authoritative inputs are hashed, never their presentation.
//
// Object representation is canonicalised; transcript semantics are not. Keys are sorted so
// serialisation order cannot alter the hash, and overlay operations are hashed IN STORED ORDER,
// because an overlay is an ordered list where order is meaning: a split before a label targets a
// different segment than a label before a split. Sorting them would make two different
// transcripts hash the same, which is the precise failure this exists to prevent.
import crypto from "node:crypto";

export const REVIEW_STATE_SCHEMA_VERSION = "1.0.0";

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  return value;
}

/**
 * The exact inputs the hash is taken over, returned separately so a caller can see what was
 * covered rather than trusting the digest.
 */
export function reviewStateProjection({ transcript, overlay } = {}) {
  // Assignments are sorted because a speaker map is a set: the same assignments written in a
  // different order are the same map. Operations are not, because an overlay is a sequence.
  const assignments = [...(transcript?.speakerMap?.assignments ?? [])]
    .map(({ sourceJobIdentity, deepgramSpeaker, speakerIdentity, transcriptRole }) =>
      ({ sourceJobIdentity, deepgramSpeaker, speakerIdentity, transcriptRole }))
    .sort((left, right) => `${left.sourceJobIdentity}:${left.deepgramSpeaker}`.localeCompare(`${right.sourceJobIdentity}:${right.deepgramSpeaker}`));

  // Only the fields that decide what an operation does. Anything an implementation adds later --
  // an author, a client timestamp, a UI hint -- is excluded by omission rather than by a filter
  // that would have to be maintained.
  const operations = (overlay?.operations ?? []).map(operation => ({
    op: operation.op ?? null,
    segmentId: operation.segmentId ?? null,
    wordId: operation.wordId ?? null,
    beforeWordId: operation.beforeWordId ?? null,
    afterWordId: operation.afterWordId ?? null,
    text: operation.text ?? null,
    speakerIdentity: operation.speakerIdentity ?? null,
    transcriptRole: operation.transcriptRole ?? null,
  }));

  return canonicalize({
    schemaVersion: REVIEW_STATE_SCHEMA_VERSION,
    transcriptContentHash: transcript?.transcript_hash ?? null,
    speakerMap: { status: transcript?.speakerMap?.status ?? null, assignments },
    overlay: { operations },
  });
}

export function computeReviewStateHash({ transcript, overlay } = {}) {
  const bytes = Buffer.from(JSON.stringify(reviewStateProjection({ transcript, overlay })));
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

export const STALE_CORRECTION_PROPOSAL = "STALE_CORRECTION_PROPOSAL";

/**
 * Whether a proposal may still be applied.
 *
 * Refuses on any difference rather than asking whether this particular change touched this
 * particular proposal. Deciding that a stale proposal is "probably still fine" is a judgement
 * about text the reporter has already altered, and getting it wrong writes a correction against
 * a transcript that no longer exists. A refusal costs a re-run; the alternative costs a record.
 *
 * Never rebases. A proposal carries the state it was made against, and if that state is gone the
 * proposal is gone with it.
 */
export function assertProposalIsCurrent(proposal, currentReviewStateHash) {
  const carried = proposal?.reviewStateHash ?? null;
  if (carried && carried === currentReviewStateHash) return { ok: true };
  return {
    ok: false,
    code: STALE_CORRECTION_PROPOSAL,
    expected: currentReviewStateHash,
    carried,
    message: carried
      ? "This proposal was generated against a transcript that has since changed. Re-run the correction pass; it cannot be applied to the current state."
      : "This proposal carries no review-state hash, so the transcript it was generated against cannot be established.",
  };
}
