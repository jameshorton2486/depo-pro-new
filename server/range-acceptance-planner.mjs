// Turning an accepted fact into the operations that record it.
//
// A structural proposal says one thing: these words were spoken by this person. It does not say
// `label`, or `split`, or in what order -- deciding that is mechanics, and mechanics do not belong in
// a prompt. A model that chose its own overlay operations would be choosing how the record is
// written, and would get it wrong in ways no roster check could catch.
//
// So the model proposes the fact and this plans the mutation.
//
// WHY A RANGE NEEDS PLANNING AT ALL. `label` addresses a segment -- the whole segment holding a word
// -- while a proposal may cover part of one, or parts of several. Where the range does not line up
// with segment edges the boundaries have to be created first, and `split` is what creates them.
// Splitting before a word puts that word at the head of the tail, and the tail may carry a speaker,
// which is what makes most of these plans short.
//
// Every operation emitted here already exists and is qualified. Nothing new is invented, and the
// whole plan is applied as ONE reporter transaction so a single undo restores the state before it.
//
// Found necessary by the Production Trial #1 audit: the existing speaker pass could only say
// "this Deepgram cluster is this person", which cannot express a cluster holding two people or one
// utterance mis-diarized into somebody else's cluster. Both occurred in the first real deposition.

/** Where a word sits: which segment holds it, and at what index. */
function locate(segments, wordId) {
  for (const [index, segment] of segments.entries()) {
    const at = (segment.asrWordIds ?? []).indexOf(wordId);
    if (at !== -1) return { index, at, segment };
  }
  return null;
}

/**
 * The operations that record "these words belong to this person", in the order they must be applied.
 *
 * Returns `{ ok:true, operations }` or `{ ok:false, reason }`. It refuses rather than approximating:
 * a plan that covered more words than the reporter accepted would put somebody's name on speech they
 * did not make, which is the failure this whole layer exists to prevent.
 *
 * @param {object[]} segments the projection the proposal was made against
 * @param {{startWordId:string,endWordId:string,speakerIdentity:string,transcriptRole?:string|null}} accepted
 */
export function planRangeAcceptance(segments = [], accepted = {}) {
  const { startWordId, endWordId, speakerIdentity, transcriptRole = null } = accepted;
  if (!speakerIdentity) return { ok:false, reason:"SPEAKER_REQUIRED" };
  if (!startWordId || !endWordId) return { ok:false, reason:"RANGE_INCOMPLETE" };

  const start = locate(segments, startWordId);
  const end = locate(segments, endWordId);
  if (!start) return { ok:false, reason:"START_WORD_NOT_FOUND" };
  if (!end) return { ok:false, reason:"END_WORD_NOT_FOUND" };
  if (end.index < start.index || (end.index === start.index && end.at < start.at)) {
    return { ok:false, reason:"END_PRECEDES_START" };
  }

  const speaker = { speakerIdentity, transcriptRole };
  const operations = [];

  // The word after the range, when the range stops short of its last segment's end. An omitted
  // speaker on a split means the tail inherits, which is exactly what the remainder needs.
  const tailWordId = (end.segment.asrWordIds ?? [])[end.at + 1] ?? null;

  if (start.index === end.index) {
    const startsAtEdge = start.at === 0;
    const endsAtEdge = tailWordId === null;

    // The whole segment. One label, and no boundary is created that the reporter did not ask for.
    if (startsAtEdge && endsAtEdge) return { ok:true, operations:[{ op:"label", wordId:startWordId, ...speaker }] };

    // The tail of the segment. Split carries the speaker, so this is one operation.
    if (!startsAtEdge && endsAtEdge) {
      return { ok:true, operations:[{ op:"split", beforeWordId:startWordId, ...speaker }] };
    }

    // THE FAR EDGE IS ALWAYS CUT FIRST, and the reason is a real defect this had before it was
    // measured. A split's speaker is optional and an omitted one means INHERIT, so there is no way to
    // say "and the remainder goes back to what it was". Cutting the near edge first therefore gave
    // the accepted speaker to the whole tail and the second cut inherited it -- word 5 was attributed
    // to the witness when the reporter accepted words 2 to 4. Cutting the far edge first leaves the
    // remainder untouched by construction, and nothing has to be restored.

    // The head of the segment.
    if (startsAtEdge && !endsAtEdge) {
      operations.push({ op:"split", beforeWordId:tailWordId });
      operations.push({ op:"label", wordId:startWordId, ...speaker });
      return { ok:true, operations };
    }

    // The middle: far edge, then the near edge carrying the speaker.
    operations.push({ op:"split", beforeWordId:tailWordId });
    operations.push({ op:"split", beforeWordId:startWordId, ...speaker });
    return { ok:true, operations };
  }

  // Across segments. The first and last are the only ones that can be partial; everything between is
  // covered whole.
  if (start.at === 0) operations.push({ op:"label", wordId:startWordId, ...speaker });
  else operations.push({ op:"split", beforeWordId:startWordId, ...speaker });

  for (let index = start.index + 1; index < end.index; index += 1) {
    const middle = segments[index];
    const first = (middle.asrWordIds ?? [])[0];
    if (first) operations.push({ op:"label", wordId:first, ...speaker });
  }

  const lastFirstWord = (end.segment.asrWordIds ?? [])[0];
  if (tailWordId === null) {
    if (lastFirstWord) operations.push({ op:"label", wordId:lastFirstWord, ...speaker });
  } else {
    // Cut the remainder away first, then label what is left of that segment.
    operations.push({ op:"split", beforeWordId:tailWordId });
    if (lastFirstWord) operations.push({ op:"label", wordId:lastFirstWord, ...speaker });
  }
  return { ok:true, operations };
}
