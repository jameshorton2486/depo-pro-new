export const MAX_PARAGRAPH_GAP_SECONDS = 3;
export const MAX_PARAGRAPH_CHARACTERS = 900;

function sameSpeaker(left, right) {
  return left.sourceJobIdentity === right.sourceJobIdentity
    && left.sourceUploadId === right.sourceUploadId
    && left.deepgramSpeaker === right.deepgramSpeaker
    && left.speakerIdentity === right.speakerIdentity
    && left.transcriptRole === right.transcriptRole;
}

function joinText(left, right) {
  const first = String(left || "").trim();
  const second = String(right || "").trim();
  if (!first) return second;
  if (!second) return first;
  if (/^[,.;:!?)]/.test(second) || /[([]$/.test(first)) return `${first}${second}`;
  return `${first} ${second}`;
}

function canMerge(paragraph, segment) {
  if (segment.forceParagraphBoundaryBefore) return false;
  if (!sameSpeaker(paragraph, segment)) return false;
  if (!Number.isFinite(paragraph.end) || !Number.isFinite(segment.start)) return false;
  const gap = segment.start - paragraph.end;
  if (gap < 0 || gap > MAX_PARAGRAPH_GAP_SECONDS) return false;
  return joinText(paragraph.text, segment.text).length <= MAX_PARAGRAPH_CHARACTERS;
}

function beginParagraph(segment) {
  return {
    ...segment,
    segmentIds: [segment.id],
    asrWordIds: [...(segment.asrWordIds || [])],
  };
}

/**
 * Builds display paragraphs without changing the stored Deepgram segments.
 * Every paragraph retains its source segment and ASR word identifiers.
 */
export function groupTranscriptSegments(segments) {
  const paragraphs = [];
  for (const segment of segments) {
    const current = paragraphs.at(-1);
    if (!current || !canMerge(current, segment)) {
      paragraphs.push(beginParagraph(segment));
      continue;
    }
    current.text = joinText(current.text, segment.text);
    current.end = segment.end;
    current.segmentIds.push(segment.id);
    current.asrWordIds.push(...(segment.asrWordIds || []));
  }
  return paragraphs;
}

/**
 * Deepgram speaker buckets for the bulk speaker map, keyed by job AND speaker number.
 *
 * Deepgram numbers speakers per request, so speaker 0 in one job and speaker 0 in another are
 * two different people who happen to share an index. Keying the buckets by index alone merges
 * them into one row, and whichever identity the reporter picks is then applied to both -- no
 * error, no warning, and the wrong person attributed in a certified record. A deposition
 * recorded in three volumes has three unrelated speaker 0s.
 *
 * The composite key is the same one reconcileSpeakerMap uses server-side
 * (`${sourceJobIdentity}:${deepgramSpeaker}`), so what the panel offers and what the server
 * accepts cannot drift apart.
 *
 * Sorted by word count because that is what makes the roles obvious: the examiner and the
 * witness hold thousands of words each, the videographer and reporter a few hundred.
 */
export function speakerBuckets(paragraphs = []) {
  const buckets = new Map();
  for (const paragraph of paragraphs) {
    const speaker = paragraph?.deepgramSpeaker;
    if (speaker === null || speaker === undefined) continue;
    // Prefers the value the paragraph carries; the id-splitting fallback remains for callers
    // that build paragraphs without it, and is no longer the only route.
    const jobIdentity = paragraph.sourceJobIdentity ?? String(paragraph.segmentIds?.[0] ?? "").split(":")[0];
    const key = `${jobIdentity}:${speaker}`;
    const bucket = buckets.get(key) ?? { key, jobIdentity, deepgramSpeaker:speaker, words:0, sample:String(paragraph.text ?? "").slice(0, 60) };
    bucket.words += paragraph.words?.length ?? 0;
    buckets.set(key, bucket);
  }
  return [...buckets.values()].sort((a, b) => b.words - a.words);
}
