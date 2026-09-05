// Turning Deepgram's speaker roles into a Texas deposition transcript's actual labels.
//
// Nothing in this repo has ever produced `Q.`, `A.`, or `MR. BENTLEY:` -- the screens render
// the raw enum, so a reporter sees "questioning attorney" where the record needs "Q.". This
// module is that mapping, and only that: it decides element type and label, never text.
//
// Every coordinate below was measured from the reporter-verified Etminan transcript (77 pages,
// XPS print image plus the DOCX), not taken from a specification. Where the specimen was
// internally inconsistent, the plurality form is used and the reason is recorded on the rule.

import { TEXAS_FREELANCE_DEPOSITION_V1 } from "./texas-freelance-deposition-profile.mjs";

export const LINE_WIDTH = TEXAS_FREELANCE_DEPOSITION_V1.charactersPerLine;

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
//   NEW_PARAGRAPH at col 15 -- ALSO A REPORTER RULING, under Texas UFM 2.11: the first line of
//     any new paragraph, including a continuation inside a long answer, begins at the third stop
//     and wraps flush to the left margin. This was col 5, which aligned a continuation with the
//     Q./A. designations rather than with the body of the testimony it continues.
//
//     Like the colloquy move, this is a deliberate divergence and a pinned test was updated by
//     ruling rather than by defect. Both changes are traceable to a decision recorded here, and
//     neither should be "corrected" back by someone diffing against the specimen.
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
  // Ruled: UFM 2.11 puts the first line of a new paragraph at the third stop, 1.5in, wrapping
  // flush left. Column 5 aligned continuations with the Q./A. designations rather than with the
  // body of the testimony they continue.
  [ELEMENT.NEW_PARAGRAPH]:          { tokenCol:null, textCol:15, wrapCol:0, centered:false },
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
  widthTwips: TEXAS_FREELANCE_DEPOSITION_V1.page.widthTwips,
  heightTwips: TEXAS_FREELANCE_DEPOSITION_V1.page.heightTwips,
  marginTwips: Object.freeze({ left:TEXAS_FREELANCE_DEPOSITION_V1.text.leftMarginTwips, right:TEXAS_FREELANCE_DEPOSITION_V1.text.rightMarginTwips, top:TEXAS_FREELANCE_DEPOSITION_V1.text.topMarginTwips, bottom:TEXAS_FREELANCE_DEPOSITION_V1.text.bottomMarginTwips }),
});

// Tab positions are measured from the left margin, so the centre of the paper is half the page
// width less the left margin: 12240/2 - 1800 = 4320 twips, 3.0in. Derived, not typed.
const PAGE_CENTRE_FROM_MARGIN = PAGE.widthTwips / 2 - PAGE.marginTwips.left;

export const TAB_STOPS = Object.freeze({
  leftInches: TEXAS_FREELANCE_DEPOSITION_V1.tabs.inches,
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

// The heading that announces an examination, by type -- Phase D2.
//
// A freelance deposition's first examination is headed simply `EXAMINATION`; later examination
// types retain their qualified names. This is structural text, not testimony, and is derived from
// the same resolved examination sequence that drives Q./A. labels and the examination index.
//
// The three below are the reporter's stated forms. Nothing in the repository defined them, and
// nothing in the specimens could -- every specimen is a single-examiner deposition, so a
// cross-examination heading never appears in one.
export const EXAMINATION_HEADINGS = Object.freeze({ DIRECT:"EXAMINATION", CROSS:"CROSS-EXAMINATION", REDIRECT:"REDIRECT EXAMINATION", RECROSS:"RECROSS-EXAMINATION" });

// How an examination is named on the index. Same source as the headings above, so the page and the
// index cannot describe one examination two ways.
//
// DIRECT is "Examination", not "Direct Examination", and that is settled on the source rather than
// chosen. F-09 in docs/opening-procedures/ufm-opening-tier-findings.md measures UFM Figures 14 and
// 15 as identical but for one line: the trial record heads DIRECT EXAMINATION, the freelance
// deposition heads EXAMINATION. This application produces freelance depositions. The certified
// specimen agrees -- thomas-regression encodes a real transcript's index entry as
// { examiner: "Mr. Nunez" }, printed "Examination by Mr. Nunez", with no type.
//
// The other three are a Depo-Pro presentation policy, not a prescribed form. No source prescribes
// them: every certified specimen in this project is a single-examiner deposition, so a
// cross-examination index line has never appeared in one. They mirror the body headings above so a
// reader meets the same words in both places.
export const EXAMINATION_INDEX_LABELS = Object.freeze({ DIRECT:"Examination", CROSS:"Cross-Examination", REDIRECT:"Redirect Examination", RECROSS:"Recross-Examination" });

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
    const rawHonorific=String(candidate?.honorific??"").trim().toUpperCase();
    const honorific = rawHonorific==="NONE"?"":rawHonorific.replace(/\.?$/, ".");
    if (!candidate?.honorific) {
      findings.push({ code:"HONORIFIC_MISSING", speakerIdentity:id, name, message:`No honorific recorded for ${name || id}. The label reads "${surname.toUpperCase()}" until one is set; Depo-Pro will not guess between MR., MS., and DR.` });
      labels[id] = surname.toUpperCase();
    } else if(rawHonorific==="NONE") {
      labels[id]=surname.toUpperCase();
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
 *
 * `examinations` is the ordered boundary list from the overlay -- Phase C of the examination
 * model. Until it arrived, `examiner` was one identity for the whole transcript, so defending
 * counsel's cross rendered as colloquy and the answers to it as THE WITNESS: rather than A.,
 * 450 of 1,602 paragraphs on a realistic deposition. A boundary moves examination authority as
 * this function walks; it does not touch `transcriptRole`, which keeps its participant meaning.
 *
 * An empty list leaves every branch below exactly as it was. That is not a happy accident of the
 * implementation -- it is the contract that lets an existing single-examiner deposition render
 * unchanged, and it is asserted rather than assumed.
 *
 * Returns `{ paragraphs, examinations }` -- Phase D1. `examinations` is the resolved sequence, and
 * it is an OUTPUT of this walk rather than an input to it. That matters: the examiner is sometimes
 * adopted here, from the first questioning attorney seen, and until now nobody outside could learn
 * who that was. Q./A. knew and the index did not, so an index entry for the first examination had
 * no name to print. Resolving it anywhere else would be a second authority computing the same fact
 * from the same evidence, which is how two answers to one question get into a certified document.
 *
 * The first examination is implicit and carries no `atWordId`. It is derived from the examiner the
 * transcript already knows, so an existing deposition needs no overlay operation and no migration
 * to render exactly as it does today. A synthetic DIRECT boundary would be a stored fact standing
 * in for a derivable one.
 */
export function labelParagraphs(paragraphs = [], { labels = {}, examinerIdentity = null, examinations = [], colloquy = null } = {}) {
  let examiner = examinerIdentity;
  // Indexed by the word each boundary begins at, because a paragraph is what gets labelled and a
  // paragraph is a list of word ids. applyOverlay has already put them in transcript order and
  // dropped any whose anchor no longer exists.
  // The utterances the reporter has said are not questions -- §247. Empty or absent leaves every
  // branch below exactly as it was, which is what lets an existing transcript render unchanged.
  const colloquyWordIds = colloquy instanceof Set ? colloquy : new Set(colloquy ?? []);
  const boundaryByWordId = new Map();
  for (const boundary of examinations ?? []) if (boundary?.atWordId) boundaryByWordId.set(boundary.atWordId, boundary);
  // The resolved sequence every downstream consumer reads: Q./A. context, the heading, the BY-line
  // and the index entry all come from this one list.
  const examinationSequence = [];
  const openExamination = (rawExaminerPersonId, type, atWordId, implicit) => {
    // An examination nobody can name is not recorded. The index would have to print "Examination
    // by" somebody, and inventing that is the failure the boundary operation already refuses at
    // validation. A transcript where no examiner is ever established has no examination to index.
    //
    // Trimmed, because this function takes its boundary list directly and the operation validator
    // is not in that path. A whitespace id is truthy, so a falsy check alone recorded an
    // examination whose examiner printed as nothing -- caught by a mutation that should have died
    // and did not.
    const examinerPersonId = String(rawExaminerPersonId ?? "").trim();
    if (!examinerPersonId) return;
    const previous = examinationSequence.at(-1);
    // Keyed on examiner AND type. The examiner alone is not enough -- a recross by the same
    // attorney who just crossed is a new examination with a new heading, and the labeller
    // correctly treats it as no change to who is asking. Two different facts about one word.
    if (previous && previous.examinerPersonId === examinerPersonId && previous.type === type) {
      // The reporter's own boundary outranks the derived one. Both name the same examination, so a
      // second heading would be wrong -- but the implicit entry carries no anchor and places itself
      // at the examiner's first printing question, which is where the machine guessed rather than
      // where the examination began. Found on Heath Thomas: the reporter marked the paragraph after
      // the witness was sworn, and the boundary was discarded as a duplicate, leaving EXAMINATION /
      // BY NUNEZ: standing above the appearances. Replacing keeps one heading and puts it where the
      // reporter said, which is the only authority that actually knows.
      if (previous.implicit && !implicit) examinationSequence[examinationSequence.length - 1] = { examinerPersonId, type, atWordId, implicit };
      return;
    }
    examinationSequence.push({ examinerPersonId, type, atWordId, implicit });
  };
  if (examinerIdentity) openExamination(examinerIdentity, "DIRECT", null, true);
  // Attorney colloquy can interrupt a question without closing its Q/A relationship. Keep that
  // semantic state separately from the immediately preceding rendered element so an objection
  // does not turn the responsive testimony into generic witness colloquy.
  let pendingQuestion = false;
  // A resumption marker survives the responsive answer: the next question is still the
  // examiner's return from the intervening attorney colloquy.
  let resumptionByLinePending = false;
  const labelled = paragraphs.map(paragraph => {
    // Authority moves before the paragraph holding the anchor is labelled, because that paragraph
    // is the new examiner's first question -- the reporter marks the word their examination begins
    // at, not the word after it.
    //
    // A boundary naming whoever is already examining is a no-op rather than a reset. It says
    // nothing new about the proceeding, and treating it as a change would clear the resumption
    // state a single-examiner transcript depends on.
    for (const wordId of paragraph?.asrWordIds ?? []) {
      const boundary = boundaryByWordId.get(wordId);
      if (!boundary) continue;
      // A boundary naming nobody is not a boundary. This has to refuse before the assignment
      // below, not merely be left out of the sequence: skipping only the record still moved
      // `examiner` to the nameless value, which cleared examination authority and let the next
      // questioning attorney be adopted as a second implicit DIRECT. The Q./A. rule and the index
      // then disagreed about who was examining -- from a malformed boundary, silently.
      const boundaryExaminer = String(boundary.examinerPersonId ?? "").trim();
      if (!boundaryExaminer) continue;
      openExamination(boundaryExaminer, boundary.type, boundary.atWordId, false);
      if (boundaryExaminer === examiner) continue;
      examiner = boundaryExaminer;
      // A new examiner begins; they do not resume. An inline `(BY MS. RAMIREZ)` here would be the
      // wrong mark for a handover -- the standalone heading and by-line that belong at one are
      // Phase D -- and leaving the flag set would emit exactly that.
      resumptionByLinePending = false;
    }
    const role = String(paragraph?.transcriptRole ?? "").toUpperCase();
    const identity = paragraph?.speakerIdentity ?? null;
    const label = identity && labels[identity] ? labels[identity] : null;

    // The witness answering a question is "A."; the witness speaking when no question is open
    // -- asking to see an exhibit, responding to the reporter -- is "THE WITNESS:". The
    // specimen uses both, 2 of the latter. The distinction is whether a question remains open;
    // attorney colloquy can intervene without closing it. The reporter can still override this
    // judgement from the Workspace when the record establishes otherwise.
    if (role === "WITNESS") {
      if (pendingQuestion) return emit(ELEMENT.ANSWER, "A.", null, false);
      return emit(ELEMENT.COLLOQUY, `${FIXED_LABELS.WITNESS}:`, null);
    }
    if (identity && examiner && identity === examiner) {
      // The examiner said something that is not a question, and the reporter has said so. §247.
      //
      // Three things happen together, and each is a separate way to get this wrong.
      //
      // It carries her own name, because she did say it. The speaker is not changed -- misattributing
      // the utterance was the only way to reach colloquy before this operation existed, and it put
      // another person's name on a line they never said.
      //
      // The open question stays open. Attorney colloquy already does not close one, and an aside by
      // the examiner is no different: "Q. Do you remember the accident? / MS. WHITFIELD: Let me be
      // more specific. / A. Yes." must keep its A.
      //
      // The resumption marker is left exactly as it was found -- neither consumed nor set. Not
      // consumed, because `(BY MS. WHITFIELD)` announces her returning to questioning and belongs on
      // the question, not on the aside before it; measured, it was landing on the aside. Not set,
      // because her own aside is not an interruption by somebody else, and a by-line after it would
      // announce a return from nowhere.
      if ((paragraph?.asrWordIds ?? []).some(wordId => colloquyWordIds.has(wordId))) {
        // Marked on the paragraph so the Workspace can offer to clear it. Without this the screen
        // could tell the reporter a line reads as colloquy but not whether that is the model's
        // doing or their own, and those have different remedies.
        return { ...emit(ELEMENT.COLLOQUY, label ? `${label}:` : null, null, pendingQuestion), examinerColloquy:true };
      }
      const byLine = resumptionByLinePending && label ? `(BY ${label})` : null;
      resumptionByLinePending = false;
      return emit(ELEMENT.QUESTION, "Q.", byLine, true);
    }
    if (!examiner && ATTORNEY_ROLES.has(role) && role === "QUESTIONING_ATTORNEY" && identity) {
      // First questioning attorney seen becomes the examiner, so a transcript with no examiner
      // set still renders as questions and answers rather than as undifferentiated colloquy.
      examiner = identity;
      // The adoption the readiness check found invisible. Recorded at the moment it happens, so
      // the sequence names the same person the Q./A. rule just started trusting -- a canonical
      // participant id, never a diarization index.
      openExamination(identity, "DIRECT", null, true);
      resumptionByLinePending = false;
      return emit(ELEMENT.QUESTION, "Q.", null, true);
    }
    if(ATTORNEY_ROLES.has(role)){
      if(pendingQuestion)resumptionByLinePending = true;
      return emit(ELEMENT.COLLOQUY, label ? `${label}:` : null, null, pendingQuestion);
    }
    resumptionByLinePending = false;
    // A ROLE ESTABLISHED WITHOUT A PERSON still has a designation, and the record should say it.
    //
    // Trial #1's videographer opens the deposition, states the date and time, and goes on and off
    // the record -- unmistakably the videographer, and never once named, in the recording or in the
    // Notice. Before this, that paragraph printed with no designation at all, because the label is
    // looked up by canonical identity and there is nobody to look up.
    //
    // FIXED_LABELS already holds the answer and the WITNESS branch above already reaches it this
    // way. The alternative -- inventing a nameless participant to hang the role on -- would put a
    // person who does not exist into the record that feeds the certificate.
    //
    // Only the four fixed roles, and only when no identity is recorded. An attorney has no fixed
    // label because an attorney is named; this must never manufacture one.
    if (!identity && FIXED_LABELS[role]) return emit(ELEMENT.COLLOQUY, `${FIXED_LABELS[role]}:`, null, false);
    return emit(ELEMENT.COLLOQUY, label ? `${label}:` : null, null, false);

    function emit(elementType, token, byLine, nextPendingQuestion = false) {
      pendingQuestion = nextPendingQuestion;
      return { ...paragraph, elementType, label:token, byLine, layout:LAYOUT[elementType], unlabeledSpeaker:!label && elementType === ELEMENT.COLLOQUY };
    }
  });
  return { paragraphs:labelled, examinations:examinationSequence };
}
