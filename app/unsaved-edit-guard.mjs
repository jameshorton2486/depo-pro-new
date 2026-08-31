// Whether the reporter has text in the editor that the record does not have yet.
//
// The Workspace commits a paragraph on a 1,200 ms idle debounce, on click-away, and on Ctrl+S.
// None of those fire when a tab is closed mid-sentence, and there was no unload handling at all,
// so up to a second and a bit of typing left no trace anywhere. The reporter was not told.
//
// Four mechanisms were considered for closing that, and three were rejected on evidence:
//
//   beforeunload + save()   Browsers cancel in-flight work during unload. A save started there
//                           is not a save; it is a save-shaped hope.
//   sendBeacon              Fires reliably but cannot read a response. Since §91 every mutation
//                           must carry a current review-state hash and may be refused with 409,
//                           so a beacon that loses a race would discard the text while looking
//                           like it succeeded. That is worse than the defect: silent loss that
//                           also appears saved.
//   localStorage draft      Reliable, but it puts reporter text in a second store outside the
//                           overlay, and something then has to decide which one wins on reopen.
//                           One deposition, one authoritative transcript -- a recoverable draft
//                           is a second authority wearing a different hat.
//
// What is left is the pair that actually works: flush on `visibilitychange` to hidden, where
// asynchronous work is still permitted and which fires before unload in practice; and if the edit
// is still dirty at `beforeunload`, prompt. The prompt does not save anything. It makes the loss
// visible, which is the requirement -- no silent loss of dirty reporter text on close.
//
// Pure, so the decision can be characterized without a browser, like paragraph-edit-transaction.

/**
 * True when closing now would discard something the reporter typed.
 *
 * `saving` counts as unsaved on purpose. A request in flight during unload is one the browser is
 * entitled to cancel, and the reporter would have been shown a state that never reached disk.
 * `conflict` and `failed` count too: the text exists only on screen, and those are precisely the
 * states where the reporter most needs to be stopped rather than quietly let go.
 */
export function hasUnsavedText(activeEdit) {
  if (!activeEdit) return false;
  if (activeEdit.status === "saved") return false;
  if (activeEdit.status === "conflict" || activeEdit.status === "failed") return true;
  if (activeEdit.status === "saving") return true;
  return String(activeEdit.draft ?? "") !== String(activeEdit.baseText ?? "");
}

/**
 * What each lifecycle event should do about it.
 *
 * Separated from the component so the rule is inspectable: "hide" may still save, "unload" may
 * only warn, and both are no-ops when nothing is dirty. A caller that treats "unload" as a save
 * opportunity is making the mistake this module exists to record.
 */
export function guardAction(event, activeEdit) {
  if (!hasUnsavedText(activeEdit)) return "none";
  if (event === "hide") return "flush";
  if (event === "unload") return "warn";
  return "none";
}
