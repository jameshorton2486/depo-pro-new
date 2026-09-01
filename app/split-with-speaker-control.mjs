// What the Workspace offers when the reporter says a new speaker begins here.
//
// Deepgram ran two turns together across most of the Etminan deposition -- 306 paragraphs where the
// certified transcript has 530 turns. Repairing one boundary took a split and then a label; the
// overlay now takes both in one operation, and this is the control that produces it.
//
// The reporter states two things and only two: WHERE the next turn begins, by selecting the word it
// begins at, and WHO speaks it. Nothing here reads the text. Whether the new paragraph prints Q. or
// A. is derived downstream from the speaker and the examination structure, exactly as it is for a
// paragraph the reporter never touched.
//
// Kept out of the component because the Workspace has no test harness in this repository, so logic
// left inside it is logic nothing checks.

/**
 * @typedef {{ id:string, elementType?:string, words?:{ id:string, authored?:boolean }[] }} Paragraph
 * @typedef {{ id:string, label:string, defaultRole?:string|null }} Candidate
 */

/** The first word the microphone produced. Splitting before it would produce an empty head. */
const firstRecordedWordId = paragraph => paragraph?.words?.find(word => !word.authored)?.id ?? null;

/**
 * The speakers the reporter can hand the new paragraph to.
 *
 * Q. and A. come first because they are the two that repair a merged question and answer, which is
 * what almost every missed boundary in a real deposition turns out to be. The rest of the room
 * follows, so a boundary into an objection or onto the record is one click as well.
 *
 * A choice with no candidate behind it is not offered. Q. falls back to the examining attorney the
 * assembly recorded, because that is who the transcript already believes is asking.
 *
 * @param {{ candidates?:Candidate[], examinerIdentity?:string|null, labels?:Record<string,string> }} [input]
 */
export function splitSpeakerChoices({ candidates = [], examinerIdentity = null, labels = {} } = {}) {
  const named = id => String(labels[id] ?? candidates.find(item => item.id === id)?.label ?? "").replace(/:$/, "").trim();
  const examiner = candidates.find(item => item.defaultRole === "QUESTIONING_ATTORNEY")?.id ?? examinerIdentity ?? null;
  const witness = candidates.find(item => item.defaultRole === "WITNESS")?.id ?? null;
  const choices = [];
  if (examiner) choices.push({ key:"question", label:"Q.", title:named(examiner) ? `The examiner speaking — ${named(examiner)}` : "The examiner speaking", speakerIdentity:examiner, transcriptRole:"QUESTIONING_ATTORNEY" });
  if (witness) choices.push({ key:"answer", label:"A.", title:named(witness) ? `The witness speaking — ${named(witness)}` : "The witness speaking", speakerIdentity:witness, transcriptRole:"WITNESS" });
  for (const candidate of candidates) {
    if (candidate.id === examiner || candidate.id === witness) continue;
    choices.push({ key:candidate.id, label:named(candidate.id) || candidate.label, title:named(candidate.id) || candidate.label, speakerIdentity:candidate.id, transcriptRole:candidate.defaultRole ?? null });
  }
  return choices;
}

/**
 * Whether a split can be made where the reporter has selected, and why not when it cannot.
 *
 * Returns `{ beforeWordId, disabledReason }`.
 *
 * @param {{ paragraph?:Paragraph|null, selectedWordId?:string|null }} [input]
 */
export function splitWithSpeakerControl({ paragraph = null, selectedWordId = null } = {}) {
  if (!paragraph) return { beforeWordId:null, disabledReason:"Select the word the next speaker begins at." };
  if (!selectedWordId) return { beforeWordId:null, disabledReason:"Select the word the next speaker begins at." };
  const word = (paragraph.words ?? []).find(item => item.id === selectedWordId);
  if (!word) return { beforeWordId:null, disabledReason:"That word is not in this paragraph." };
  // Authored text carries no evidence anchor, so the overlay has nothing to split before.
  if (word.authored) return { beforeWordId:null, disabledReason:"Select a recorded word; text typed by the reporter cannot anchor a split." };
  // The first word would leave an empty head. applyOverlay refuses it as SPLIT_AT_SEGMENT_START, and
  // saying so here means the reporter finds out before the save rather than after it.
  if (selectedWordId === firstRecordedWordId(paragraph)) {
    return { beforeWordId:null, disabledReason:"This word already begins the paragraph. Select the word the NEXT speaker begins at." };
  }
  return { beforeWordId:selectedWordId, disabledReason:null };
}

/**
 * The single operation the action writes. One reporter determination, one operation, one undo.
 *
 * @param {{ paragraph?:Paragraph|null, selectedWordId?:string|null, speakerIdentity?:string|null, transcriptRole?:string|null }} [input]
 */
export function splitWithSpeakerOperation({ paragraph = null, selectedWordId = null, speakerIdentity = null, transcriptRole = null } = {}) {
  const { beforeWordId } = splitWithSpeakerControl({ paragraph, selectedWordId });
  if (!beforeWordId || !speakerIdentity) return null;
  return { op:"split", beforeWordId, speakerIdentity, transcriptRole:transcriptRole ?? null };
}
