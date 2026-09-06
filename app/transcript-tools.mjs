// The reporter's correction cockpit, as decisions rather than as markup.
//
// The Workspace has no test harness in this repository, so anything left inside the component is
// something nothing checks. What lives here is the part that can be wrong: which speakers to offer,
// which structural actions apply to the paragraph in hand, what the review worklist contains, and
// where a paragraph sits in the printed record.
//
// WHAT PRODUCTION TRIAL #1 CHANGED ABOUT THIS PANEL. The diagnostic measured 77 genuine missing
// turn boundaries in Baier and found that none of them needed audio to locate, that the median one
// is a single word, and that the existing two-click correction runs in about 310 ms. It also found
// that accepting AI proposals one at a time costs a 195-second re-analysis each, which is roughly
// 580 times slower than simply correcting the same locations by hand.
//
// So the panel is not an acceptance queue. AI says WHERE to look; the reporter's own controls do the
// work. That is the whole design, and REVIEW below is built as a worklist for exactly that reason.

/**
 * @typedef {{ id:string, text?:string, confidence?:number|null, lowConfidence?:boolean, authored?:boolean, flagged?:boolean }} Word
 * @typedef {{ id:string, speakerIdentity?:string|null, transcriptRole?:string|null, label?:string|null, elementType?:string|null, deepgramSpeaker?:number|null, start?:number|null, end?:number|null, asrWordIds?:string[], words?:Word[] }} Paragraph
 * @typedef {{ id:string, label?:string, defaultRole?:string|null }} Candidate
 * @typedef {{ pageNumber:number, lines?:{ position:number, paragraphId?:string|null }[] }} Page
 * @typedef {{ wordId?:string, endWordId?:string, speakerIdentity?:string|null, deepgramSpeaker?:number|null, proposalLevel?:string, correctionType?:string, text?:string, confidenceScore?:number, evidenceSource?:string }} Proposal
 * @typedef {{ paragraphId?:string, wordId?:string|null, proposals?:Proposal[], reasons?:string[] }} Location
 */

/**
 * Where a paragraph sits in the printed record, which is how a reporter refers to a passage.
 *
 * @param {{ paragraphId?:string|null, pages?:Page[] }} [input]
 */
export function paragraphLocation({ paragraphId, pages = [] } = {}) {
  if (!paragraphId) return null;
  for (const page of pages) {
    for (const line of page.lines ?? []) {
      if (line.paragraphId === paragraphId) return { page: page.pageNumber, line: line.position };
    }
  }
  return null;
}

const seconds = value => (Number.isFinite(value) ? value : null);

/**
 * What SELECTED PARAGRAPH shows.
 *
 * @param {{ paragraph?:Paragraph|null, pages?:Page[], labels?:Record<string,string>, saveState?:string }} [input]
 *
 * Location, time, who spoke, how it prints, and whether it is saved. Everything a reporter needs to
 * know they are looking at the right passage, and nothing they would have to decode.
 *
 * Internal ids are deliberately absent. They belong under Details, where somebody debugging can find
 * them; a reporter correcting a transcript should never have to read one.
 */
export function selectedParagraphSummary({ paragraph, pages = [], labels = {}, saveState = "saved" } = {}) {
  if (!paragraph) return null;
  const measured = (paragraph.words ?? []).filter(word => Number.isFinite(word.confidence));
  const identity = paragraph.speakerIdentity ?? null;
  return {
    paragraphId: paragraph.id,
    location: paragraphLocation({ paragraphId: paragraph.id, pages }),
    start: seconds(paragraph.start),
    end: seconds(paragraph.end),
    // Who spoke, by name. A diarization cluster is not a speaker and is not offered as one here.
    speakerLabel: identity ? (labels[identity] ?? identity) : null,
    speakerIdentity: identity,
    // How it prints. "Q." and "A." are derived, so this reports rather than proposes.
    designation: paragraph.label ?? null,
    elementType: paragraph.elementType ?? null,
    playable: Number.isFinite(paragraph.start) && Number.isFinite(paragraph.end),
    saveState,
    marked: (paragraph.words ?? []).some(word => word.flagged),
    // Behind Details: diagnostics, not correction.
    details: {
      paragraphId: paragraph.id,
      deepgramSpeaker: paragraph.deepgramSpeaker ?? null,
      transcriptRole: paragraph.transcriptRole ?? null,
      words: (paragraph.words ?? []).length,
      averageConfidence: measured.length
        ? measured.reduce((sum, word) => sum + word.confidence, 0) / measured.length
        : null,
      lowConfidenceWords: (paragraph.words ?? []).filter(word => word.lowConfidence).length,
      authored: (paragraph.words ?? []).filter(word => word.authored).length,
    },
  };
}

/**
 * What the selected paragraph prints as RIGHT NOW, in the words the reporter can see on the page.
 *
 * An unattributed paragraph prints `SPEAKER 3:` in the transcript, so the panel says `SPEAKER 3` --
 * not "no speaker recorded", which is true but does not match anything on screen. The reporter is
 * looking at one and reading the other, and the whole job here is to connect them.
 *
 * The number is the diarization cluster index, exactly as the print model derives it. A number that
 * cannot be carried from one control to another is worse than no number.
 *
 * @param {{ paragraph?:Paragraph|null, labels?:Record<string,string> }} [input]
 */
export function currentSpeakerDescription({ paragraph, labels = {} } = {}) {
  if (!paragraph) return null;
  const identity = paragraph.speakerIdentity ?? null;
  if (identity) return { known: true, text: String(labels[identity] ?? identity).replace(/:$/, "") };
  const cluster = paragraph.deepgramSpeaker;
  if (Number.isInteger(cluster)) return { known: false, text: `SPEAKER ${cluster}` };
  return { known: false, text: "SPEAKER UNKNOWN" };
}

/**
 * The other scope, described so its size is impossible to miss.
 *
 * Assigning a speaker from the panel changes THIS PASSAGE. Mapping a whole diarization cluster
 * changes every passage in it, and Trial #1 proved that is often wrong: cluster 3 there holds 86
 * passages, of which at least four are not the witness -- including opposing counsel reserving
 * questions till the time of trial. A reporter who clicks a name should never discover afterwards
 * that they moved 86 passages.
 *
 * So this returns the count and leaves the action elsewhere. It is a signpost, not a button.
 *
 * @param {{ paragraph?:Paragraph|null, paragraphs?:Paragraph[] }} [input]
 */
export function globalScopeOption({ paragraph, paragraphs = [] } = {}) {
  const cluster = paragraph?.deepgramSpeaker;
  if (!Number.isInteger(cluster)) return null;
  const sharing = paragraphs.filter(item => item.deepgramSpeaker === cluster);
  if (sharing.length < 2) return null;
  return {
    deepgramSpeaker: cluster,
    passages: sharing.length,
    // Named the way the transcript names it, so the two can be compared.
    label: `SPEAKER ${cluster}`,
    unresolved: sharing.filter(item => !item.speakerIdentity).length,
  };
}

/** Roles that print a designation from the role alone, so they need no name to be usable. */
const PROCEDURAL_ROLES = Object.freeze([
  { role: "VIDEOGRAPHER", label: "Videographer" },
  { role: "INTERPRETER", label: "Interpreter" },
]);

/**
 * Everyone the reporter can hand a paragraph to, built from the record rather than from a list.
 *
 * NAMED PARTICIPANTS come from the canonical roster: the witness, the reporter, and every attorney
 * who appeared. They are ordinary one-click actions carrying a canonical identity.
 *
 * A PROCEDURAL ROLE WITHOUT A NAME is offered when nobody on the roster holds that role. Trial #1
 * needs this and proves why: its videographer opens the deposition, states the time, and goes on and
 * off the record, and is never named -- not in the recording and not in the Notice. The RANGE pass,
 * forced to choose from a roster that did not contain them, proposed the court reporter at 0.95
 * confidence for the videographer's own script. Offering the role truthfully is what closes that.
 *
 * It carries NO canonical identity. The paragraph is attributed to the role, which is a thing the
 * overlay already accepts and the label model already prints as THE VIDEOGRAPHER:. Nothing invents a
 * person, so nothing can reach the certificate claiming somebody was in the room.
 *
 * @param {{ candidates?:Candidate[], labels?:Record<string,string>, examinerIdentity?:string|null }} [input]
 *
 * `Other…` is offered last and creates nobody. It routes to participant entry, where a reporter adds
 * a real person deliberately.
 */
export function speakerActions({ candidates = [], labels = {}, examinerIdentity = null } = {}) {
  const named = candidate => String(labels[candidate.id] ?? candidate.label ?? candidate.id).replace(/:$/, "");
  const roleOf = candidate => String(candidate?.defaultRole ?? "").toUpperCase();
  const actions = [];
  const seen = new Set();

  // The two who speak most come first, because in a deposition they always do.
  //
  // The examiner is found by IDENTITY, not by role name, and the browser gate is why. Trial #1's
  // roster records Ruben Olvera as EXAMINING_ATTORNEY, while the overlay vocabulary and the split
  // control both say QUESTIONING_ATTORNEY -- so a rank built from the role string put the examining
  // attorney last, below the court reporter, in the panel he is used from most.
  const attorney = candidate => roleOf(candidate).includes("ATTORNEY");
  const rank = candidate => {
    if (roleOf(candidate) === "WITNESS") return 0;
    if (examinerIdentity && candidate?.id === examinerIdentity) return 1;
    if (attorney(candidate)) return 2;
    if (roleOf(candidate) === "COURT_REPORTER") return 3;
    return 4;
  };
  for (const candidate of [...candidates].sort((left, right) => rank(left) - rank(right))) {
    const id = String(candidate?.id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    actions.push({
      key: `person:${id}`,
      kind: "person",
      label: named(candidate),
      role: roleOf(candidate) || null,
      speakerIdentity: id,
      transcriptRole: roleOf(candidate) || null,
      // Stated so the reporter can see who the transcript currently believes is asking, without
      // a separate Q. button that would say the same thing less clearly.
      examiner: Boolean(examinerIdentity) && id === examinerIdentity,
    });
  }

  for (const procedural of PROCEDURAL_ROLES) {
    if (candidates.some(candidate => roleOf(candidate) === procedural.role)) continue;
    actions.push({
      key: `role:${procedural.role}`,
      kind: "role",
      label: procedural.label,
      // The truthful state, said plainly. Not a placeholder for a name that is coming.
      note: "name not established",
      role: procedural.role,
      speakerIdentity: null,
      transcriptRole: procedural.role,
      examiner: false,
    });
  }

  actions.push({ key: "other", kind: "other", label: "Other…", note: "add a participant", role: null, speakerIdentity: null, transcriptRole: null, examiner: false });
  return actions;
}

/**
 * The two things "who spoke" can mean, offered as a choice instead of inferred from a click.
 *
 * THE DEFECT THIS EXISTS TO PREVENT, found on the real record. The panel used to decide scope from
 * WHERE the reporter happened to click: the paragraph's first word relabelled the paragraph, any
 * other word cut the paragraph in half and gave the tail away. The reporter clicked a word in the
 * middle of counsel's question meaning "this is the witness", and got a split at "what" --
 * so counsel's own question, mid-sentence, became the witness's answer.
 *
 * It then derived correctly from that wrong input: the false answer consumed the pending question,
 * and the witness's real "Yes." two lines later printed THE WITNESS: instead of A. One misplaced
 * click, two wrong designations, and nothing on screen said why.
 *
 * So the safe reading is the DEFAULT and the destructive one has to be chosen, by name. The second
 * option quotes the word it would cut at, because "a new paragraph starts at the selected word" is
 * only meaningful if you can see which word that is.
 *
 * @param {{ paragraph?:Paragraph|null, selectedWordId?:string|null }} [input]
 */
export function speakerScopeChoices({ paragraph, selectedWordId = null } = {}) {
  if (!paragraph) return [];
  const words = paragraph.words ?? [];
  // The first word the microphone produced. Splitting before it would leave an empty head, so
  // selecting it can only mean the whole paragraph.
  const first = words.find(word => !word.authored)?.id ?? null;
  const choices = [{ key: "paragraph", label: "This whole paragraph", wordId: first, wordText: null }];
  const word = selectedWordId && selectedWordId !== first ? words.find(item => item.id === selectedWordId) : null;
  if (word) choices.push({ key: "here", label: `New paragraph at “${word.text}”`, wordId: word.id, wordText: word.text });
  return choices;
}

/**
 * The structural actions that apply to this paragraph, and only those.
 *
 * @param {{ paragraph?:Paragraph|null, index?:number, total?:number, selectedWordId?:string|null, examinerColloquyAvailable?:boolean, examinationAvailable?:boolean }} [input]
 *
 * Availability is a statement about the paragraph, not a courtesy. "Join to previous" on the first
 * paragraph of a transcript has no meaning, and offering it invites a click that can only fail.
 */
export function structureActions({ paragraph, index = -1, total = 0, selectedWordId = null, examinerColloquyAvailable = false, examinationAvailable = false } = {}) {
  if (!paragraph) return [];
  const words = paragraph.words ?? [];
  const firstRecorded = words.find(word => !word.authored)?.id ?? null;
  // Splitting before the first word would leave an empty head, so the action needs a later word.
  const canSplit = Boolean(selectedWordId) && selectedWordId !== firstRecorded && words.some(word => word.id === selectedWordId);
  return [
    { key: "split", label: "Split here", available: canSplit,
      unavailable: selectedWordId ? "Select a word inside the paragraph, after its first." : "Select the word the next turn begins at." },
    { key: "join-previous", label: "Join to previous", available: index > 0, unavailable: "This is the first paragraph." },
    { key: "join-next", label: "Join to next", available: index >= 0 && index < total - 1, unavailable: "This is the last paragraph." },
    { key: "examiner-colloquy", label: "Examiner colloquy", available: examinerColloquyAvailable, unavailable: "Only the examining attorney's own paragraphs can be marked as colloquy." },
    { key: "examination", label: "Examination begins here", available: examinationAvailable, unavailable: "An examination begins on an attorney's paragraph." },
    { key: "mark", label: "Mark for another listen", available: true, unavailable: null },
    // Last, and its own thing: everything above changes how a paragraph reads, and this removes it.
    { key: "strike", label: "Strike this paragraph", destructive: true,
      available: words.some(word => !word.deleted),
      unavailable: "Every word in this paragraph is already struck." },
  ];
}

/**
 * Striking a whole paragraph: one delete per word it still holds.
 *
 * No new operation. `delete` already exists and is qualified, and the reporter has been able to
 * strike one word at a time from TEXT all along -- this is the same act asked of a paragraph, and
 * it applies as ONE transaction so a single undo brings the whole thing back.
 *
 * Words already struck are skipped rather than struck again: re-striking writes operations that
 * change nothing and lengthen the record of what the reporter did.
 *
 * Reporter-authored words go too. They are text somebody typed into this paragraph, and leaving
 * them behind would strike the testimony and keep the annotation on it.
 *
 * The evidence is untouched by all of it. A struck word is absent from the transcript projection
 * and present in the ASR record, which is the distinction the whole overlay exists to keep.
 *
 * @param {{ paragraph?:Paragraph|null }} [input]
 */
export function strikeParagraphOperations({ paragraph } = {}) {
  return (paragraph?.words ?? [])
    .filter(word => !word.deleted)
    .map(word => ({ op: "delete", wordId: word.id }));
}

/**
 * Deletes complete selected paragraphs as one reversible overlay transaction.
 * Selection may span only part of the first or last paragraph; the explicit paragraph action
 * removes every paragraph touched by that range. Source words and their absolute audio timestamps
 * remain immutable evidence and are never renumbered or rebased.
 *
 * @param {{ paragraphs?:Paragraph[], selectedParagraphId?:string|null, wordIndexes?:Map<string,number>, range?:{first:number,last:number}|null }} [input]
 */
export function deleteSelectedParagraphOperations({ paragraphs = [], selectedParagraphId = null, wordIndexes = new Map(), range = null } = {}) {
  const selected = range
    ? paragraphs.filter(paragraph => (paragraph.words ?? []).some(word => { const index = wordIndexes.get(word.id); return index !== undefined && index >= range.first && index <= range.last; }))
    : paragraphs.filter(paragraph => paragraph.id === selectedParagraphId);
  return selected.flatMap(paragraph => strikeParagraphOperations({ paragraph }));
}

/**
 * The review worklist: where the outstanding work is, category by category.
 *
 * COUNTS ARE OUTSTANDING ITEMS, not findings ever produced. A category whose work is done reads
 * zero, and a category reading zero is not offered for navigation -- a Next button that goes
 * nowhere is worse than no button.
 *
 * @param {{ speakerLocations?:Location[], lowConfidenceWords?:Location[], wordCorrections?:Location[], markedWords?:Location[], unlabelledParagraphs?:Location[] }} [input]
 *
 * Speaker review is deliberately counted in LOCATIONS rather than in proposals. Trial #1 produced
 * 173 proposals sitting in 62 printed paragraphs, and the reporter visits paragraphs.
 */
export function reviewCategories({ speakerLocations = [], lowConfidenceWords = [], wordCorrections = [], markedWords = [], unlabelledParagraphs = [] } = {}) {
  return [
    { key: "speaker", label: "Speaker review", unit: "locations", count: speakerLocations.length, items: speakerLocations },
    { key: "unlabelled", label: "No speaker recorded", unit: "paragraphs", count: unlabelledParagraphs.length, items: unlabelledParagraphs },
    { key: "low-confidence", label: "Low confidence", unit: "words", count: lowConfidenceWords.length, items: lowConfidenceWords },
    { key: "marked", label: "Marked for another listen", unit: "words", count: markedWords.length, items: markedWords },
    { key: "word", label: "Word corrections", unit: "proposals", count: wordCorrections.length, items: wordCorrections },
  ].filter(category => category.count > 0);
}

/**
 * Previous and Next through one category, wrapping at both ends.
 *
 * @param {{ items?:Location[], index?:number, direction?:number }} [input]
 *
 * Wraps because the reporter is working a list, not reading a book: reaching the end of 62 speaker
 * locations and being stopped is a dead end, and continuing round is what they expect.
 */
export function reviewStep({ items = [], index = -1, direction = 1 } = {}) {
  if (!items.length) return { index: -1, item: null };
  const next = index < 0 ? (direction > 0 ? 0 : items.length - 1) : (index + direction + items.length) % items.length;
  return { index: next, item: items[next] };
}

/**
 * The speaker-review worklist, one entry per printed paragraph rather than one per proposal.
 *
 * @param {{ proposals?:Proposal[], paragraphs?:Paragraph[] }} [input]
 *
 * Several proposals commonly land in one paragraph -- Trial #1 had 173 across 62 -- and a reporter
 * who opens that paragraph deals with all of them at once. Listing them separately would send them
 * back to the same place repeatedly.
 */
export function speakerReviewLocations({ proposals = [], paragraphs = [] } = {}) {
  const paragraphOf = new Map();
  for (const paragraph of paragraphs) for (const id of paragraph.asrWordIds ?? []) paragraphOf.set(id, paragraph);
  const grouped = new Map();
  for (const proposal of proposals) {
    const paragraph = paragraphOf.get(proposal.wordId);
    if (!paragraph) continue;
    const entry = grouped.get(paragraph.id) ?? { paragraphId: paragraph.id, wordId: proposal.wordId, reasons: [], proposals: [] };
    entry.proposals.push(proposal);
    const who = proposal.speakerIdentity ?? "someone else";
    if (!entry.reasons.includes(who)) entry.reasons.push(who);
    grouped.set(paragraph.id, entry);
  }
  return [...grouped.values()];
}

/**
 * How a proposal's scope reads to a reporter, which is the difference they must understand.
 *
 * A whole-cluster suggestion asks them to believe something about speech they have not read; a range
 * asks them to believe something about words on the screen. The words below say which, without
 * making anybody learn what a diarization cluster is.
 */
export function proposalScopeDescription(/** @type {Proposal} */ proposal, /** @type {{labels?:Record<string,string>}} */ { labels = {} } = {}) {
  const who = proposal?.speakerIdentity ? (labels[proposal.speakerIdentity] ?? proposal.speakerIdentity) : "an unidentified person";
  if (proposal?.proposalLevel === "RANGE" || proposal?.correctionType === "speaker_assignment") {
    return { scope: "range", headline: `This short portion appears to be ${who}`, detail: "even though the recording grouped it with another speaker. Accepting changes only these words." };
  }
  return { scope: "global", headline: `Everything the recording grouped as speaker ${proposal?.deepgramSpeaker} appears to be ${who}`, detail: "Accepting changes every paragraph from that speaker." };
}
