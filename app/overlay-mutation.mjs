// The one place a Workspace overlay mutation is built.
//
// THE DEFECT THIS EXISTS TO PREVENT. Four separate call sites in WorkspaceScreen wrote to
// /api/transcript/overlay, and three of them remembered to carry the review-state hash. The fourth
// -- `append`, the helper behind six reporter actions -- did not:
//
//   label / speaker correction, split-with-speaker, mark for another listen,
//   clear a mark, correct a word, strike a word
//
// assertCurrent refuses a mutation that does not say which version of the transcript it was made
// against, using the same code it uses for a stale one. So all six failed, every time, with "This
// edit did not say which version of the transcript it was made against". The buttons rendered, the
// buttons enabled, and nothing persisted. The real Etminan deposition carries four overlay
// operations after a review pass, which is what that looks like from the outside.
//
// Building the request here, where a missing hash throws instead of producing a request the server
// will refuse, means a new call site cannot repeat it. The server guard is unchanged and must stay
// unchanged: it is right, and it was the only thing that noticed.

/** Thrown rather than sent. A request the server is certain to refuse is a bug here, not there. */
export const MISSING_REVIEW_STATE_HASH = "OVERLAY_MUTATION_NEEDS_REVIEW_STATE_HASH";

function requireHash(reviewStateHash) {
  const hash = String(reviewStateHash ?? "").trim();
  if (!hash) {
    throw new Error(`${MISSING_REVIEW_STATE_HASH}: a Workspace edit must say which version of the transcript it was made against. Reload the record before editing.`);
  }
  return hash;
}

function requireDeposition(depositionId) {
  const id = String(depositionId ?? "").trim();
  if (!id) throw new Error("A Workspace edit must name its deposition.");
  return id;
}

/**
 * The body for POST /api/transcript/overlay.
 *
 * @param {{ depositionId?:string, operations?:unknown[], reviewStateHash?:string|null }} [input]
 */
export function overlayMutationRequest({ depositionId, operations, reviewStateHash } = {}) {
  const id = requireDeposition(depositionId);
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("A Workspace edit must carry at least one operation.");
  }
  return { depositionId:id, operations, expectedReviewStateHash:requireHash(reviewStateHash) };
}

/**
 * The body for POST /api/transcript/overlay/undo and .../redo.
 *
 * Undo and redo are mutations too. They pop and restore whole transactions, so a stale one reverses
 * something another tab committed -- which is why the server takes a hash for them as well.
 *
 * @param {{ depositionId?:string, reviewStateHash?:string|null }} [input]
 */
export function overlayHistoryRequest({ depositionId, reviewStateHash } = {}) {
  return { depositionId:requireDeposition(depositionId), expectedReviewStateHash:requireHash(reviewStateHash) };
}

/**
 * The body for POST /api/transcript/range-proposal/accept.
 *
 * Accepting an AI speaker range is an overlay mutation like any other, so it carries the hash like
 * any other -- and it is built here so a call site cannot forget, which is the whole point of this
 * module.
 *
 * What it deliberately does NOT carry is operations. The server plans those, against the projection
 * the proposal was analyzed against. A client that sent its own plan would be choosing how the
 * record is written from the side of the wire that cannot check the transcript has not moved.
 *
 * @param {{ depositionId?:string, proposal?:object|null, reviewStateHash?:string|null }} [input]
 */
export function rangeAcceptanceRequest({ depositionId, proposal, reviewStateHash } = {}) {
  const id = requireDeposition(depositionId);
  if (!proposal || proposal.correctionType !== "speaker_assignment") {
    throw new Error("Only a speaker-range proposal can be accepted this way.");
  }
  if (!proposal.wordId || !proposal.endWordId) throw new Error("A speaker-range proposal must carry both ends of its range.");
  return { depositionId:id, proposal, expectedReviewStateHash:requireHash(reviewStateHash) };
}
