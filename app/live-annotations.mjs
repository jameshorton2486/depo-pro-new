// Red is a review marker, not an edit.
//
// The reporter hears something they want to come back to and marks it. The words do not change,
// the transcript does not change, and nothing here is evidence -- the live text is already an index
// into the audio rather than a record. What red adds is a way to find the questionable passage
// again, and the timestamp beside it says where in the recording to listen.
//
// Anchored to word IDs, never to character offsets. A live transcript grows underneath the reader:
// paragraphs merge as a voice continues, text is rebuilt as words arrive, and an offset into a
// string that just got longer points somewhere else. A word ID is `${eventId}:w${index}` and the
// event is append-only and finalized, so the anchor cannot move.
//
// Only finalized words can be marked. Interim text is replaced wholesale on the next result, so an
// annotation attached to it would anchor to words Deepgram is about to withdraw.
//
// Pure: no DOM, no state, no storage. The caller holds the list.

export const ANNOTATION_TYPE = "TEXT_COLOR";
export const RED = "RED";

let counter = 0;
/** Ids are unique within a session; annotations are never persisted across one. */
const nextId = () => `annotation-${++counter}`;

/**
 * Marks a run of finalized words red.
 *
 * Returns a new list. Words already red are not marked twice -- a second mark over an overlapping
 * range would leave two annotations where the reporter sees one, and removing would then take two
 * actions to undo one visible thing.
 */
export function markRed(annotations = [], options = {}) {
  const { paragraphId = "", wordIds = [] } = options;
  /** @type {string|null} */
  const createdAt = options.createdAt ?? null;
  const fresh = wordIds.filter(id => id && !isRed(annotations, id));
  if (!paragraphId || !fresh.length) return annotations;
  return [...annotations, {
    annotationId: nextId(),
    paragraphId,
    startWordId: fresh[0],
    endWordId: fresh.at(-1),
    wordIds: [...fresh],
    type: ANNOTATION_TYPE,
    value: RED,
    createdAt,
  }];
}

/**
 * Clears red from a run of words.
 *
 * An annotation covering words both inside and outside the cleared range is narrowed rather than
 * dropped, so removing red from one word in a marked phrase leaves the rest of the phrase red.
 */
export function removeRed(annotations = [], options = {}) {
  const { wordIds = [] } = options;
  const clearing = new Set(wordIds);
  return annotations
    .map(annotation => {
      const kept = annotation.wordIds.filter(id => !clearing.has(id));
      if (kept.length === annotation.wordIds.length) return annotation;
      if (!kept.length) return null;
      return { ...annotation, wordIds: kept, startWordId: kept[0], endWordId: kept.at(-1) };
    })
    .filter(Boolean);
}

export function isRed(annotations = [], wordId) {
  return annotations.some(annotation => annotation.value === RED && annotation.wordIds.includes(wordId));
}

/** Every red word id, for rendering in one pass rather than one lookup per word. */
export function redWordIds(annotations = []) {
  return new Set(annotations.filter(annotation => annotation.value === RED).flatMap(annotation => annotation.wordIds));
}

/**
 * Drops annotations whose words are no longer in the transcript.
 *
 * Not expected to fire: finalized events are append-only, so a marked word does not vanish. It
 * exists so that if one ever does, the annotation goes with it rather than surviving as a mark on
 * nothing.
 */
export function pruneAnnotations(annotations = [], liveWordIds) {
  const present = liveWordIds instanceof Set ? liveWordIds : new Set(liveWordIds ?? []);
  return removeRed(annotations, { wordIds: annotations.flatMap(item => item.wordIds).filter(id => !present.has(id)) });
}
