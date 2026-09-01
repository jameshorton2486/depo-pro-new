// What the Workspace offers when the reporter marks where an examination begins. Phase E of §246.
//
// Everything underneath this is built: the boundary is an overlay operation (B), it moves Q./A. as
// the transcript is walked (C), it announces itself with a heading and a BY-line and it places
// itself on the index (D). Until now the only thing that could create one was a test fixture.
//
// Pure, and separate from the screen, because this is the part with rules in it: which people can
// be named, what an anchor is, and when the action must not be offered at all. The Workspace has no
// test harness in this repository, so logic left inside the component is logic nothing checks.
//
// The reporter states both facts. An examination boundary names a person and a kind of examination,
// and neither is inferred here -- not from the speaker of the paragraph, not from how many
// examinations already exist. §247 is the standing reminder of what inference costs on a certified
// page: the application knows who is examining and does not thereby know what any utterance is.

/** The examinations a deposition can contain, in the order they occur, with reporter-facing names. */
export const EXAMINATION_TYPE_CHOICES = Object.freeze([
  Object.freeze({ value:"DIRECT", label:"Direct examination" }),
  Object.freeze({ value:"CROSS", label:"Cross-examination" }),
  Object.freeze({ value:"REDIRECT", label:"Redirect examination" }),
  Object.freeze({ value:"RECROSS", label:"Recross-examination" }),
]);

// Who cannot be conducting an examination.
//
// Stated as an exclusion, not as a required attorney role, because the role is often not set yet.
// getSpeakerCandidates derives `defaultRole` from the counsel record's appearanceRole, which the
// reporter fills in during Appearances -- measured against a live candidate list, all three
// attorneys came back with `defaultRole: ""`. Requiring QUESTIONING_ATTORNEY or DEFENDING_ATTORNEY
// offered nobody at all, and a control that names no examiner on an ordinary deposition is no
// control. Found by driving the running server, not by any test in this repository.
//
// The people who are not the witness, the reporter, the videographer or the interpreter are counsel,
// and the id is still canonical either way.
const NOT_EXAMINERS = new Set(["WITNESS", "COURT_REPORTER", "VIDEOGRAPHER", "INTERPRETER"]);

/**
 * @typedef {{ id:string, authored?:boolean }} Word
 * @typedef {{ id:string, words?:Word[] }} Paragraph
 * @typedef {{ id:string, label?:string, defaultRole?:string }} Candidate
 * @typedef {{ examinerPersonId:string, type:string, atWordId:string|null, implicit?:boolean }} Examination
 */

/**
 * The first word the microphone produced. Authored text carries no evidence anchor.
 * @param {Paragraph|null} [paragraph]
 * @returns {string|null}
 */
export function anchorWordId(paragraph) {
  return paragraph?.words?.find(word => !word.authored)?.id ?? null;
}

/**
 * What the control can offer for the paragraph the reporter has selected.
 *
 * Returns `{ anchorWordId, examiners, alreadyMarked, disabledReason }`. A reason is a sentence the
 * reporter can act on, never a disabled control with no explanation -- that is the shape the oath
 * attestation form had, where a button greyed out for one of two reasons and named neither.
 *
 * @param {{ paragraph?:Paragraph|null, candidates?:Candidate[], examinations?:Examination[], labels?:Record<string,string> }} [input]
 */
export function examinationControl({ paragraph = null, candidates = [], examinations = [], labels = {} } = {}) {
  const examiners = candidates
    .filter(candidate => candidate?.id && !NOT_EXAMINERS.has(String(candidate?.defaultRole ?? "").toUpperCase()))
    .map(candidate => ({ id:candidate.id, label:labels[candidate.id] ?? candidate.label ?? candidate.id }));

  const anchor = anchorWordId(paragraph);
  const existing = anchor ? examinations.find(item => item.atWordId === anchor) ?? null : null;

  let disabledReason = null;
  if (!paragraph) disabledReason = "Choose the paragraph where the new examination begins.";
  else if (!anchor) disabledReason = "This paragraph has no recorded word to anchor an examination to.";
  else if (existing) {
    // Refused here as well as in the overlay. applyOverlay orphans a second boundary on one word,
    // which is correct but only visible afterwards as a finding; the reporter should be told before
    // they act, and told what is already there.
    const name = labels[existing.examinerPersonId] ?? existing.examinerPersonId;
    const type = EXAMINATION_TYPE_CHOICES.find(choice => choice.value === existing.type)?.label ?? existing.type;
    disabledReason = `${type} by ${name} already begins here. Undo it before marking a different examination at this paragraph.`;
  } else if (!examiners.length) disabledReason = "No counsel is recorded on this deposition, so there is nobody to name as the examiner.";

  return { anchorWordId:anchor, examiners, alreadyMarked:Boolean(existing), disabledReason };
}

/**
 * The sentence the action commits to, in the reporter's words.
 *
 * The button says what it will record rather than what it is. A control that reads "Record" leaves
 * the reporter to remember which two dropdowns they set; one that reads "Cross-examination by
 * MS. WHITFIELD begins here" can be checked against the screen before it is pressed.
 *
 * @param {{ type?:string, examinerPersonId?:string, labels?:Record<string,string>, candidates?:Candidate[] }} [input]
 * @returns {string|null}
 */
export function examinationSummary({ type = "", examinerPersonId = "", labels = {}, candidates = [] } = {}) {
  const choice = EXAMINATION_TYPE_CHOICES.find(item => item.value === String(type).toUpperCase());
  const id = String(examinerPersonId ?? "").trim();
  if (!choice || !id) return null;
  const candidate = candidates.find(item => item.id === id);
  const name = labels[id] ?? candidate?.label ?? id;
  return `${choice.label} by ${name} begins here`;
}

/**
 * The operation the action writes. One operation, and the examiner is a canonical participant id.
 *
 * Returns null rather than a half-formed operation when either fact is missing, so a caller cannot
 * write a boundary naming nobody -- which the overlay refuses at validation, and which would name
 * an examiner the index could not print.
 *
 * @param {{ paragraph?:Paragraph|null, type?:string, examinerPersonId?:string }} [input]
 */
export function examinationOperation({ paragraph = null, type = "", examinerPersonId = "" } = {}) {
  const anchor = anchorWordId(paragraph);
  const resolvedType = EXAMINATION_TYPE_CHOICES.find(item => item.value === String(type).toUpperCase())?.value ?? null;
  const id = String(examinerPersonId ?? "").trim();
  if (!anchor || !resolvedType || !id) return null;
  return { op:"examination", atWordId:anchor, examinerPersonId:id, type:resolvedType };
}
