// What an examination-boundary proposal must prove before it can move a single Q.
//
// WHY THIS IS ITS OWN FACT. Q./A. classification requires an established examination. Examiner
// identity is not one: it says who conducts the examination, never when one begins, and reading
// both off the same field made counsel's appearance a question to an unsworn witness.
//
// WHY NOT THE OATH. Whether the witness was sworn and where examination begins are related and
// distinct facts. A deposition transcribed from an existing recording was sworn inside that
// recording, years before the current reporter opened the file -- there is no attestation for this
// reporter to make, and gating testimony on one would refuse to transcribe the records this
// application exists for. What the transcript does contain is the transition itself: the reporter
// finishing the opening procedure and handing the proceeding to counsel.
//
// WHAT THE MODEL IS FOR, AND WHAT IT IS NOT. The transition is linguistic, so a model can recognise
// it where a deterministic rule cannot. That is the whole of its job. It proposes an anchor and an
// examiner; everything below decides whether the proposal may become a structural fact, and the
// deterministic labeller then reads only the resulting boundary. The model never labels a
// paragraph, never writes a heading, and never puts a word on the page.
//
// AUTHORITY. A reporter's boundary outranks a proposal absolutely -- not as a tie-break but as a
// refusal: where the reporter has spoken there is no question left for a model to answer.

export const BOUNDARY_REFUSALS = Object.freeze({
  NO_ANCHOR: "NO_ANCHOR",
  ANCHOR_NOT_IN_TRANSCRIPT: "ANCHOR_NOT_IN_TRANSCRIPT",
  ANCHOR_NOT_PRINTED: "ANCHOR_NOT_PRINTED",
  NO_EXAMINER: "NO_EXAMINER",
  EXAMINER_NOT_A_PARTICIPANT: "EXAMINER_NOT_A_PARTICIPANT",
  EXAMINER_NOT_COUNSEL: "EXAMINER_NOT_COUNSEL",
  UNKNOWN_TYPE: "UNKNOWN_TYPE",
  REPORTER_BOUNDARY_EXISTS: "REPORTER_BOUNDARY_EXISTS",
  DUPLICATE_BOUNDARY: "DUPLICATE_BOUNDARY",
  STALE_ANALYSIS: "STALE_ANALYSIS",
});

/** The examinations a deposition can contain. Closed, and the same list the overlay operation uses. */
export const BOUNDARY_TYPES = Object.freeze(["DIRECT", "CROSS", "REDIRECT", "RECROSS"]);

/** Only counsel examine. A videographer, an interpreter or the witness cannot open an examination. */
const COUNSEL_ROLES = new Set(["QUESTIONING_ATTORNEY", "DEFENDING_ATTORNEY"]);

/**
 * Whether one proposed examination boundary may be recorded, and why not when it may not.
 *
 * Every argument is read from the deposition's own state by the caller. Nothing here is taken from
 * the model except `proposal` itself, so a proposal cannot describe a transcript that is not there,
 * name a person who does not exist, or claim a state it never analysed.
 *
 * @param {object}   proposal              `{ atWordId, examinerPersonId, type, reviewStateHash }`
 * @param {Set|Array} printedWordIds       word ids the transcript currently prints
 * @param {Set|Array} knownWordIds         every word id the transcript holds, struck or not
 * @param {Array}    participants          canonical candidates: `{ id, defaultRole }`
 * @param {Array}    existingBoundaries    boundaries already on the overlay
 * @param {string}   reviewStateHash       the transcript state as it is NOW
 * @returns {{ ok:true, boundary:object } | { ok:false, reason:string }}
 */
export function validateExaminationBoundary({
  proposal, printedWordIds = [], knownWordIds = null, participants = [], existingBoundaries = [], reviewStateHash = null,
} = {}) {
  const atWordId = String(proposal?.atWordId ?? "").trim();
  const examinerPersonId = String(proposal?.examinerPersonId ?? "").trim();
  const type = String(proposal?.type ?? "DIRECT").trim().toUpperCase();

  if (!atWordId) return refuse(BOUNDARY_REFUSALS.NO_ANCHOR);
  if (!examinerPersonId) return refuse(BOUNDARY_REFUSALS.NO_EXAMINER);
  if (!BOUNDARY_TYPES.includes(type)) return refuse(BOUNDARY_REFUSALS.UNKNOWN_TYPE);

  // STALENESS FIRST, before anything is compared against current state. A proposal describes the
  // transcript it analysed; if that transcript has moved, every check below is being run against
  // different words than the model read, and passing them would prove nothing about the proposal.
  const analysed = String(proposal?.reviewStateHash ?? "").trim();
  if (!analysed || (reviewStateHash && analysed !== String(reviewStateHash))) return refuse(BOUNDARY_REFUSALS.STALE_ANALYSIS);

  // The anchor has to be a word the reader can see, and the two ways it can fail are different
  // problems with different remedies: a word the model invented is a bad proposal, a word the
  // reporter struck is a proposal overtaken by an edit. Both are derived from the deposition's own
  // state -- `knownWordIds` is every word the transcript holds, `printedWordIds` those that survive
  // the overlay. Neither is taken from the proposal, which is the point.
  const printed = printedWordIds instanceof Set ? printedWordIds : new Set(printedWordIds ?? []);
  const known = knownWordIds instanceof Set ? knownWordIds : new Set(knownWordIds ?? printed);
  if (!known.has(atWordId)) return refuse(BOUNDARY_REFUSALS.ANCHOR_NOT_IN_TRANSCRIPT);
  if (!printed.has(atWordId)) return refuse(BOUNDARY_REFUSALS.ANCHOR_NOT_PRINTED);

  // The examiner must be somebody the deposition's own record already holds. This is what stops a
  // proposal introducing a person -- the canonical record is the authority on who was present, and
  // a structural fact naming somebody it does not list would be evidence of nothing.
  const participant = (participants ?? []).find(item => String(item?.id ?? "") === examinerPersonId);
  if (!participant) return refuse(BOUNDARY_REFUSALS.EXAMINER_NOT_A_PARTICIPANT);
  if (!COUNSEL_ROLES.has(String(participant.defaultRole ?? "").toUpperCase())) return refuse(BOUNDARY_REFUSALS.EXAMINER_NOT_COUNSEL);

  // THE REPORTER'S BOUNDARY IS NOT OUTVOTED, IT IS UNCHALLENGED. Any reporter boundary of this type
  // settles where this examination begins, wherever it is anchored. A proposal is not a competing
  // opinion to be reconciled -- it is an answer to a question that is no longer open.
  //
  // A boundary with no recorded provenance is treated AS the reporter's. The overlay stores an
  // examination operation without saying who made it, so absence of provenance is ambiguous -- and
  // the conservative reading of an ambiguous authority is the one that refuses. The consequence is
  // deliberate: a pass re-run over its own boundary refuses too, which is the idempotence the
  // one-click workflow needs.
  const sameType = (existingBoundaries ?? []).filter(item => String(item?.type ?? "DIRECT").toUpperCase() === type);
  if (sameType.some(item => item?.source !== "AI")) return refuse(BOUNDARY_REFUSALS.REPORTER_BOUNDARY_EXISTS);
  // An equivalent boundary already stands. Coalesced rather than refused as an error: re-running
  // the analysis over an unchanged transcript should be idempotent, not an accumulating pile of
  // headings for one examination.
  if (sameType.some(item => String(item?.atWordId ?? "") === atWordId)) return refuse(BOUNDARY_REFUSALS.DUPLICATE_BOUNDARY);
  // A second boundary of the same type somewhere else is still one examination of that type. The
  // model does not get to move a boundary that already exists; the reporter does.
  if (sameType.length) return refuse(BOUNDARY_REFUSALS.DUPLICATE_BOUNDARY);

  return { ok: true, boundary: { atWordId, examinerPersonId, type } };
}

function refuse(reason) { return { ok: false, reason }; }

/**
 * The overlay operations for the boundaries a pass established, and the record of what it refused.
 *
 * Boundaries are validated one at a time against a list that grows as each is accepted, so two
 * proposals in one response cannot both claim the same examination.
 */
export function planExaminationBoundaries({ proposals = [], printedWordIds = [], knownWordIds = null, participants = [], existingBoundaries = [], reviewStateHash = null } = {}) {
  const operations = [], applied = [], omitted = [];
  const boundaries = [...(existingBoundaries ?? [])];
  for (const proposal of proposals ?? []) {
    const verdict = validateExaminationBoundary({ proposal, printedWordIds, knownWordIds, participants, existingBoundaries: boundaries, reviewStateHash });
    if (!verdict.ok) { omitted.push({ proposal, reason: verdict.reason }); continue; }
    operations.push({ op: "examination", ...verdict.boundary });
    applied.push({ kind: "examination_boundary", ...verdict.boundary, evidenceSource: "AI_STRUCTURAL_ANALYSIS" });
    boundaries.push({ ...verdict.boundary, source: "AI" });
  }
  return { operations, applied, omitted };
}
