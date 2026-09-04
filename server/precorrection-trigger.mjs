// Running the AI correction passes for a transcript nobody has corrected yet.
//
// WHY THIS EXISTS. The correction subsystem was complete, tested, and reachable only by pressing
// "Correct Transcript". So a freshly transcribed deposition reached the reporter as raw ASR --
// 900 paragraphs of SPEAKER 0 / SPEAKER 1, oath errors and all -- and the work the passes were
// built to do sat behind a button the reporter had to know to press. That was the whole of
// E2E-034: not a missing capability, a missing wire.
//
// WHAT THIS DOES NOT CHANGE. The passes still only PROPOSE. Nothing here applies a correction,
// touches the overlay, or writes to the transcript. Running automatically and applying
// automatically are different things, and only the first is wired.
//
// FAILURE IS NOT THE TRANSCRIPTION'S PROBLEM. A pass needs an Anthropic key and a network; a
// transcript does not. Every failure here is caught and reported as a summary beside a
// transcription that already succeeded. A reporter with no key still gets their transcript, and
// the manual button still works exactly as before.
import { listCorrectionPasses, runEntityPass } from "./entity-pass.mjs";
import { runSpeakerRangePass } from "./speaker-range-pass.mjs";

export const PRECORRECTION_STATUS = Object.freeze({
  RAN: "ran",
  ALREADY_PREPARED: "already-prepared",
  NO_CREDENTIAL: "no-credential",
  FAILED: "failed",
});

/**
 * Whether a worklist has already been prepared for this exact transcript state.
 *
 * Pass ids are derived from the start time, so re-running always mints a new one and cannot be
 * used to recognise repeated work. The review-state hash can: a pass recorded against the state
 * the transcript is in now analysed exactly this transcript, and running again would spend a
 * Claude call to produce the same worklist.
 */
export function alreadyPreparedFor(passes, reviewStateHash) {
  if (!reviewStateHash) return false;
  return (passes ?? []).some(pass => pass?.reviewStateHash === reviewStateHash);
}

/**
 * Prepares the review worklist for a newly transcribed deposition.
 *
 * Returns a summary. Never throws: a caller is reporting on a transcription that has already
 * succeeded, and an exception here would turn a completed transcript into a failed request.
 */
export async function preparePrecorrection(root, {
  depositionId, storageRoot, apiKey, model, reviewStateHash = null,
  passStartedAt = new Date().toISOString(),
  entityPass = runEntityPass, speakerRangePass = runSpeakerRangePass, listPasses = listCorrectionPasses,
} = {}) {
  if (!apiKey) {
    return { status: PRECORRECTION_STATUS.NO_CREDENTIAL, ran: [], proposals: 0,
      message: "No Anthropic API key is configured, so the AI review worklist was not prepared. The transcript is complete; run Correct Transcript once a key is added." };
  }

  try {
    const existing = listPasses(root, { depositionId, storageRoot });
    if (alreadyPreparedFor(existing, reviewStateHash)) {
      return { status: PRECORRECTION_STATUS.ALREADY_PREPARED, ran: [], proposals: 0,
        message: "A review worklist already exists for this transcript state; it was not regenerated." };
    }
  } catch {
    // An unreadable pass directory is not a reason to refuse to prepare one. Worst case is a
    // duplicate worklist, which costs a Claude call and confuses nobody.
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
    return { status: PRECORRECTION_STATUS.FAILED, ran, proposals: 0, failures,
      message: "The transcript is complete, but the AI review worklist could not be prepared. Run Correct Transcript to try again." };
  }
  return { status: PRECORRECTION_STATUS.RAN, ran, proposals, failures,
    message: `Prepared ${proposals} proposal${proposals === 1 ? "" : "s"} for review. Nothing has been applied to the transcript.` };
}
