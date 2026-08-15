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
