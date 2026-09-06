/** Pure text insertion used by cursor-based transcript correction tools. */
export function insertAtCaret(draft, caret, text) {
  const source=String(draft??""),addition=String(text??"");
  const position=Math.min(Math.max(Number.isFinite(caret)?Math.trunc(caret):source.length,0),source.length);
  return {draft:`${source.slice(0,position)}${addition}${source.slice(position)}`,caret:position+addition.length};
}
