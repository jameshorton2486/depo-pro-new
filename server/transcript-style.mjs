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
export function styleWord(text, { previous = "", next = "", exhibitNumber = false } = {}) {
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
  // A trailing comma marks the vocative and a trailing period marks the abbreviation Deepgram
  // heard as a sentence end. Measured across every capital "Doctor" in ETM01: 21 carry a period
  // or nothing and are followed by a name -- Lee, Etminan, Mohammad, Kenley, Morrison, Oishi --
  // and the single comma is "Doctor, I'm gonna", the examiner addressing the witness. Without
  // this the capitalised-next-word test admitted it, because "I'm" is capitalised mid-sentence,
  // and the returned "Dr." dropped the comma as well as inventing a title.
  if (/^Doctor$/.test(body) && (tail === "" || tail === ".") && /^[A-Z]/.test(String(next))) return `Dr.`;

  // "mister" before a name is "Mr." Case-insensitive, unlike the title above: "doctor" is an
  // ordinary English noun and needed the capital to tell a title from a vocative, while every
  // one of the 22 "mister" tokens across both depositions precedes a personal name.
  //
  if (/^mister$/i.test(body) && (tail === "" || tail === ".") && /^[A-Z]/.test(String(next))) return `Mr.`;

  // "miss" before a name is "Ms.", by reporter ruling under Morson's Rule 208: the
  // marriage-neutral honorific is the standard form regardless of what the ASR heard.
  //
  // This reverses an earlier refusal, and the reason it was refused is worth keeping rather than
  // deleting. The ASR's "miss" could be Miss, Ms. or Mrs.; the certified record distinguishes
  // all three; and nothing in the data settles it -- every recorded honorific was null and the
  // people these tokens name are in no roster. The refusal was correct while the question was
  // open. It is now answered: all of them are Ms., so there is nothing left to infer.
  //
  // The consequence, stated rather than discovered later: a witness who is in fact Mrs. will be
  // written Ms. That is the standard chosen, not an error the rule failed to catch. 45
  // occurrences across the two depositions.
  if (/^miss$/i.test(body) && (tail === "" || tail === ".") && /^[A-Z]/.test(String(next))) return `Ms.`;

  // A percentage is written out. The specimen writes "100 percent" four times and "60 percent"
  // once, and contains no % sign at all; the ASR emits "100%". One token either way.
  const percent = /^(\d+(?:\.\d+)?)%$/.exec(body);
  if (percent) return `${percent[1]} percent${tail}`;

  // Money carries cents. The specimen writes 750.00, 875.00, 250.00; the ASR emits $750 and
  // $4,875 alongside $7.50, so only the ones missing cents are completed. A sum is not rounded
  // or altered -- two zeroes are added to a whole-dollar figure and nothing else changes.
  const money = /^\$(\d{1,3}(?:,\d{3})*|\d+)$/.exec(body);
  if (money) return `$${money[1]}.00${tail}`;

  // An exhibit is a named thing, and the specimen capitalises all 18 of its references. Deepgram
  // emits every one of ETM01's nine lowercase. Conditioned on a following digit so the common
  // noun is untouched -- "the exhibit you were shown" stays as it is, and only the reference to
  // a specific numbered exhibit is a proper name.
  if (/^exhibit$/.test(body) && /^[1-9]\d*[.,;:!?]*$/.test(String(next))) return `Exhibit${tail}`;

  // Small numbers are written out, with the exceptions the specimen actually contains: all 18 of
  // its bare digits that follow "Exhibit", one "6 o'clock", and any digit standing next to
  // another number.
  //
  // That last one was a defect before it was a rule. Deepgram splits numeric expressions across
  // tokens, and spelling out the orphan turns a numeral into prose: "4 64th" became "four 64th"
  // where the specimen writes "464th", and "c 5 6, c 6 7" became "c five six, c six seven" where
  // the specimen writes C5-, C6-, C7 -- vertebral levels, in a spine-injury deposition, reading
  // as words. "9 15 23" is the crash date. Joining those back together needs two tokens to
  // become one and is out of reach here; not making them worse is not.
  //
  // A single-digit ordinal is the exception to the exception, and it is the one place these two
  // rules meet: "1 2nd" is Deepgram hearing "one second", which the specimen writes out in full.
  // "2nd" spells to a word, so a digit beside it is part of a phrase; "64th" and "15" stay
  // numerals, so a digit beside them is part of a number.
  const numericNeighbour = value => { const neighbour = split(String(value ?? "")).body; return /^\d/.test(neighbour) && !/^[1-9](st|nd|rd|th)$/i.test(neighbour); };
  if (/^[1-9]$/.test(body) && !(exhibitNumber || bare(previous) === "exhibit") && bare(next) !== "o'clock" && !numericNeighbour(previous) && !numericNeighbour(next)) return `${SMALL_NUMBERS[Number(body)]}${tail}`;

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
// "exhibit" is not always the word immediately before its number. ETM01 says "exhibit 1", but
// the Thomas deposition says "exhibit number 2", "exhibit number, uh, 2?" and "exhibit number,
// I believe, 3" -- and a rule reading only the previous word spelled six of them out, against a
// specimen that writes Exhibit 1 through Exhibit 9 as digits every time and never spells one.
//
// Bounded three ways so it cannot reach across into an unrelated number: at most four words
// back, stopping at a sentence end, and stopping at any earlier number, because only the first
// number after "exhibit" is the exhibit's. "exhibit 5, this window, 2 panes" protects the 5 and
// leaves the 2 a quantity.
const EXHIBIT_LOOKBACK = 4;
function isExhibitNumber(words, index) {
  for (let step = 1; step <= EXHIBIT_LOOKBACK; step++) {
    const candidate = words[index - step];
    if (!candidate) return false;
    const text = String(candidate.text ?? ""), body = split(text).body;
    // The sentence end is checked before the word itself, because "exhibit." ends a sentence at
    // "exhibit": a number in the next sentence is not its number. Checking the word first would
    // read "marked as an exhibit. Do you see 3 pages" as a reference to exhibit 3.
    if (/[.?!]$/.test(text)) return false;
    if (body.toLowerCase() === "exhibit") return true;
    if (/^\d+$/.test(body)) return false;
  }
  return false;
}

export function styleWords(words = []) {
  return words.map((word, index) => {
    const text = String(word?.text ?? "");
    if (word?.edited || word?.authored || word?.deleted) return { ...word, display:text };
    const display = styleWord(text, { previous:words[index - 1]?.text ?? "", next:words[index + 1]?.text ?? "", exhibitNumber:isExhibitNumber(words, index) });
    if (display === text) return { ...word, display };
    // Flagged, not refused. Every other rule here writes the same word differently; this one
    // chooses between Miss, Ms. and Mrs., which a certified record distinguishes and the
    // recording does not settle. The ruling is that all of them are Ms., and it stands -- but a
    // reporter should be able to see where that choice was made rather than have it disappear
    // into the reading, which is what HONORIFIC_MISSING exists to prevent for the same word.
    const honorificAssumed = /^miss$/i.test(split(text).body) && display === "Ms.";
    return honorificAssumed ? { ...word, display, styled:true, honorificAssumed:true } : { ...word, display, styled:true };
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
