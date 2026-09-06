// Pass 3: asking one model, one question -- where does this examination begin?
//
// The prompt is in examination-boundary-prompt.mjs and the rules a proposal must satisfy are in
// examination-boundary-rules.mjs. This is the part in between: it reads the opening of the
// deposition as it currently prints, asks, and hands back a proposal stamped with the transcript
// state it analysed. It applies nothing and validates nothing -- applyAiCorrectionPass runs the
// validator against the deposition's own record, and only what survives that becomes a boundary.
//
// ONE CALL, THE OPENING ONLY. Examination begins in the first pages or the recording is not a
// deposition, so the whole procedural sequence fits in one request. Chunking it would split the
// handoff from the appearances that precede it, which is the context the answer depends on.
//
// IT DOES NOT ASK A QUESTION ALREADY ANSWERED. When the transcript already carries a DIRECT
// boundary, the pass returns without calling Anthropic. The validator would refuse the proposal
// anyway -- a boundary that exists is the reporter's until something records otherwise -- and
// buying an answer that is guaranteed to be discarded is a charge with nothing on the other side.
//
// ONLY THE FIRST EXAMINATION. Cross, redirect and recross are handovers the reporter marks as they
// read, and the control for that already exists. The defect this pass exists to fix is the opening,
// where counsel's appearance was being rendered as a question to an unsworn witness.
import {
  EXAMINATION_BOUNDARY_PROMPT_VERSION, EXAMINATION_BOUNDARY_SYSTEM,
  buildExaminationBoundaryPrompt, examinationBoundaryTool,
} from "./examination-boundary-prompt.mjs";
import { fetchExternal } from "./external-fetch.mjs";
import { applyOverlay, emptyOverlay } from "./reporter-overlay.mjs";
import { computeReviewStateHash } from "./review-state-hash.mjs";

/** The examination this pass may propose. It is asked about the first one and no other. */
const PROPOSED_TYPE = "DIRECT";

/** How many opening paragraphs the model reads. Enough to reach the handoff, not the testimony. */
export const OPENING_UTTERANCE_LIMIT = 40;

/**
 * The opening of the deposition as the model reads it: one line per paragraph, anchored on the id
 * of its first printed word.
 *
 * Struck words are skipped, so the anchor the model can reach is always a word that prints -- the
 * one thing the validator will not accept a boundary without. A paragraph whose every word has
 * been struck has no anchor and is left out entirely rather than offered with somebody else's id.
 */
export function openingUtterances({ transcript, evidence = [], overlay = null, labels = {}, limit = OPENING_UTTERANCE_LIMIT } = {}) {
  const wordsById = new Map();
  for (const document of evidence ?? []) for (const word of document?.words ?? []) wordsById.set(word.id, word);
  const projection = applyOverlay(transcript?.segments ?? [], overlay ?? emptyOverlay(transcript?.depositionId));

  const utterances = [];
  for (const segment of projection.segments ?? []) {
    const words = [];
    for (const id of segment.asrWordIds ?? []) {
      if (projection.deleted.has(id)) continue;
      const evidenceWord = wordsById.get(id);
      const text = projection.replaced.get(id) ?? String(evidenceWord?.punctuatedWord ?? evidenceWord?.word ?? "");
      if (text) words.push({ id, text });
    }
    if (!words.length) continue;
    utterances.push({
      wordId: words[0].id,
      speaker: labels[segment.speakerIdentity] ?? segment.speakerIdentity ?? null,
      role: segment.transcriptRole ?? null,
      text: words.map(word => word.text).join(" "),
    });
    if (utterances.length >= limit) break;
  }
  return utterances;
}

async function submitToClaude({ apiKey, model, prompt }) {
  const response = await fetchExternal("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model, max_tokens: 1024, system: EXAMINATION_BOUNDARY_SYSTEM,
      tools: [examinationBoundaryTool], tool_choice: { type: "tool", name: examinationBoundaryTool.name },
      messages: [{ role: "user", content: prompt }],
    }),
  }, { label: "examination-boundary-pass" });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message || "Claude request failed.");
  const call = result.content?.find(item => item.type === "tool_use" && item.name === examinationBoundaryTool.name);
  if (!call) throw new Error("Claude did not return a structured boundary proposal.");
  return call.input;
}

/**
 * Runs the pass and returns what the model proposed. Nothing here changes a transcript.
 *
 * The return shape is the one applyAiCorrectionPass reads from every analysis pass: `proposals`
 * with `failures` and `chunksSubmitted` beside them, so a pass that answered nothing and a pass
 * that could not run are distinguishable without inspecting which pass it was.
 *
 * `submit` and the readers are injectable for the same reason the other passes' are: the
 * orchestration is exercised against a real overlay with no network and no key.
 */
export async function runExaminationBoundaryPass(root, {
  depositionId, storageRoot, apiKey, model, submit = submitToClaude,
  getWorkingTranscript, readReporterOverlay, readAsrEvidence, getSpeakerCandidates,
  limit = OPENING_UTTERANCE_LIMIT,
} = {}) {
  if (!apiKey) throw new Error("Add the Anthropic API key in Administrator Settings before running a correction pass.");
  if (!model) throw new Error("A correction pass requires an explicit model.");

  const jobs = (getWorkingTranscript && readReporterOverlay && readAsrEvidence && getSpeakerCandidates)
    ? { getWorkingTranscript, readReporterOverlay, readAsrEvidence, getSpeakerCandidates }
    : await import("./transcription-jobs.mjs");
  const store = { depositionId, storageRoot };
  const transcript = jobs.getWorkingTranscript(root, store);
  const overlay = jobs.readReporterOverlay(root, store);
  const evidence = jobs.readAsrEvidence(root, store) ?? [];
  const participants = jobs.getSpeakerCandidates(root, store)?.candidates ?? [];
  const reviewStateHash = computeReviewStateHash({ transcript, overlay });

  // The question is closed. Not merely "the validator would refuse it" -- there is no open question
  // here for a model to be paid to answer.
  const projection = applyOverlay(transcript?.segments ?? [], overlay ?? emptyOverlay(depositionId));
  if ((projection.examinations ?? []).some(boundary => String(boundary?.type ?? PROPOSED_TYPE).toUpperCase() === PROPOSED_TYPE)) {
    return { proposals: [], failures: [], chunksSubmitted: 0, reviewStateHash,
      promptVersion: EXAMINATION_BOUNDARY_PROMPT_VERSION, skipped: "BOUNDARY_ESTABLISHED" };
  }

  const labels = Object.fromEntries(participants.map(person => [person.id, person.label ?? person.id]));
  const utterances = openingUtterances({ transcript, evidence, overlay, labels, limit });
  if (!utterances.length) {
    return { proposals: [], failures: [], chunksSubmitted: 0, reviewStateHash,
      promptVersion: EXAMINATION_BOUNDARY_PROMPT_VERSION, skipped: "NOTHING_TO_READ" };
  }

  const prompt = buildExaminationBoundaryPrompt({ utterances, participants, limit });
  try {
    const answer = await submit({ apiKey, model, prompt, utterances, participants });
    // `found: false` is a correct answer and the prompt says so. An opening that runs straight into
    // questioning with no discernible transition leaves the reporter to mark it, which is the
    // smaller harm -- and is not a failure of the pass.
    const proposals = answer?.found === true
      ? [{ atWordId: answer.atWordId, examinerPersonId: answer.examinerPersonId, type: PROPOSED_TYPE,
          reviewStateHash, reasoning: answer.reasoning ?? null }]
      : [];
    return { proposals, failures: [], chunksSubmitted: 1, reviewStateHash,
      promptVersion: EXAMINATION_BOUNDARY_PROMPT_VERSION };
  } catch (error) {
    // Recorded and returned, never thrown. A structural analysis that could not run must not
    // discard the name and speaker corrections the other passes found.
    return { proposals: [], chunksSubmitted: 1, reviewStateHash,
      promptVersion: EXAMINATION_BOUNDARY_PROMPT_VERSION,
      failures: [{ code: "BOUNDARY_ANALYSIS_FAILED", message: error instanceof Error ? error.message : String(error) }] };
  }
}
