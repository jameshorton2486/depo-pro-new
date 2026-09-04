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
 * The state of exactly the words one proposal targets.
 *
 * WHY A SECOND, NARROWER QUESTION EXISTS. The whole-state hash above answers "is this the same
 * transcript". Measured against Production Trial #1, a pass produced 173 speaker-range proposals
 * and accepting the first invalidated the other 172 -- one acceptance per pass run, by
 * construction, because accepting appends an overlay operation and every pending proposal carried
 * the hash from before it. A worklist that dies on first use is not a worklist.
 *
 * The fix is NOT to decide a stale proposal is probably still fine. That judgement is exactly what
 * the comment above rightly refuses to make. It is to ask a question that can be answered with
 * proof instead: have the words THIS proposal targets changed?
 *
 * That question is decidable here because of R2. A proposal may anchor only to a wordId -- segment
 * anchors are refused -- and word ids come from the immutable ASR evidence as `<job>:word:N`. They
 * do not move when a segment is split, joined, or relabelled somewhere else. So the identity of
 * what a proposal targets is stable, and what remains is whether the state of those particular
 * words still matches.
 *
 * Covered: each targeted word's id, its current text, whether it is still editable, and the
 * speaker identity and transcript role of the segment it currently sits in. Any operation that
 * struck, replaced, re-attributed, or re-roled those words changes this digest and the proposal
 * refuses exactly as before.
 *
 * Not covered: anything outside the target. That is the whole point -- a correction to paragraph
 * 700 has no bearing on a proposal about paragraph 12, and treating it as though it did is what
 * made the worklist unusable.
 */
export function proposalAnchorProjection({ segments = [], wordIds = [] } = {}) {
  const wanted = new Set(wordIds.filter(Boolean));
  const found = [];
  for (const segment of segments) {
    for (const word of segment?.words ?? []) {
      if (!wanted.has(word?.id)) continue;
      found.push({
        id: word.id,
        text: word.text ?? null,
        struck: Boolean(word.struck),
        readOnly: Boolean(word.readOnly ?? word.authored),
        speakerIdentity: segment.speakerIdentity ?? null,
        transcriptRole: segment.transcriptRole ?? null,
      });
    }
  }
  // Sorted by id: a proposal targets a set of words, and the order they happen to appear in a
  // projection is not part of what it targets. Missing ids are recorded as missing rather than
  // silently dropped -- a word that has been struck out of existence must change this digest.
  found.sort((left, right) => String(left.id).localeCompare(String(right.id)));
  const missing = [...wanted].filter(id => !found.some(word => word.id === id)).sort();
  return canonicalize({ schemaVersion: REVIEW_STATE_SCHEMA_VERSION, words: found, missing });
}

export function computeAnchorStateHash({ segments, wordIds } = {}) {
  const bytes = Buffer.from(JSON.stringify(proposalAnchorProjection({ segments, wordIds })));
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/** The word ids a proposal targets: its anchor, its end, and everything between them. */
export function proposalWordIds({ segments = [], proposal } = {}) {
  const words = segments.flatMap(segment => segment?.words ?? []);
  const start = words.findIndex(word => word?.id === proposal?.wordId);
  if (start === -1) return [];
  const endId = proposal?.endWordId ?? proposal?.wordId;
  const end = words.findIndex(word => word?.id === endId);
  if (end === -1 || end < start) return [words[start].id];
  return words.slice(start, end + 1).map(word => word.id);
}

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
export function assertProposalIsCurrent(proposal, currentReviewStateHash, { anchorStateHash = null } = {}) {
  const carried = proposal?.reviewStateHash ?? null;
  if (carried && carried === currentReviewStateHash) return { ok: true, basis: "whole-state" };

  // The narrower question, and only when the proposal committed to an answer in advance. A
  // proposal that carries no anchorStateHash gets the old verdict: there is nothing to check it
  // against, and inventing one now would be deciding after the fact that it was probably fine.
  const carriedAnchor = proposal?.anchorStateHash ?? null;
  if (carried && carriedAnchor && anchorStateHash && carriedAnchor === anchorStateHash) {
    return { ok: true, basis: "anchor-state" };
  }
  return {
    ok: false,
    code: STALE_CORRECTION_PROPOSAL,
    expected: currentReviewStateHash,
    carried,
    message: carried
      ? "This proposal was generated against a transcript that has since changed, and the words it targets have changed with it. Re-run the correction pass; it cannot be applied to the current state."
      : "This proposal carries no review-state hash, so the transcript it was generated against cannot be established.",
  };
}
