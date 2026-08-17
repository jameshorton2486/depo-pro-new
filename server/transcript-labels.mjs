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

// tokenCol -- where "Q."/"A."/"NAME:" begins. textCol -- where the spoken words begin.
// wrapCol -- where every runover line begins. `centered` computes its column from the string,
// which is the correction that matters: nine "(Exhibit N marked)" are 18 characters and land
// at column 22 every time, so 22 looks like a rule and is actually (62-18)/2. A tenth exhibit
// is 19 characters and lands at 21; "(Deposition concluded at 2:50 p.m.)" lands at 13.
export const LAYOUT = Object.freeze({
  [ELEMENT.QUESTION]:               { tokenCol:5,  textCol:10, wrapCol:0, centered:false },
  [ELEMENT.ANSWER]:                 { tokenCol:5,  textCol:10, wrapCol:0, centered:false },
  [ELEMENT.COLLOQUY]:               { tokenCol:5,  textCol:null, wrapCol:0, centered:false, inlineAfterLabel:"  " },
  [ELEMENT.NEW_PARAGRAPH]:          { tokenCol:null, textCol:5, wrapCol:0, centered:false },
  [ELEMENT.BY_LINE]:                { tokenCol:0,  textCol:0,  wrapCol:0, centered:false },
  [ELEMENT.PARENTHETICAL_CENTERED]: { tokenCol:null, textCol:null, wrapCol:0, centered:true },
  [ELEMENT.PARENTHETICAL_INDENTED]: { tokenCol:null, textCol:15, wrapCol:0, centered:false },
  [ELEMENT.HEADING]:                { tokenCol:null, textCol:null, wrapCol:0, centered:true },
});

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
