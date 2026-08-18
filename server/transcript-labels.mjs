// Turning Deepgram's speaker roles into a Texas deposition transcript's actual labels.
//
// Nothing in this repo has ever produced `Q.`, `A.`, or `MR. BENTLEY:` -- the screens render
// the raw enum, so a reporter sees "questioning attorney" where the record needs "Q.". This
// module is that mapping, and only that: it decides element type and label, never text.
//
// Every coordinate below was measured from the reporter-verified Etminan transcript (77 pages,
// XPS print image plus the DOCX), not taken from a specification. Where the specimen was
// internally inconsistent, the plurality form is used and the reason is recorded on the rule.

export const LINE_WIDTH = 62; // measured: right edge at 7.45in, 10 cpi, col 0 at 1.25in

export const ELEMENT = Object.freeze({
  QUESTION: "QUESTION", ANSWER: "ANSWER", COLLOQUY: "COLLOQUY", NEW_PARAGRAPH: "NEW_PARAGRAPH",
  BY_LINE: "BY_LINE", PARENTHETICAL_CENTERED: "PARENTHETICAL_CENTERED",
  PARENTHETICAL_INDENTED: "PARENTHETICAL_INDENTED", HEADING: "HEADING",
});

// Two values below are CHOSEN, not measured, and diffing the exporter against the specimen
// will show a mismatch at both. That is expected, not a regression:
//
//   PARENTHETICAL_INDENTED at col 15 -- the specimen's two of these carry identical encoding
//     (four literal tabs) and printed at col 20 and col 15. Four tabs exhaust the three
//     defined stops, so the fourth resolves against Word's default grid and its position
//     depends on context. Col 15 is Tab Stop 3 at 2160 twips, an actually-defined stop.
//   COLLOQUY at col 15 for every speaker -- SUPERSEDED BY REPORTER RULING. The specimen puts
//     attorney labels at col 5 (28x) and THE VIDEOGRAPHER:/THE REPORTER: at col 15 (7x), two
//     incompatible encodings for one semantic element. This previously normalised to the
//     plurality, col 5. The reporter has ruled that all colloquy takes three tabs, col 15, and
//     that the specimen's 28 attorney labels at col 5 are defects rather than the standard.
//
//     A future diff of exported output against the certified Etminan transcript MUST therefore
//     show 28 mismatches at colloquy, and they must not be reconciled back. That is the whole
//     reason this paragraph exists.
//
// The runover for both IS measured: flush to col 0, no block indent. The one multi-line
// parenthetical in the specimen wraps to col 0 exactly like testimony.
//
// tokenCol -- where "Q."/"A."/"NAME:" begins. textCol -- where the spoken words begin.
// wrapCol -- where every runover line begins. `centered` computes its column from the string,
// which is the correction that matters: nine "(Exhibit N marked)" are 18 characters and land
// at column 22 every time, so 22 looks like a rule and is actually (62-18)/2. A tenth exhibit
// is 19 characters and lands at 21; "(Deposition concluded at 2:50 p.m.)" lands at 13.
export const LAYOUT = Object.freeze({
  [ELEMENT.QUESTION]:               { tokenCol:5,  textCol:10, wrapCol:0, centered:false },
  [ELEMENT.ANSWER]:                 { tokenCol:5,  textCol:10, wrapCol:0, centered:false },
  [ELEMENT.COLLOQUY]:               { tokenCol:15, textCol:null, wrapCol:0, centered:false, inlineAfterLabel:"  " },
  [ELEMENT.NEW_PARAGRAPH]:          { tokenCol:null, textCol:5, wrapCol:0, centered:false },
  [ELEMENT.BY_LINE]:                { tokenCol:0,  textCol:0,  wrapCol:0, centered:false },
  [ELEMENT.PARENTHETICAL_CENTERED]: { tokenCol:null, textCol:null, wrapCol:0, centered:true },
  [ELEMENT.PARENTHETICAL_INDENTED]: { tokenCol:null, textCol:15, wrapCol:0, centered:false },
  [ELEMENT.HEADING]:                { tokenCol:null, textCol:null, wrapCol:0, centered:true },
});

// Tab stops, for the export the reporter actually needs.
//
// The columns above describe where characters land on a printed page. CaseCATalyst does not
// read columns -- it reads tabs -- so a transcript leaving this application carries literal tab
// characters resolving against a defined ruler, and the two descriptions have to agree or the
// screen and the file will disagree with nothing catching it.
//
// The ruler, and the two halves of it have different standing.
//
// The three left stops -- 0.5, 1.0 and 1.5 inches, 720/1440/2160 twips -- are measured. They are
// defined in the specimen's paragraph properties AND they position characters: 503 Q./A.
// paragraphs land on the first two.
//
// The centre stop is NOT measured, and the earlier claim that it was is withdrawn. The specimen
// defines a centre stop at 4680 in 710 paragraphs and uses it in none: all nine exhibit
// parentheticals are centred with jc="center" and carry no tab at all. A property that has never
// positioned a character measures nothing, however consistently it appears -- being present in a
// file is not evidence.
//
// 4320 is derived instead, from the reporter's ruling plus the specimen's page geometry. The
// ruling is the PHYSICAL PAGE centre; tab positions are measured from the left margin, so that
// is 12240/2 - 1800. For reference, the three candidates are a quarter inch apart in total:
// page centre 4320 (3.000in), text-block centre 4500 (3.125in), the specimen's unused stop 4680
// (3.250in). Only the first implements the ruling.
//
// centerColumn() below computes the text-block centre and is therefore the wrong basis for an
// exported line -- a centre tab stop does the centring, not computed padding. It is kept only
// because the screen still positions by character column; when the Workspace renders from this
// model it goes.
//
// Q. and A. are measured and unanimous: 503 of the specimen's paragraphs carry exactly two tabs,
// one before the token and one after it.
//
// COLLOQUY and the exhibit parenthetical are the reporter's instruction where the specimen is
// not a usable authority. The specimen encodes colloquy two incompatible ways -- 33 paragraphs
// with a 0.5-inch first-line indent and 7 with three literal tabs -- and centres its exhibit
// lines with paragraph justification and no tabs at all. Justification does not survive into a
// CAT system as a tab does, so the exhibit line takes one tab to the centre stop instead.
//
// leadingTabs is what precedes the token, tabsAfterToken what separates token from text. A
// four-tab form is deliberately not available: the specimen's two four-tab parentheticals
// exhaust the three defined stops, so the fourth resolves against the word processor's default
// grid and lands in different places in different contexts. Every tab here reaches a real stop.
// The page the specimen is set on, read from its sectPr. Present so the centre stop can be
// derived rather than asserted: a margin change must move the stop, not silently invalidate it.
export const PAGE = Object.freeze({
  widthTwips: 12240,   // 8.5in
  heightTwips: 15840,  // 11in
  marginTwips: Object.freeze({ left:1800, right:1440, top:1440, bottom:1440 }),
});

// Tab positions are measured from the left margin, so the centre of the paper is half the page
// width less the left margin: 12240/2 - 1800 = 4320 twips, 3.0in. Derived, not typed.
const PAGE_CENTRE_FROM_MARGIN = PAGE.widthTwips / 2 - PAGE.marginTwips.left;

export const TAB_STOPS = Object.freeze({
  leftInches: Object.freeze([0.5, 1.0, 1.5]),
  centreInches: PAGE_CENTRE_FROM_MARGIN / 1440,
  twips: Object.freeze({ left:Object.freeze([720, 1440, 2160]), centre:PAGE_CENTRE_FROM_MARGIN }),
});

export const TABS = Object.freeze({
  [ELEMENT.QUESTION]:               { leadingTabs:1, tabsAfterToken:1, toCentreStop:false },
  [ELEMENT.ANSWER]:                 { leadingTabs:1, tabsAfterToken:1, toCentreStop:false },
  [ELEMENT.COLLOQUY]:               { leadingTabs:3, tabsAfterToken:0, toCentreStop:false },
  [ELEMENT.NEW_PARAGRAPH]:          { leadingTabs:3, tabsAfterToken:0, toCentreStop:false },
  // Flush left in the specimen, and left flush here: a BY-line names who resumes questioning and
  // is conventionally set at the margin. It is not one of the "other paragraphs" that indent.
  [ELEMENT.BY_LINE]:                { leadingTabs:0, tabsAfterToken:0, toCentreStop:false },
  [ELEMENT.PARENTHETICAL_CENTERED]: { leadingTabs:1, tabsAfterToken:0, toCentreStop:true },
  [ELEMENT.PARENTHETICAL_INDENTED]: { leadingTabs:3, tabsAfterToken:0, toCentreStop:false },
  [ELEMENT.HEADING]:                { leadingTabs:1, tabsAfterToken:0, toCentreStop:true },
});

/**
 * One line as it leaves for CaseCATalyst: literal tabs, then the token, then the text.
 *
 * Returns the tabs and the string separately as well as joined, because an exporter writing
 * DOCX needs to emit tab elements rather than tab characters, and a screen needs neither.
 */
export function tabbedLine(elementType, { token = null, text = "" } = {}) {
  const spec = TABS[elementType] ?? TABS[ELEMENT.COLLOQUY];
  const leading = "	".repeat(spec.leadingTabs);
  const separator = "	".repeat(spec.tabsAfterToken);
  const body = token ? `${token}${separator}${text}` : String(text ?? "");
  return { leadingTabs:spec.leadingTabs, tabsAfterToken:spec.tabsAfterToken, toCentreStop:spec.toCentreStop, line:`${leading}${body}` };
}

export function centerColumn(text, width = LINE_WIDTH) {
  return Math.max(0, Math.floor((width - String(text ?? "").length) / 2));
}

const FIXED_LABELS = Object.freeze({ COURT_REPORTER:"THE REPORTER", VIDEOGRAPHER:"THE VIDEOGRAPHER", INTERPRETER:"THE INTERPRETER", WITNESS:"THE WITNESS" });
const ATTORNEY_ROLES = new Set(["QUESTIONING_ATTORNEY", "DEFENDING_ATTORNEY"]);

/**
 * Builds the display label for each canonical speaker.
 *
 * An honorific is never inferred. "MR." cannot be derived from a first name without guessing
 * at someone's title on a court record, and there is no heuristic that does not sometimes get
 * it wrong. When one is missing the label falls back to the surname alone and a finding is
 * raised so the reporter can set it on the data sheet -- visible and fixable, never invented.
 */
export function buildSpeakerLabels(candidates = []) {
  const labels = {}, findings = [];
  for (const candidate of candidates) {
    const id = String(candidate?.id ?? "").trim();
    if (!id) continue;
    const role = String(candidate?.defaultRole ?? candidate?.role ?? "").toUpperCase();
    const explicit = String(candidate?.displayLabel ?? "").trim();
    if (explicit) { labels[id] = explicit.toUpperCase(); continue; }
    if (FIXED_LABELS[role]) { labels[id] = FIXED_LABELS[role]; continue; }
    const name = String(candidate?.label ?? candidate?.fullName ?? "").trim();
    const surname = name.split(/\s+/).filter(Boolean).at(-1) ?? "";
    const honorific = String(candidate?.honorific ?? "").trim().replace(/\.?$/, ".");
    if (!candidate?.honorific) {
      findings.push({ code:"HONORIFIC_MISSING", speakerIdentity:id, name, message:`No honorific recorded for ${name || id}. The label reads "${surname.toUpperCase()}" until one is set; Depo-Pro will not guess between MR., MS., and DR.` });
      labels[id] = surname.toUpperCase();
    } else {
      labels[id] = `${honorific} ${surname}`.toUpperCase();
    }
  }
  return { labels, findings };
}

/**
 * Assigns an element type and label to each display paragraph.
 *
 * `examinerIdentity` is whoever is currently taking the deposition. Their paragraphs become
 * questions; the witness's become answers; everyone else becomes colloquy under their own name.
 *
 * A question that does not directly follow a question or answer carries an inline `(BY MR. X)`
 * resumption. The specimen has 21 of these against a single standalone `BY MR. BENTLEY:` at the
 * start of the examination, so resumption after colloquy is the common case, not examiner
 * change -- there is only one examiner in that deposition and the by-line still appears 21 times.
 */
export function labelParagraphs(paragraphs = [], { labels = {}, examinerIdentity = null } = {}) {
  let examiner = examinerIdentity;
  let previous = null;
  return paragraphs.map(paragraph => {
    const role = String(paragraph?.transcriptRole ?? "").toUpperCase();
    const identity = paragraph?.speakerIdentity ?? null;
    const label = identity && labels[identity] ? labels[identity] : null;

    // The witness answering a question is "A."; the witness speaking when no question is open
    // -- asking to see an exhibit, responding to the reporter -- is "THE WITNESS:". The
    // specimen uses both, 2 of the latter. The distinction is the preceding element, and it is
    // a judgement the reporter can override from the Workspace when it is wrong.
    if (role === "WITNESS") {
      if (previous === ELEMENT.QUESTION) return emit(ELEMENT.ANSWER, "A.", null);
      return emit(ELEMENT.COLLOQUY, `${FIXED_LABELS.WITNESS}:`, null);
    }
    if (identity && examiner && identity === examiner) {
      const byLine = previous !== null && previous !== ELEMENT.QUESTION && previous !== ELEMENT.ANSWER && label ? `(BY ${label})` : null;
      return emit(ELEMENT.QUESTION, "Q.", byLine);
    }
    if (!examiner && ATTORNEY_ROLES.has(role) && role === "QUESTIONING_ATTORNEY" && identity) {
      // First questioning attorney seen becomes the examiner, so a transcript with no examiner
      // set still renders as questions and answers rather than as undifferentiated colloquy.
      examiner = identity;
      return emit(ELEMENT.QUESTION, "Q.", null);
    }
    return emit(ELEMENT.COLLOQUY, label ? `${label}:` : null, null);

    function emit(elementType, token, byLine) {
      previous = elementType;
      return { ...paragraph, elementType, label:token, byLine, layout:LAYOUT[elementType], unlabeledSpeaker:!label && elementType === ELEMENT.COLLOQUY };
    }
  });
}
