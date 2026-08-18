// Two gates, and they are not symmetrical.
//
// The outbound gate (V-rules) checks a chunk before it is ever sent. Everything it checks is
// something this codebase built, so a violation is a bug here and the right response is to refuse
// to send and say which rule broke. Sending a malformed chunk and hoping the far side notices is
// how a correction ends up anchored to a word that does not exist.
//
// The inbound gate (R-rules) checks what comes back, and its premise is different: the response is
// untrusted. Not because a model is expected to be adversarial, but because a proposal that is
// merely confused -- an id copied from the overlap context, a plausible name for a person not in
// this case -- is indistinguishable from a correct one once it has been applied. So a proposal is
// held to the structure, and anything outside it is declined rather than interpreted.
//
// The distinction the two gates share: a violation is never repaired. A chunk with a bad word id
// is not quietly rebuilt, and a proposal anchored to a read-only word is not nudged to the nearest
// editable one. Repair invents a correction nobody proposed and nobody reviewed.
//
// Anchors are word ids and only word ids. A segment id addresses a boundary the reporter can move,
// so a proposal anchored to one means something different after a split than before it. A word id
// addresses evidence, and evidence does not move.
import { assertProposalIsCurrent, STALE_CORRECTION_PROPOSAL } from "./review-state-hash.mjs";

export const CORRECTION_TYPES = Object.freeze([
  "spelling", "punctuation", "capitalization", "word_replacement", "inaudible", "speaker_assignment", "structure",
]);

export const EVIDENCE_SOURCES = Object.freeze(["transcript", "keyterm", "case_context", "case_material"]);

/** Anything outside this set is prose, and prose is not a proposal. */
export const PROPOSAL_KEYS = Object.freeze([
  "wordId", "endWordId", "correctionType", "proposedValue", "confidenceScore", "evidenceSource", "speakerIdentity",
]);

const isEditableWord = word => word.editable === true;

const chunkWords = chunk => (chunk?.utterances ?? []).flatMap(utterance => utterance.words ?? []);

// ---------------------------------------------------------------------------------------------
// Outbound: a chunk this codebase built, checked before it is sent.
// ---------------------------------------------------------------------------------------------

/**
 * Validates one chunk against the canonical store and the size budget.
 *
 * `canonical` is { wordIds:Set, utteranceIds:Set }. Utterances are segments in this transcript
 * model, so the OI-3 utterance and segment existence rules are the same check.
 */
export function validateChunk(chunk, { canonical, limits } = {}) {
  const violations = [];
  const fail = (rule, code, detail) => violations.push({ rule, code, ...detail });
  const wordIds = canonical?.wordIds ?? new Set();
  const utteranceIds = canonical?.utteranceIds ?? new Set();
  const maxEditableWords = limits?.maxEditableWords ?? 350;
  const maxSerializedBytes = limits?.maxSerializedBytes ?? 100_000;

  const seen = new Set();
  let editableWords = 0;

  for (const utterance of chunk?.utterances ?? []) {
    if (!utteranceIds.has(utterance.id)) fail("V2", "UNKNOWN_UTTERANCE_ID", { utteranceId: utterance.id });

    for (const word of utterance.words ?? []) {
      // Authored insertions are legitimately absent from the evidence store -- that is what makes
      // them authored. They are held to the opposite requirement: never editable.
      if (word.authored) {
        if (isEditableWord(word)) fail("V7", "AUTHORED_WORD_MARKED_EDITABLE", { wordId: word.id });
      } else if (!wordIds.has(word.id)) {
        fail("V1", "UNKNOWN_WORD_ID", { wordId: word.id, utteranceId: utterance.id });
      }

      if (seen.has(word.id)) fail("V4", "DUPLICATE_WORD_ID", { wordId: word.id });
      seen.add(word.id);

      // V6: an utterance carried as context has no editable words in it. This is the rule that
      // keeps an anchor out of the overlap, and it is checked per word rather than per utterance
      // because a single editable word inside a context utterance is the whole failure.
      if (utterance.editable === false && isEditableWord(word)) {
        fail("V6", "EDITABLE_WORD_IN_OVERLAP", { wordId: word.id, utteranceId: utterance.id });
      }
      if (isEditableWord(word)) editableWords += 1;
    }
  }

  // V5: the editable body is one contiguous run of utterances, with no gaps in transcript order.
  const body = (chunk?.utterances ?? []).filter(utterance => utterance.editable === true);
  for (let index = 1; index < body.length; index += 1) {
    if (body[index].ordinal !== body[index - 1].ordinal + 1) {
      fail("V5", "NON_CONTIGUOUS_BODY", { after: body[index - 1].id, before: body[index].id });
    }
  }
  const positions = (chunk?.utterances ?? []).map((utterance, index) => ({ utterance, index }))
    .filter(entry => entry.utterance.editable === true).map(entry => entry.index);
  if (positions.length && positions.at(-1) - positions[0] !== positions.length - 1) {
    fail("V5", "BODY_INTERRUPTED_BY_CONTEXT", { chunkId: chunk?.chunkId });
  }

  if (editableWords !== chunk?.editableWordCount) {
    fail("V8", "EDITABLE_COUNT_MISSTATED", { counted: editableWords, declared: chunk?.editableWordCount ?? null });
  }
  if (editableWords > maxEditableWords) fail("V8", "EDITABLE_WORDS_OVER_CEILING", { editableWords, maxEditableWords });

  const bytes = Buffer.byteLength(JSON.stringify(chunk), "utf8");
  if (bytes > maxSerializedBytes) fail("V9", "SERIALIZED_OVER_CEILING", { bytes, maxSerializedBytes });

  // V10: an utterance is whole or it is not present. A chunk holding a prefix of one is a split by
  // another name, and the reviewer cannot tell the difference.
  for (const utterance of chunk?.utterances ?? []) {
    const expected = canonical?.utteranceWordCounts?.get(utterance.id);
    if (expected !== undefined && (utterance.words ?? []).length !== expected) {
      fail("V10", "UTTERANCE_SPLIT", { utteranceId: utterance.id, held: (utterance.words ?? []).length, expected });
    }
  }

  if (!chunk?.reviewStateHash) fail("V1", "CHUNK_CARRIES_NO_REVIEW_STATE", { chunkId: chunk?.chunkId ?? null });

  return { ok: violations.length === 0, violations, editableWords, bytes };
}

/**
 * Validates the whole set, which is where ownership lives.
 *
 * V7's real content is cross-chunk: every editable word has exactly one owner. A word editable in
 * two chunks can be corrected twice, differently, with both proposals valid -- and nothing
 * downstream can decide between them.
 */
export function validateChunkSet(chunks, options = {}) {
  const perChunk = (chunks ?? []).map(chunk => ({ chunkId: chunk.chunkId, ordinal: chunk.ordinal, ...validateChunk(chunk, options) }));
  const violations = [];

  const owners = new Map();
  for (const chunk of chunks ?? []) {
    for (const word of chunkWords(chunk).filter(isEditableWord)) {
      owners.set(word.id, [...(owners.get(word.id) ?? []), chunk.chunkId]);
    }
  }
  for (const [wordId, held] of owners) {
    if (held.length > 1) violations.push({ rule: "V7", code: "WORD_EDITABLE_IN_MORE_THAN_ONE_CHUNK", wordId, chunkIds: held });
  }

  // Every canonical word is somebody's, or the pass silently skips part of the transcript.
  for (const wordId of options.canonical?.wordIds ?? []) {
    if (!owners.has(wordId)) violations.push({ rule: "V7", code: "WORD_HAS_NO_OWNER", wordId });
  }

  (chunks ?? []).forEach((chunk, index) => {
    if (chunk.ordinal !== index) violations.push({ rule: "V5", code: "ORDINAL_OUT_OF_SEQUENCE", chunkId: chunk.chunkId, ordinal: chunk.ordinal, expected: index });
  });

  const failing = perChunk.filter(result => !result.ok);
  return {
    ok: violations.length === 0 && failing.length === 0,
    violations: [...violations, ...failing.flatMap(result => result.violations.map(item => ({ ...item, chunkId: result.chunkId })))],
    perChunk,
  };
}

// ---------------------------------------------------------------------------------------------
// Inbound: what came back, which is untrusted.
// ---------------------------------------------------------------------------------------------

export const RESPONSE_REJECTED = "RESPONSE_REJECTED";

/**
 * Validates a response against the chunk it claims to answer.
 *
 * Whole-response rejection happens for exactly three reasons, and all three mean the response is
 * about a different thing than the one asked about: a chunk id that does not match, a pass id that
 * does not match, or a review-state hash showing the transcript moved underneath it. There is no
 * partial credit for these -- a response addressed to another chunk cannot be half-applied.
 *
 * Everything else is per-proposal: the good ones are accepted and the bad ones are declined with
 * the rule that declined them. One malformed proposal does not discard its neighbours.
 *
 * `roster` is the set of speakerIdentity values that exist in this deposition's record. A proposal
 * naming anyone else is declined with the attempted identity reported verbatim, because "the model
 * proposed a person who is not in this case" is the finding, and paraphrasing it loses it.
 */
export function validateProposals(response, { chunk, reviewStateHash, roster } = {}) {
  const reject = (code, detail) => ({ ok: false, rejected: { code, ...detail }, accepted: [], declined: [] });

  if (response?.chunkId !== chunk?.chunkId) {
    return reject("CHUNK_ID_MISMATCH", { rule: "R1", carried: response?.chunkId ?? null, expected: chunk?.chunkId ?? null });
  }
  if (response?.passId !== undefined && response.passId !== chunk?.passId) {
    return reject("PASS_ID_MISMATCH", { rule: "R1", carried: response.passId, expected: chunk?.passId ?? null });
  }

  const current = reviewStateHash ?? chunk?.reviewStateHash ?? null;
  const currency = assertProposalIsCurrent({ reviewStateHash: response?.reviewStateHash ?? chunk?.reviewStateHash ?? null }, current);
  if (!currency.ok) return reject(STALE_CORRECTION_PROPOSAL, { rule: "R1", carried: currency.carried, expected: currency.expected, message: currency.message });

  const words = chunkWords(chunk);
  const index = new Map(words.map((word, position) => [word.id, { word, position }]));
  const allowed = roster instanceof Set ? roster : new Set(roster ?? []);

  const accepted = [];
  const declined = [];
  const claimed = [];

  for (const proposal of response?.proposals ?? []) {
    const refuse = (rule, code, detail = {}) => { declined.push({ rule, code, proposal, ...detail }); return true; };

    // Anchors are word ids. A segment id is a boundary the reporter can move; accepting one would
    // let a proposal mean something different after a split than it did before.
    //
    // Checked BEFORE the unstructured-field rule, which would otherwise decline it too -- but as a
    // stray key rather than as an attempt to anchor to a moving boundary. Both refuse the proposal;
    // only one of them tells the reporter what actually happened.
    if (proposal?.segmentId !== undefined && refuse("R2", "SEGMENT_ANCHOR_NOT_PERMITTED", { segmentId: proposal.segmentId })) continue;

    const extras = Object.keys(proposal ?? {}).filter(key => !PROPOSAL_KEYS.includes(key));
    if (extras.length && refuse("R10", "UNSTRUCTURED_FIELD", { fields: extras })) continue;

    const anchor = index.get(proposal?.wordId);
    if (!anchor && refuse("R2", "WORD_ID_NOT_IN_CHUNK", { wordId: proposal?.wordId ?? null })) continue;
    if (!isEditableWord(anchor.word) && refuse("R3", "ANCHOR_NOT_EDITABLE", { wordId: proposal.wordId })) continue;

    let end = anchor;
    if (proposal.endWordId !== undefined && proposal.endWordId !== null) {
      end = index.get(proposal.endWordId);
      if (!end && refuse("R4", "END_WORD_ID_NOT_IN_CHUNK", { endWordId: proposal.endWordId })) continue;
      if (!isEditableWord(end.word) && refuse("R4", "END_WORD_NOT_EDITABLE", { endWordId: proposal.endWordId })) continue;
      if (end.position < anchor.position && refuse("R4", "END_WORD_PRECEDES_ANCHOR", { wordId: proposal.wordId, endWordId: proposal.endWordId })) continue;
      // A range running through a read-only word is a range that does not exist in one chunk.
      const spanned = words.slice(anchor.position, end.position + 1);
      if (spanned.some(word => !isEditableWord(word)) && refuse("R4", "RANGE_CROSSES_READ_ONLY_WORD", { wordId: proposal.wordId, endWordId: proposal.endWordId })) continue;
    }

    if (!CORRECTION_TYPES.includes(proposal.correctionType) && refuse("R6", "CORRECTION_TYPE_NOT_PERMITTED", { correctionType: proposal.correctionType ?? null })) continue;

    const score = proposal.confidenceScore;
    if ((typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) && refuse("R7", "CONFIDENCE_OUT_OF_RANGE", { confidenceScore: score ?? null })) continue;

    if (!EVIDENCE_SOURCES.includes(proposal.evidenceSource) && refuse("R8", "EVIDENCE_SOURCE_NOT_PERMITTED", { evidenceSource: proposal.evidenceSource ?? null })) continue;

    // R9: a deletion is the one correction with nothing to propose, and it says so by type. An
    // empty value on any other type is a proposal that does not propose anything.
    const isDeletion = proposal.correctionType === "structure" && proposal.proposedValue === null;
    if (!isDeletion && !String(proposal.proposedValue ?? "").trim() && refuse("R9", "PROPOSED_VALUE_EMPTY", {})) continue;

    if (proposal.correctionType === "speaker_assignment") {
      const identity = proposal.speakerIdentity ?? null;
      if (!identity && refuse("R9", "SPEAKER_ASSIGNMENT_WITHOUT_IDENTITY", {})) continue;
      if (!allowed.has(identity) && refuse("R11", "IDENTITY_NOT_IN_ROSTER", { attemptedIdentity: identity })) continue;
    }

    claimed.push({ proposal, from: anchor.position, to: end.position });
    accepted.push(proposal);
  }

  // R5: two accepted proposals may not claim the same word. Checked after the fact because it is a
  // property of the set, not of any one proposal -- and both are declined, not the later one,
  // because there is no ground for preferring whichever happened to be serialized first.
  const overlapping = new Set();
  for (let left = 0; left < claimed.length; left += 1) {
    for (let right = left + 1; right < claimed.length; right += 1) {
      if (claimed[left].from <= claimed[right].to && claimed[right].from <= claimed[left].to) {
        overlapping.add(left);
        overlapping.add(right);
      }
    }
  }
  for (const position of [...overlapping].sort((a, b) => b - a)) {
    const { proposal } = claimed[position];
    declined.push({ rule: "R5", code: "OVERLAPPING_PROPOSAL_RANGE", proposal });
    accepted.splice(accepted.indexOf(proposal), 1);
  }

  return { ok: true, rejected: null, accepted, declined };
}
