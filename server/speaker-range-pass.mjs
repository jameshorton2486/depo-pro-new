// Running the speaker-range pass, and applying nothing.
//
// This is the second correction pass and it deliberately reuses the first one's machinery whole:
// the same chunker, the same inbound validator, the same review-state hash, the same on-disk record
// beside the transcript. What differs is one line -- the correction type it is allowed to attempt.
//
// GLOBAL AND RANGE ARE BOTH KEPT, and that is a measurement rather than a preference. Five of
// Production Trial #1's eight diarization clusters were one person throughout, and for those the
// existing whole-cluster pass answers in one proposal what this one would need dozens to say. The
// other three were mixed, and no whole-cluster proposal can describe them honestly. So:
//
//   GLOBAL   this diarization cluster is this person          -- speaker-attribution-pass.mjs
//   RANGE    these words, first to last, are this person      -- here
//
// A GLOBAL proposal must never be presented as a RANGE one. They differ in what a reporter is being
// asked to believe: a whole cluster, or a specific stretch of words they can read.
//
// NOTHING IS APPLIED HERE. The pass writes proposals beside the transcript, each carrying the
// review-state hash of the transcript it was generated against. Acceptance is a separate, explicit
// act, and it happens on the server -- see range-proposal-acceptance.mjs.
import fs from "node:fs";
import path from "node:path";
import { computeAnchorStateHash } from "./review-state-hash.mjs";
import { buildCorrectionChunks } from "./correction-chunker.mjs";
import { validateProposals } from "./correction-validator.mjs";
import { depositionDirectory } from "./deposition-store.mjs";
import { fetchExternal } from "./external-fetch.mjs";
import { applyOverlay, emptyOverlay } from "./reporter-overlay.mjs";
import { SPEAKER_RANGE_CORRECTION_TYPES, SPEAKER_RANGE_PROMPT_VERSION, SPEAKER_RANGE_SYSTEM, buildSpeakerRangePrompt, speakerRangeTool } from "./speaker-range-prompt.mjs";

export const SPEAKER_RANGE_PASS_VERSION = SPEAKER_RANGE_PROMPT_VERSION;

/**
 * The diarization cluster behind each segment, keyed by segment id.
 *
 * Read from the applied overlay rather than added to the chunk, because the chunker is shared with
 * the entity pass and a field added there would change every chunk id that pass has ever produced.
 * The join is safe: a chunk utterance's id IS the segment id it was cut from.
 */
export function clustersBySegment({ transcript, overlay } = {}) {
  const applied = applyOverlay(transcript?.segments ?? [], overlay ?? emptyOverlay(transcript?.depositionId));
  return new Map(applied.segments.map(segment => [segment.id, segment.deepgramSpeaker ?? null]));
}

async function submitToClaude({ apiKey, model, prompt }) {
  const response = await fetchExternal("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model, max_tokens: 4096, system: SPEAKER_RANGE_SYSTEM,
      tools: [speakerRangeTool], tool_choice: { type: "tool", name: speakerRangeTool.name },
      messages: [{ role: "user", content: prompt }],
    }),
  }, { label: "speaker-range-pass" });
  const result = await response.json();
  if (!response.ok) throw new Error(result?.error?.message || "Claude request failed.");
  const call = result.content?.find(item => item.type === "tool_use" && item.name === speakerRangeTool.name);
  if (!call) throw new Error("Claude did not return structured speaker-range proposals.");
  return call.input;
}

/**
 * Runs the pass and writes its proposals.
 *
 * `submit` is injectable so the pass can be exercised without a network call, which is how every
 * test of it runs. A chunk that fails is recorded and the pass continues: one bad response should
 * not discard what the rest of the transcript found.
 */
export async function runSpeakerRangePass(root, { depositionId, storageRoot, apiKey, model, passStartedAt, submit = submitToClaude, limitChunks = null, additionalInstructions = "" } = {}) {
  if (!apiKey) throw new Error("Add the Anthropic API key in Administrator Settings before running a correction pass.");
  if (!model) throw new Error("A correction pass requires an explicit model.");
  if (!passStartedAt) throw new Error("A correction pass requires an explicit start time, so its pass id is reproducible.");

  const jobs = await import("./transcription-jobs.mjs");
  const store = { depositionId, storageRoot };
  const directory = depositionDirectory(root, depositionId, { storageRoot });
  const transcript = jobs.getWorkingTranscript(root, store);
  const evidence = jobs.readAsrEvidence(root, store);
  const overlay = jobs.readReporterOverlay(root, store);
  const { candidates } = jobs.getSpeakerCandidates(root, store);
  if (!candidates.length) throw new Error("This deposition's record names nobody, so there is no participant to attribute speech to.");

  const roster = new Set(candidates.map(person => person.id));
  const clusters = clustersBySegment({ transcript, overlay });
  const { passId, chunks, reviewStateHash, transcriptContentHash, findings } = buildCorrectionChunks({ depositionId, transcript, evidence, overlay, passStartedAt });
  const selected = limitChunks ? chunks.slice(0, limitChunks) : chunks;

  const accepted = [], declined = [], failures = [];
  for (const chunk of selected) {
    try {
      const prompt = buildSpeakerRangePrompt(chunk, { roster: candidates, clusters, additionalInstructions });
      const response = await submit({ apiKey, model, prompt, chunk });
      const verdict = validateProposals(response, { chunk, roster, allowedCorrectionTypes: SPEAKER_RANGE_CORRECTION_TYPES });
      if (verdict.rejected) { failures.push({ chunkId: chunk.chunkId, ...verdict.rejected }); continue; }
      for (const proposal of verdict.accepted) accepted.push(describe(proposal, { chunk, chunkId: chunk.chunkId, reviewStateHash, clusters }));
      for (const item of verdict.declined) declined.push({ chunkId: chunk.chunkId, ...item });
    } catch (error) {
      failures.push({ chunkId: chunk.chunkId, code: "CHUNK_FAILED", message: error instanceof Error ? error.message : String(error) });
    }
  }

  const record = {
    schemaVersion: "1.0.0",
    recordType: "CORRECTION_PROPOSALS",
    // The reporter is being asked about a stretch of words, not a cluster. A review surface that
    // cannot tell the two apart is asking the wrong question, so the record says which it is.
    passType: "speaker-range",
    proposalLevel: "RANGE",
    passVersion: SPEAKER_RANGE_PASS_VERSION,
    passId, depositionId, model, passStartedAt, additionalInstructions: String(additionalInstructions).trim(),
    transcriptContentHash, reviewStateHash,
    applied: false,
    appliedOperations: [],
    chunksTotal: chunks.length, chunksSubmitted: selected.length,
    chunkFindings: findings,
    accepted, declined, failures,
    completedAt: new Date().toISOString(),
  };
  const file = path.join(directory, "transcript", "correction-passes", `${passId}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return record;
}

/**
 * What the reporter has to see to judge one range proposal.
 *
 * The exact words, where they are, what the machine thought, and what the model claims. Read off
 * the chunk the proposal was made against rather than looked up later, so the text shown is the
 * text the model was actually given.
 */
export function describe(proposal, { chunk, chunkId, reviewStateHash, clusters = new Map(), segments = null } = {}) {
  const flat = (chunk?.utterances ?? []).flatMap(utterance => (utterance.words ?? []).map(word => ({ word, utterance })));
  const from = flat.findIndex(item => item.word.id === proposal.wordId);
  const to = flat.findIndex(item => item.word.id === (proposal.endWordId ?? proposal.wordId));
  const span = from === -1 ? [] : flat.slice(from, (to === -1 ? from : to) + 1);
  const times = span.map(item => item.word.start).filter(value => Number.isFinite(value));
  const ends = span.map(item => item.word.end).filter(value => Number.isFinite(value));
  const utterances = [...new Set(span.map(item => item.utterance.id))];
  // The state of the words this proposal targets, committed to now so acceptance can prove later
  // that they have not changed. Without it a proposal can only be judged by whether the WHOLE
  // transcript moved, which is what made accepting one proposal kill every other proposal in the
  // same pass. Computed from the chunk's own words when no projection is supplied, so the pass
  // does not need to re-derive one.
  const anchorWords = span.map(item => ({
    id: item.word.id,
    text: item.word.text ?? null,
    struck: Boolean(item.word.struck),
    readOnly: Boolean(item.word.readOnly ?? item.word.authored),
    speakerIdentity: item.utterance?.speakerIdentity ?? null,
    transcriptRole: item.utterance?.transcriptRole ?? null,
  }));
  const anchorStateHash = span.length
    ? computeAnchorStateHash({
        segments: segments ?? [{ words: anchorWords.map(word => ({ ...word })), speakerIdentity: anchorWords[0]?.speakerIdentity ?? null, transcriptRole: anchorWords[0]?.transcriptRole ?? null }],
        wordIds: anchorWords.map(word => word.id),
      })
    : null;

  return {
    ...proposal,
    chunkId, reviewStateHash, anchorStateHash,
    proposalLevel: "RANGE",
    text: span.map(item => item.word.text).join(" "),
    wordCount: span.length,
    startTime: times.length ? Math.min(...times) : null,
    endTime: ends.length ? Math.max(...ends) : null,
    // What the machine thought, kept beside what the model claims so the reporter can weigh them.
    deepgramSpeakers: [...new Set(utterances.map(id => clusters.get(id)).filter(value => Number.isInteger(value)))],
    currentSpeakerIdentity: span[0]?.utterance?.speakerIdentity ?? null,
  };
}
