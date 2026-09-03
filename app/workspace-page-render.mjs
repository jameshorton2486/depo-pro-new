// When a rendered transcript page has to be drawn again, and when it does not.
//
// The Workspace holds all 63 pages of a real deposition in the DOM -- 12,178 word buttons, 30,245
// nodes. WorkspaceDocumentPage was already wrapped in memo, and memo never once prevented a render:
// the container passed eight inline arrow handlers and a freshly built Set to every page on every
// render, so the shallow comparison failed nine ways. Measured cost of one such render: 856ms of
// blocked main thread, for a click that only moved the selection.
//
// The saving is real because a correction changes far less of the document than it looks like. A
// split on page 46 of Etminan changed twelve pages and left fifty-one byte-identical -- pagination
// resynchronises about a dozen pages after an inserted line. Comparing all 63 costs about 47ms.
//
// SAFETY IS THE WHOLE POINT HERE. A comparator that wrongly reports "equal" leaves stale text on a
// page of a certified transcript, which is far worse than a slow screen. So this compares CONTENT
// and never assumes position implies sameness: page.id is positional (`transcript-body-4`) and is
// identical either side of an edit that rewrote the page. Anything this cannot account for compares
// unequal and the page is drawn again.

/** True when two pages would render identical output, given identical surrounding state. */
export function samePageContent(a, b) {
  // Absence is checked before identity on purpose. Two missing pages are `===` each other, and
  // reporting that as "nothing to draw again" would answer a question about content with a fact
  // about nothing. The dangerous direction of this function is "equal".
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.id !== b.id || a.pageNumber !== b.pageNumber) return false;
  if (a.role !== b.role || a.sectionKind !== b.sectionKind || a.editable !== b.editable) return false;
  const left = a.lines ?? [], right = b.lines ?? [];
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const one = left[index], two = right[index];
    if (one === two) continue;
    if (!one || !two) return false;
    if (one.position !== two.position || one.occupied !== two.occupied) return false;
    if (one.content !== two.content || one.paragraphId !== two.paragraphId) return false;
    const oneFragments = one.fragments ?? [], twoFragments = two.fragments ?? [];
    if (oneFragments.length !== twoFragments.length) return false;
    for (let at = 0; at < oneFragments.length; at += 1) {
      const first = oneFragments[at], second = twoFragments[at];
      if (first === second) continue;
      if (!first || !second) return false;
      // id, kind and text are what the token renders; audioStart is what the line's play control
      // renders. sourceStart is read only inside the click handler, which reads the current props.
      if (first.id !== second.id || first.kind !== second.kind || first.text !== second.text) return false;
      if ((first.audioStart ?? null) !== (second.audioStart ?? null)) return false;
    }
  }
  return true;
}

const holdsParagraph = (page, paragraphId) =>
  paragraphId !== null && paragraphId !== undefined && (page?.lines ?? []).some(line => line.paragraphId === paragraphId);

const holdsAnyParagraph = (page, paragraphIds) =>
  paragraphIds && paragraphIds.size > 0 && (page?.lines ?? []).some(line => line.paragraphId && paragraphIds.has(line.paragraphId));

const holdsWord = (page, wordId) => {
  if (wordId === null || wordId === undefined) return false;
  for (const line of page?.lines ?? []) {
    for (const fragment of line.fragments ?? []) if (fragment.id === wordId) return true;
  }
  return false;
};

/** Whether this page draws any of the words in the set -- so a changed set only redraws its pages. */
const holdsAnyWord = (page, wordIds) => {
  if (!wordIds || wordIds.size === 0) return false;
  for (const line of page?.lines ?? []) {
    for (const fragment of line.fragments ?? []) if (wordIds.has(fragment.id)) return true;
  }
  return false;
};

const sameWordIdSet = (a, b) => {
  if (a === b) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
};

/**
 * memo's comparator for one transcript page. `true` means "do not draw this page again".
 *
 * A page is redrawn when its own content changed, and when a piece of surrounding state that this
 * page displays moved into it or out of it: the selected paragraph, the selected word, the word
 * currently playing, the low-confidence marks, the open editor, or the layout profile.
 *
 * Note what is deliberately NOT here: the handler props. They are compared by the caller having made
 * them stable with useCallback -- a comparator that ignored unstable handlers would keep drawing
 * pages with a stale closure over `activeEdit`, and the editor would save the wrong text.
 */
export function pageRenderEqual(previous, next) {
  if (previous.profile !== next.profile) return false;
  if (!samePageContent(previous.page, next.page)) return false;

  // The handlers must be stable references. If they are not, the caller has a defect this comparator
  // would hide, so it is checked rather than assumed.
  for (const key of ["onActivate", "onChange", "onSave", "onCancel", "onJoinPrevious", "onJoinNext", "onPlayAt"]) {
    if (previous[key] !== next[key]) return false;
  }

  if (previous.selectedParagraphId !== next.selectedParagraphId
    && (holdsParagraph(next.page, previous.selectedParagraphId) || holdsParagraph(next.page, next.selectedParagraphId))) return false;

  if (!sameWordIdSet(previous.selectedParagraphIds, next.selectedParagraphIds)
    && (holdsAnyParagraph(next.page, previous.selectedParagraphIds) || holdsAnyParagraph(next.page, next.selectedParagraphIds))) return false;

  if (previous.selectedWordId !== next.selectedWordId
    && (holdsWord(next.page, previous.selectedWordId) || holdsWord(next.page, next.selectedWordId))) return false;

  if (previous.activePlaybackWordId !== next.activePlaybackWordId
    && (holdsWord(next.page, previous.activePlaybackWordId) || holdsWord(next.page, next.activePlaybackWordId))) return false;

  if (!sameWordIdSet(previous.lowConfidenceWordIds, next.lowConfidenceWordIds)
    && (holdsAnyWord(next.page, previous.lowConfidenceWordIds) || holdsAnyWord(next.page, next.lowConfidenceWordIds))) return false;

  // The open editor lives on one line of one page. Its lineKey is `${pageNumber}:${position}`, so
  // the page it belongs to is read off the key rather than searched for.
  const editPage = edit => (edit ? Number(String(edit.lineKey).split(":")[0]) : null);
  const wasHere = editPage(previous.activeEdit) === next.page.pageNumber;
  const isHere = editPage(next.activeEdit) === next.page.pageNumber;
  if ((wasHere || isHere) && previous.activeEdit !== next.activeEdit) return false;

  return true;
}
