// Running an AI review of a transcript, when the reporter asks for one.
//
// WHY THE REPORTER STARTS IT. The correction subsystem was complete, tested, and reachable only by
// pressing a button labelled "Correct Transcript" -- so a freshly transcribed deposition reached
// the reporter as raw ASR and the passes never ran. The first repair wired them to fire when
// Deepgram finished. That was the wrong fix: a paid analysis should begin because a reporter asked
// for one, not because a transcript appeared.
//
// It also does not survive contact with a live deposition. Re-analysing continuously while
// testimony is still arriving would be expensive and pointless -- the transcript is still moving.
// One reporter-initiated control works for both modes, and needs no second architecture for live.
//
// SO NOTHING HERE RUNS BY ITSELF. Completing transcription, opening Workspace, refreshing the
// browser, reopening a deposition or restarting Depo-Pro must never spend a Claude call.
//
// AND IT PROPOSES ONLY. This module cannot reach the overlay, the acceptance path, or the working
// transcript. Running the analysis and applying its results are different acts, and only the first
// happens here. A test asserts the absence rather than trusting the comment.
import { listCorrectionPasses, runEntityPass } from "./entity-pass.mjs";
import { runSpeakerRangePass } from "./speaker-range-pass.mjs";

export const AI_REVIEW_STATUS = Object.freeze({
  COMPLETED: "completed",
  ALREADY_REVIEWED: "already-reviewed",
  NO_CREDENTIAL: "no-credential",
  FAILED: "failed",
});

/**
 * Whether a review already exists for this exact transcript state.
 *
 * Pass ids are derived from the start time, so they cannot recognise repeated work -- clicking
 * twice would mint two ids and charge twice. The review-state hash can: a pass recorded against
 * the state the transcript is in now analysed exactly this transcript, and running again would buy
 * the same worklist a second time.
 */
export function reviewExistsFor(passes, reviewStateHash) {
  if (!reviewStateHash) return false;
  return (passes ?? []).some(pass => pass?.reviewStateHash === reviewStateHash);
}

/** The reviews already bought for this transcript state, newest first. Reads only; never charges. */
export function existingReview(root, { depositionId, storageRoot, reviewStateHash, listPasses = listCorrectionPasses } = {}) {
  let passes = [];
  try { passes = listPasses(root, { depositionId, storageRoot }) ?? []; } catch { return { passes: [], current: [] }; }
  return { passes, current: reviewStateHash ? passes.filter(pass => pass.reviewStateHash === reviewStateHash) : [] };
}

/**
 * Runs the AI review the reporter asked for.
 *
 * Returns a summary and never throws: the caller is responding to a button press about a transcript
 * that already exists, and an exception here would present a working transcript as a failure.
 */
export async function runAiReview(root, {
  depositionId, storageRoot, apiKey, model, reviewStateHash = null,
  force = false,
  passStartedAt = new Date().toISOString(),
  entityPass = runEntityPass, speakerRangePass = runSpeakerRangePass, listPasses = listCorrectionPasses,
} = {}) {
  if (!apiKey) {
    return { status: AI_REVIEW_STATUS.NO_CREDENTIAL, ran: [], proposals: 0, retryable: true,
      message: "No Anthropic API key is configured, so the AI review could not run. The transcript is unaffected; add a key in Administrator Settings and run the review again." };
  }

  // `force` is the reporter deliberately buying a second look at the same transcript -- offered as
  // "Run AI Review Again" and never taken on their behalf.
  if (!force) {
    const { current } = existingReview(root, { depositionId, storageRoot, reviewStateHash, listPasses });
    if (current.length) {
      return { status: AI_REVIEW_STATUS.ALREADY_REVIEWED, ran: [], proposals: current.reduce((n, pass) => n + (pass.accepted ?? 0), 0),
        passes: current, retryable: false,
        message: "This transcript has already been reviewed in its current state. Its suggestions were loaded rather than analysed again." };
    }
  }

  const options = { depositionId, storageRoot, apiKey, model, passStartedAt, limitChunks: null, additionalInstructions: "" };
  // Settled, not all: one pass failing must not discard the other's proposals. A reporter with a
  // names worklist and no speaker worklist is better served than one with neither.
  const [names, ranges] = await Promise.allSettled([
    entityPass(root, options),
    speakerRangePass(root, options),
  ]);

  const ran = [], failures = [];
  let proposals = 0;
  for (const [label, outcome] of [["names", names], ["speaker-ranges", ranges]]) {
    if (outcome.status === "fulfilled") {
      ran.push(label);
      proposals += (outcome.value?.accepted ?? []).length;
    } else {
      failures.push(`${label}: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`);
    }
  }

  if (!ran.length) {
    return { status: AI_REVIEW_STATUS.FAILED, ran, proposals: 0, failures, retryable: true,
      message: "The AI review could not be completed. The transcript is unaffected and nothing was changed; you can run the review again." };
  }
  return { status: AI_REVIEW_STATUS.COMPLETED, ran, proposals, failures, retryable: false,
    message: `${proposals} suggestion${proposals === 1 ? "" : "s"} ready for review. Nothing has been applied to the transcript.` };
}
