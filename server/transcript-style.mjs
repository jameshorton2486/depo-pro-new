// Reporter style conventions, applied to the reading rather than to the evidence.
//
// Every rule here was measured against the reporter-and-scopist-verified Etminan transcript
// (Dr_Etminan_Transcript.docx, 664 text paragraphs) and against what the ASR actually emits for
// the same deposition. Nothing is here on the strength of a style manual; a rule that neither
// side of that comparison demanded is not a rule.
//
// Three constraints shape all of it.
//
// It is a projection, never a mutation. The ASR evidence is immutable and the working transcript
// is derived from it, so a style pass that rewrote either would break a rebuild-from-raw. These
// functions produce display text and nothing else.
//
// Every rule is one token in, one token out. The Workspace renders each word as its own button
// carrying its ASR word id, which is what `split`, `label`, `replace` and the coming correction
// pass all address. A rule that split or merged tokens would break that addressing, so the
// specimen's `4 64th Judicial` -> `464th Judicial` join is deliberately NOT here: it needs two
// tokens to become one. A styled token may contain spaces -- "April 24, 2026" is one word button.
//
// It never touches a word the reporter has already touched. An explicit correction outranks a
// convention, so edited and authored words pass through untouched.
//
// What it does not do: nothing here corrects a mishearing, and no rule may ever be added that
// would. "be swearing the witness" -> "please swear in the witness" is a different sentence, and
// only the audio settles it. These rules change how a word is written, never which word it is.

const MONTHS = Object.freeze(["January","February","March","April","May","June","July","August","September","October","November","December"]);
const MONTH_NAMES = new Set(MONTHS.map(month => month.toLowerCase()));
const SMALL_NUMBERS = Object.freeze(["", "one","two","three","four","five","six","seven","eight","nine"]);
const SMALL_ORDINALS = Object.freeze(["", "first","second","third","fourth","fifth","sixth","seventh","eighth","ninth"]);

// Trailing punctuation rides along untouched. Deepgram attaches it to the token ("04/24/2026,"),
// and a rule that dropped it would silently repunctuate the record.
const TRAILING = /([.,;:!?]*)$/;
function split(text) { const match = TRAILING.exec(text); return { body:text.slice(0, text.length - match[1].length), tail:match[1] }; }
const bare = value => split(String(value ?? "")).body.toLowerCase();
// A style form that already ends in a period absorbs a trailing full stop rather than doubling
// it -- "01:27PM." must become "1:27 p.m.", not "1:27 p.m..". Only the leading period is taken,
// so "MD.," still keeps its comma and becomes "M.D.,".
const afterAbbreviation = tail => tail.replace(/^\./, "");

/**
 * The style form of one word, or the word unchanged.
 *
 * `previous` and `next` are the adjacent words' raw text. Both are needed: an exhibit number and
 * a quantity are the same token and differ only by what precedes them.
 */
export function styleWord(text, { previous = "", next = "" } = {}) {
  const { body, tail } = split(String(text ?? ""));
  if (!body) return String(text ?? "");

  // 04/24/2026 -> April 24, 2026. The specimen contains no slashed date and four written ones;
  // the ASR emits 17 slashed. Day and month are read US-order, which is what the deposition's
  // own dates confirm: 09/15/2023 is the September crash pleaded in the notice.
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(body);
  if (slashed) {
    const month = Number(slashed[1]), day = Number(slashed[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return `${MONTHS[month - 1]} ${day}, ${slashed[3]}${tail}`;
  }

  // 01:27PM -> 1:27 p.m. Leading zero dropped, because the specimen's three times carry none.
  const time = /^(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?$/.exec(body);
  if (time) {
    const hour = Number(time[1]);
    if (hour >= 1 && hour <= 12) return `${hour}:${time[2]} ${time[3].toLowerCase()}.m.${afterAbbreviation(tail)}`;
  }

  // MD -> M.D. The specimen writes the degree seven times and always punctuated.
  if (/^M\.?D$/i.test(body)) return `M.D.${afterAbbreviation(tail)}`;

  // Doctor -> Dr. only as a title before a name. The specimen keeps the vocative spelled out --
  // 37 of those against 24 written "Dr." -- and every "Dr." it contains precedes a personal name.
  // Keyed on the ASR's own capitalisation plus a capitalised next word, which under-corrects
  // rather than over-corrects: three lowercase "doctor Lee" are left alone, and leaving a title
  // long is a smaller wrong than turning an address to the witness into an abbreviation.
  if (/^Doctor$/.test(body) && /^[A-Z]/.test(String(next))) return `Dr.`;

  // Small numbers are written out, with the two exceptions the specimen actually contains: all
  // 18 of its bare digits that follow "Exhibit", and one "6 o'clock".
  if (/^[1-9]$/.test(body) && bare(previous) !== "exhibit" && bare(next) !== "o'clock") return `${SMALL_NUMBERS[Number(body)]}${tail}`;

  // Ordinals likewise, except as a day of the month: the specimen's single "1st" is in
  // "February 1st, 2024".
  const ordinal = /^([1-9])(st|nd|rd|th)$/i.exec(body);
  if (ordinal && !MONTH_NAMES.has(bare(previous))) return `${SMALL_ORDINALS[Number(ordinal[1])]}${tail}`;

  return String(text ?? "");
}

/**
 * Style a word list in place of its display text, leaving reporter-touched words alone.
 * Returns a new array; each word gains `display`, and `styled` when it differs from `text`.
 */
export function styleWords(words = []) {
  return words.map((word, index) => {
    const text = String(word?.text ?? "");
    if (word?.edited || word?.authored || word?.deleted) return { ...word, display:text };
    const display = styleWord(text, { previous:words[index - 1]?.text ?? "", next:words[index + 1]?.text ?? "" });
    return display === text ? { ...word, display } : { ...word, display, styled:true };
  });
}

// Two spaces after a sentence, one between words. The specimen is uniform on this and it is the
// single most visible difference between the screen and the page.
//
// A title's period does not end a sentence. "Dr. Mohammad" reads as one name and the specimen
// spaces it singly, so the abbreviations that can only precede a name are excluded. A degree is
// deliberately not on that list: "Etminan, M.D." genuinely does end sentences, and it ends far
// more of them than it appears inside one. A mid-sentence "M.D." therefore takes one space too
// many -- the smaller error, and the visible one.
const NEVER_FINAL = new Set(["dr.", "mr.", "mrs.", "ms.", "no."]);
const SENTENCE_END = /[.?!]["')\]]?$/;
const endsSentence = text => SENTENCE_END.test(text) && !NEVER_FINAL.has(String(text).toLowerCase());
export function joinStyled(words = []) {
  return words.reduce((line, word, index) => {
    const text = String(word?.display ?? word?.text ?? "");
    if (!index) return text;
    return line + (endsSentence(String(words[index - 1]?.display ?? words[index - 1]?.text ?? "")) ? "  " : " ") + text;
  }, "").trim();
}
