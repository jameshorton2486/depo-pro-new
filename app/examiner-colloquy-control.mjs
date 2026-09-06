// What the Workspace offers when the reporter says an examiner utterance is not a question.
//
// §247-C. The operation and the labelling are built (§247-A, §247-B); this is the action that
// creates one. Kept out of the component because the Workspace has no test harness in this
// repository, so logic left inside it is logic nothing checks.
//
// The reporter states one thing and one thing only: that this utterance is not a question. Who
// spoke is already recorded and is not asked again -- the transcript knows, and asking would invite
// a second answer to a question already answered.

/**
 * @typedef {{ id:string, elementType?:string, label?:string|null, examinerColloquy?:boolean, words?:{ id:string, authored?:boolean }[] }} Paragraph
 */

/** The first word the microphone produced. Authored text carries no evidence anchor. */
export function anchorWordId(paragraph) {
  return paragraph?.words?.find(word => !word.authored)?.id ?? null;
}

/**
 * What the control can offer for the paragraph the reporter has selected.
 *
 * Returns `{ action, anchorWordId, disabledReason }` where action is "mark", "clear" or null.
 *
 * Only the examiner's own speech can be marked, and the test for that is the label the transcript
 * already produced: a paragraph reads Q. exactly when the active examiner said it. Deriving the
 * active examiner again on the client would be a second answer to a question the server has already
 * answered, and the two could disagree.
 *
 * @param {{ paragraph?:Paragraph|null }} [input]
 */
export function examinerColloquyControl({ paragraph = null } = {}) {
  const anchor = anchorWordId(paragraph);
  if (!paragraph) return { action:null, anchorWordId:null, disabledReason:"Choose the paragraph the examiner spoke." };
  if (!anchor) return { action:null, anchorWordId:null, disabledReason:"This paragraph has no recorded word to mark." };
  // Already the reporter's own determination. Offer the way back, and say whose determination it is
  // -- a line reading as colloquy because the model derived it needs a different remedy from one
  // reading that way because somebody said so.
  if (paragraph.examinerColloquy) return { action:"clear", anchorWordId:anchor, disabledReason:null };
  if (paragraph.elementType === "QUESTION") return { action:"mark", anchorWordId:anchor, disabledReason:null };
  return {
    action:null, anchorWordId:anchor,
    disabledReason:"This paragraph does not read as the examiner's question, so there is nothing to reclassify.",
  };
}

/**
 * The operation the action writes. One operation, carrying only the anchor.
 *
 * @param {{ paragraph?:Paragraph|null }} [input]
 */
export function examinerColloquyOperation({ paragraph = null } = {}) {
  const { action, anchorWordId:anchor } = examinerColloquyControl({ paragraph });
  if (!action || !anchor) return null;
  return { op:action === "mark" ? "colloquy" : "uncolloquy", wordId:anchor };
}

/**
 * The label the button carries, in the reporter's words.
 *
 * Says what pressing it does, not what the feature is called. "Examiner colloquy" is a term from
 * this design; "Not a question -- MR. BENTLEY speaking" is what the reporter is deciding.
 *
 * The name comes from the speaker map, never from `paragraph.label`: an unmarked paragraph is
 * labelled "Q.", so reading the name off the label would offer to mark "Q." as not a question.
 *
 * @param {{ paragraph?:Paragraph|null, labels?:Record<string,string> }} [input]
 */
export function examinerColloquyLabel({ paragraph = null, labels = {} } = {}) {
  const { action } = examinerColloquyControl({ paragraph });
  if (!action) return null;
  const speaker = String(labels[paragraph?.speakerIdentity] ?? "").replace(/:$/, "").trim();
  if (action === "clear") return speaker ? `Read ${speaker} as asking a question again` : "Read this as a question again";
  return speaker ? `Not a question — ${speaker} speaking` : "Not a question — the examiner speaking";
}
