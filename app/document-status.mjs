// What the reporter is told they are holding.
//
// The defect this closes: the Workspace asked the server for the complete document, silently
// accepted the testimony-only model when that request failed, and then reported
// "Word proof generated from the shared pages" in both cases. A reporter could not tell a
// certified transcript from its bare body except by reading the filename.
//
// Everything here derives from what the server ACTUALLY served or ACTUALLY produced. A flag set
// at request time from client state can go stale between the request and the answer, which is
// the same failure wearing a different coat -- so no function here accepts the caller's
// intention as an input.

export const COMPLETE_RECORD_TYPE = "COMPLETE_TRANSCRIPT_DOCUMENT_MODEL";

export const DOCUMENT_STATUS = Object.freeze({
  READY: "Complete transcript ready",
  BLOCKED: "Complete transcript blocked — action required",
  TESTIMONY_ONLY: "Testimony body only",
});

// The sections a testimony-only document does not contain. Changes and signature is stated
// conditionally rather than omitted: the signature disposition lives in the assembly authority,
// which is precisely what is absent whenever this list is shown, so claiming to know whether it
// applies would be inventing the answer.
export const COMPLETE_ONLY_SECTIONS = Object.freeze([
  "title and caption",
  "appearances",
  "index",
  "changes and signature (when signature is requested)",
  "reporter's certification",
]);

export const absentSectionSentence = () =>
  `This document does not contain ${COMPLETE_ONLY_SECTIONS.slice(0, -1).join(", ")}, or ${COMPLETE_ONLY_SECTIONS.at(-1)}.`;

/**
 * The Workspace document state, derived from the record type the server returned.
 *
 * Absent or invalid assembly authority is BLOCKED, never TESTIMONY_ONLY.
 *
 * TESTIMONY_ONLY denotes a deliberate reporter choice to generate the body alone. No path
 * reaches that choice until the assembly workflow exists, so nothing here returns it. A failure
 * that reported itself as a choice would read to the reporter as "this is what I asked for",
 * which is the softening this item exists to prevent. The constant is defined because the
 * vocabulary is fixed at three; the absence of a return for it is the point, not an omission.
 *
 * `servedRecordType` is read off the response body. `blockedReason` is the server's own error
 * text, preserved rather than discarded -- without it the banner can say that something is
 * wrong but not what to do about it.
 */
export function deriveDocumentStatus({ servedRecordType = null, blockedReason = "" } = {}) {
  if (servedRecordType === COMPLETE_RECORD_TYPE) {
    return { state: DOCUMENT_STATUS.READY, reason: "", absentSections: [] };
  }
  return {
    state: DOCUMENT_STATUS.BLOCKED,
    reason: String(blockedReason || "").trim() || "The complete transcript could not be assembled.",
    absentSections: [...COMPLETE_ONLY_SECTIONS],
  };
}

/** The control names its output, so the reporter reads what they are about to make. */
export function documentControlLabel(state) {
  return state === DOCUMENT_STATUS.READY ? "Generate complete transcript Word" : "Generate testimony-only Word";
}

/**
 * The completion notice, built from what the server reports it produced.
 *
 * `producedKind` is the server's answer, not the caller's request. The generic
 * "Word proof generated from the shared pages" is deliberately gone: it was true of both
 * documents, which is what made it useless.
 */
export function generationNotice({ producedKind, outputPath }) {
  const where = outputPath ? `: ${outputPath}` : "";
  return producedKind === "complete-transcript"
    ? `Complete transcript generated${where}`
    : `Testimony body only generated${where}. ${absentSectionSentence()}`;
}
