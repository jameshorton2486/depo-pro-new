// Cutting a transcript into units a correction pass can be asked about.
//
// The unit is the utterance, and the reason is evidentiary rather than ergonomic. An utterance is
// one speaker's turn; cutting through the middle of one hands a reviewer half a sentence with no
// speaker attached to the remainder, and a proposal made against half a sentence cannot be judged.
// So a chunk is a whole number of utterances, never 300 words with the boundary falling wherever
// the count runs out. The word budget yields to the utterance boundary, in that order, always.
//
// Every chunk carries the identity of the transcript it was cut from: transcriptContentHash for
// the stored projection, reviewStateHash for what the reporter was actually looking at. A proposal
// returned against a chunk is checked against both before it may be applied, which is the point of
// cutting them in the first place. A chunk is not a convenience, it is the addressing scheme that
// makes a proposal refutable.
//
// Overlap is read-only context, and the rule that matters is that an anchor may never lie in it.
// A word appears in the editable body of exactly one chunk. If overlap words were editable, two
// chunks could each propose a different correction to the same word and both would be valid, and
// nothing downstream could decide between them. Overlap exists to let a reviewer see the sentence
// running in from the previous chunk, and for nothing else.
//
// What is editable, and what is only visible:
//
//   Evidence words are editable. They carry a Deepgram word id, which is the substrate every
//   correction anchors to.
//
//   Reporter-authored insertions are NOT editable. They have no evidence id -- their id is
//   positional (overlay:...) -- and text the reporter typed is the reporter's own. They appear in
//   the chunk because removing them would misrepresent the sentence, and for no other reason.
//
//   Deleted words do not appear at all. They are not in the transcript.
import crypto from "node:crypto";
import { applyOverlay, emptyOverlay } from "./reporter-overlay.mjs";
import { computeReviewStateHash } from "./review-state-hash.mjs";

export const CHUNK_SCHEMA_VERSION = "1.0.0";

export const CHUNK_LIMITS = Object.freeze({
  targetEditableWords: 300,
  maxEditableWords: 350,
  maxOverlapWords: 50,
  maxSerializedBytes: 100_000,
});

export const CHUNK_BOUNDARY_CONFLICT = "CHUNK_BOUNDARY_CONFLICT";

const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const serializedBytes = value => Buffer.byteLength(JSON.stringify(value), "utf8");

/** Deterministic from the deposition and the moment the pass began, never from a clock read here. */
export const computePassId = (depositionId, passStartedAt) =>
  digest(`${depositionId} ${passStartedAt}`).slice(0, 16);

const computeChunkId = (passId, ordinal, firstWordId, lastWordId) =>
  digest(`${passId} ${ordinal} ${firstWordId} ${lastWordId}`).slice(0, 16);

/** Over editable content only: the read-only context is not what a proposal is made against. */
const computeChunkHash = words => digest(words.map(word => `${word.id} ${word.text}`).join(" "));

/**
 * The transcript as it currently reads, grouped by utterance, with each word carrying the id a
 * correction would anchor to.
 */
export function currentUtterances({ transcript, evidence, overlay } = {}) {
  const derivedFrom = new Set(transcript?.derivedFrom ?? []);
  const wordsById = new Map();
  for (const document of evidence ?? []) {
    if (derivedFrom.size && !derivedFrom.has(document.jobIdentity)) continue;
    for (const word of document.words ?? []) wordsById.set(word.id, word);
  }

  const applied = applyOverlay(
    transcript?.segments ?? [],
    overlay ?? emptyOverlay(transcript?.depositionId),
    { knownWordIds: new Set(wordsById.keys()) },
  );

  return applied.segments.map((segment, index) => {
    const words = [];
    for (const wordId of segment.asrWordIds ?? []) {
      if (!applied.deleted.has(wordId)) {
        const evidenceWord = wordsById.get(wordId);
        words.push({
          id: wordId,
          text: applied.replaced.has(wordId) ? applied.replaced.get(wordId) : String(evidenceWord?.punctuatedWord ?? evidenceWord?.word ?? ""),
          start: evidenceWord?.start ?? null,
          end: evidenceWord?.end ?? null,
          confidence: evidenceWord?.confidence ?? null,
          editable: true,
        });
      }
      // Authored text sits where the reporter put it: visible, and untouchable.
      for (const insertion of applied.inserted.get(wordId) ?? []) {
        words.push({ id: insertion.id, text: insertion.text, start: null, end: null, confidence: null, editable: false, authored: true });
      }
    }
    return {
      id: segment.id,
      ordinal: index,
      speakerIdentity: segment.speakerIdentity ?? null,
      transcriptRole: segment.transcriptRole ?? null,
      // Per utterance, not per word: diarization decides a turn, and the minimum across the turn is
      // the honest figure to put in front of a reviewer being asked about who spoke.
      speakerConfidence: minimumSpeakerConfidence(segment, wordsById),
      words,
    };
  });
}

function minimumSpeakerConfidence(segment, wordsById) {
  const values = (segment.asrWordIds ?? [])
    .map(id => wordsById.get(id)?.speakerConfidence)
    .filter(value => Number.isFinite(value));
  return values.length ? Math.min(...values) : null;
}

const editableCount = utterance => utterance.words.filter(word => word.editable).length;

/**
 * Whether an utterance must stay with the one after it.
 *
 * Only when both roles are known. A question and its answer read as one exchange, and a reviewer
 * asked to correct an answer without the question in front of them is being asked to guess. When a
 * role is absent this returns false: inferring that an unlabelled turn is a question because it
 * ends in a question mark is exactly the inference this must not make.
 */
const pairsWithNext = (utterance, next) =>
  utterance?.transcriptRole === "QUESTIONING_ATTORNEY" && next?.transcriptRole === "WITNESS";

/**
 * Cuts the transcript into chunks.
 *
 * Returns { passId, chunks, findings }. Throws CHUNK_BOUNDARY_CONFLICT when a single utterance
 * exceeds the word ceiling, because the two rules genuinely cannot both be honoured there and
 * splitting an utterance is not available as a compromise.
 *
 * The Q./A. pairing is a preference and yields to the ceiling with a recorded finding. The pair is
 * still reviewable across the two chunks, because overlap carries the question in as context, so a
 * hard stop there would cost the pass without saving anything.
 */
export function buildCorrectionChunks({ depositionId, transcript, evidence, overlay, passStartedAt } = {}, limits = {}) {
  const budget = { ...CHUNK_LIMITS, ...limits };
  if (!depositionId) throw new Error("A correction pass requires a deposition id.");
  if (!passStartedAt) throw new Error("A correction pass requires an explicit start time, so its pass id is reproducible.");

  const utterances = currentUtterances({ transcript, evidence, overlay });
  const passId = computePassId(depositionId, passStartedAt);
  const transcriptContentHash = transcript?.transcript_hash ?? null;
  const reviewStateHash = computeReviewStateHash({ transcript, overlay });
  const findings = [];

  for (const utterance of utterances) {
    const count = editableCount(utterance);
    if (count > budget.maxEditableWords) {
      const error = new Error(`Utterance ${utterance.id} holds ${count} editable words, above the ${budget.maxEditableWords} ceiling, and an utterance may not be split.`);
      error.code = CHUNK_BOUNDARY_CONFLICT;
      error.utteranceId = utterance.id;
      error.editableWords = count;
      throw error;
    }
  }

  // What a word actually costs to serialize in THIS transcript, rather than an assumed figure.
  // Word ids, timings and confidences dominate the payload, so the cost is stable within a
  // transcript and worth measuring once instead of guessing at either end.
  const totalWords = utterances.reduce((count, utterance) => count + utterance.words.length, 0) || 1;
  const bytesPerWord = Math.ceil(serializedBytes(utterances) / totalWords);
  const overlapReserve = 2 * budget.maxOverlapWords * bytesPerWord + 512;
  const bodyByteBudget = Math.max(bytesPerWord * 4, budget.maxSerializedBytes - overlapReserve);

  // Greedy packing against the word budget and a byte budget that already holds room for the
  // overlap. Without that reserve the bodies pack to the full ceiling and every one of them then
  // has to be repaired an utterance at a time, which is quadratic and converges far too slowly to
  // be trusted under a guard.
  const bodies = [];
  let body = [];
  let words = 0;
  let bytes = 0;
  for (let index = 0; index < utterances.length; index += 1) {
    const utterance = utterances[index];
    const count = editableCount(utterance);
    const cost = serializedBytes(utterance);
    if (body.length > 0 && (words + count > budget.maxEditableWords || bytes + cost > bodyByteBudget
      // At target, break before a question rather than after it, so the exchange stays whole.
      || (words >= budget.targetEditableWords && !pairsWithNext(utterances[index - 1], utterance)))) {
      bodies.push(body);
      body = [];
      words = 0;
      bytes = 0;
    }
    body.push(utterance);
    words += count;
    bytes += cost;
  }
  if (body.length) bodies.push(body);

  const readOnly = utterance => ({
    ...utterance,
    editable: false,
    words: utterance.words.map(word => ({ ...word, editable: false })),
  });

  const assemble = (utteranceBody, ordinal, all, allowance = budget.maxOverlapWords) => {
    const leading = trimContext(all[ordinal - 1] ?? [], allowance, "trailing").map(readOnly);
    const trailing = trimContext(all[ordinal + 1] ?? [], allowance, "leading").map(readOnly);
    const editableBody = utteranceBody.map(utterance => ({ ...utterance, editable: true }));
    const editableWords = editableBody.flatMap(utterance => utterance.words.filter(word => word.editable));

    const chunk = {
      schemaVersion: CHUNK_SCHEMA_VERSION,
      passId,
      chunkId: computeChunkId(passId, ordinal, editableWords[0]?.id ?? "", editableWords.at(-1)?.id ?? ""),
      ordinal,
      depositionId,
      transcriptContentHash,
      reviewStateHash,
      chunkHash: computeChunkHash(editableWords),
      editableWordCount: editableWords.length,
      utterances: [...leading, ...editableBody, ...trailing],
    };
    return { ...chunk, serializedBytes: serializedBytes(chunk) };
  };

  // The serialized ceiling is then measured on the ASSEMBLED chunk, because that is what gets sent:
  // the body plus its overlap plus the envelope. Measuring the body alone is the mistake that lets
  // an over-budget chunk out of the door, since overlap is derived from the neighbouring bodies and
  // so is not known until the packing is done.
  //
  // Repair gives up context before it gives up work, in that order. Overlap is discretionary -- a
  // reviewer reads better with the previous sentence in view, but the chunk is still answerable
  // without it. The editable body is the work itself, so it moves only once there is no context
  // left to surrender. Reducing the body first would cut the transcript into more, smaller chunks
  // while still carrying a full 100 words of context in each, which is the wrong thing to protect.
  //
  // Every repair strictly reduces something bounded below and an utterance is never split, so this
  // terminates; the guard bounds it anyway rather than trusting that argument at runtime.
  const allowances = bodies.map(() => budget.maxOverlapWords);
  const assembleAll = () => bodies.map((utteranceBody, ordinal) => assemble(utteranceBody, ordinal, bodies, allowances[ordinal] ?? budget.maxOverlapWords));
  let chunks = assembleAll();
  for (let guard = utterances.length * 8 + 128; guard > 0; guard -= 1) {
    const at = chunks.findIndex(chunk => chunk.serializedBytes > budget.maxSerializedBytes);
    if (at < 0) break;
    if ((allowances[at] ?? 0) > 0) {
      allowances[at] = Math.max(0, allowances[at] - 10);
    } else if (bodies[at].length > 1) {
      const moved = bodies[at].pop();
      if (!bodies[at + 1]) { bodies.push([]); allowances.push(budget.maxOverlapWords); }
      bodies[at + 1].unshift(moved);
    } else {
      const error = new Error(`Utterance ${bodies[at][0].id} serializes to ${chunks[at].serializedBytes} bytes alone, above the ${budget.maxSerializedBytes} ceiling, and an utterance may not be split.`);
      error.code = CHUNK_BOUNDARY_CONFLICT;
      error.utteranceId = bodies[at][0].id;
      error.serializedBytes = chunks[at].serializedBytes;
      throw error;
    }
    chunks = assembleAll();
  }
  // A chunk carrying less context than the allowance is a fact about the pass, not an internal
  // detail: it says a reviewer saw less of the surrounding transcript than the design intends.
  allowances.forEach((allowance, ordinal) => {
    if (allowance < budget.maxOverlapWords) {
      findings.push({ code: "OVERLAP_REDUCED_BY_BUDGET", chunkOrdinal: ordinal, allowedOverlapWords: allowance, configured: budget.maxOverlapWords });
    }
  });
  const stillOver = chunks.find(chunk => chunk.serializedBytes > budget.maxSerializedBytes);
  if (stillOver) {
    const error = new Error(`Chunk ${stillOver.chunkId} could not be brought within the ${budget.maxSerializedBytes} byte ceiling.`);
    error.code = CHUNK_BOUNDARY_CONFLICT;
    throw error;
  }

  // Pairing findings are taken from the FINAL boundaries, not from the packing pass, because repair
  // moves boundaries after packing has run and a finding recorded earlier would describe a split
  // that no longer exists -- or miss one that now does.
  for (let index = 1; index < bodies.length; index += 1) {
    const question = bodies[index - 1].at(-1);
    const answer = bodies[index][0];
    if (pairsWithNext(question, answer)) {
      findings.push({ code: "QA_PAIR_SPLIT_BY_BUDGET", questionUtteranceId: question.id, answerUtteranceId: answer.id });
    }
  }

  return { passId, transcriptContentHash, reviewStateHash, chunks, findings };
}

/**
 * Whole utterances from the neighbouring chunk, up to the overlap allowance. Whole, because a
 * fragment of an utterance is no more readable as context than it was as a body.
 */
function trimContext(utterances, maxWords, side) {
  const ordered = side === "trailing" ? [...utterances].reverse() : [...utterances];
  const taken = [];
  let words = 0;
  for (const utterance of ordered) {
    const count = editableCount(utterance);
    if (words + count > maxWords) break;
    taken.push(utterance);
    words += count;
  }
  return side === "trailing" ? taken.reverse() : taken;
}
