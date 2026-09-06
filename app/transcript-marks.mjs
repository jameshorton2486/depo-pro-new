// The two punctuation marks a reporter inserts by hand, and where they may go.
//
// WHY THESE TWO, AND WHY THESE FORMS. Measured against the certified Heath Thomas transcript: the
// em dash appears 327 times and an ellipsis of any form appears zero times. The dash is what that
// record uses for a self-correction, a false start, or a speaker trailing off -- "we were -- before
// the break, we were talking about" -- so it is the mark the reporter reaches for constantly and
// the one the application had no control for. The ellipsis is the reporter's own convention for
// omitted material and is kept as a separate control rather than folded into the dash.
//
// The project holds no rule saying WHEN each applies: the UFM worksheet records that dashes and
// ellipses are formatting-only rules and does not reproduce them. That absence is why these are two
// buttons and not one, and why nothing here chooses between them -- the reporter does, by pressing
// one. It is also why no AI pass may propose either yet: a model needs the rule this project does
// not state, and inventing one to fill the gap would put an invented convention in a certified
// record.
//
// WHAT A MARK IS, STRUCTURALLY. An authored token inserted BESIDE a word, never text written INTO
// one. That distinction is the whole reason this exists: the previous control put its characters
// into the paragraph draft, and a caret resting inside a word turned an evidentiary word into
// "kn...ow" -- the word id and its timestamps survived, but punctuation had been written into text
// the microphone produced. A mark is the reporter's addition and reads as one: it carries no ASR
// anchor, renders as authored, and deletes without touching the word it sits after.

/**
 * The marks, by id. `text` is what lands in the transcript; `glyph` is only the button face.
 *
 * The dash is U+2014, which is the character the certified transcript actually contains -- not two
 * hyphens, which appear in it zero times.
 */
export const TRANSCRIPT_MARKS = Object.freeze({
  dash: Object.freeze({ id: "dash", label: "Dash", glyph: "—", text: "—",
    description: "Insert an em dash after the selected word" }),
  ellipsis: Object.freeze({ id: "ellipsis", label: "Ellipsis", glyph: "…", text: "...",
    description: "Insert an ellipsis after the selected word" }),
});

/**
 * The operation one mark on one selected word justifies, or why it cannot be placed.
 *
 * Refusals are reporter-facing sentences. An operation code on screen tells the reporter nothing
 * they can act on, and this control is used mid-review with a foot pedal in the other hand.
 *
 * @returns {{ok:true, operations:Array}|{ok:false, message:string}}
 */
export function markInsertion({ paragraph, selectedWordId, markId } = {}) {
  const mark = TRANSCRIPT_MARKS[String(markId ?? "")];
  if (!mark) return { ok: false, message: "That mark is not one Depo-Pro can insert." };
  if (!paragraph || !selectedWordId) {
    return { ok: false, message: `Select the word the ${mark.label.toLowerCase()} should follow, then press ${mark.label}.` };
  }
  const words = paragraph.words ?? [];
  const word = words.find(item => item?.id === selectedWordId);
  if (!word) {
    return { ok: false, message: "That word is no longer part of this paragraph. Select it again." };
  }
  // A struck word does not print, so nothing can follow it on the page. Refused rather than
  // anchored to the next surviving word, because that would put the mark somewhere the reporter
  // did not point at.
  if (word.deleted) {
    return { ok: false, message: `This word has been struck, so a ${mark.label.toLowerCase()} cannot follow it. Select a word that still prints.` };
  }
  return { ok: true, mark, operations: [{ op: "insert", afterWordId: word.id, text: mark.text }] };
}
