// Applying a conservative AI correction pass to the working transcript, when the reporter asks.
//
// WHY THIS APPLIES RATHER THAN PROPOSES. The subsystem was built as a suggestion queue: AI
// proposes, the reporter accepts each one. That is the right shape when the reporter would not
// otherwise read the transcript. Here they will -- the scopist and the court reporter review the
// whole record against the audio afterwards regardless -- so approving several hundred suggestions
// first is the same reading done twice. The queue was costing the work it was meant to save.
//
// WHAT REPLACES THE APPROVAL. Not trust: an audit trail. Every operation this applies is recorded
// with its pass id, correction type, anchors, before and after text, evidence basis and confidence,
// and the whole pass lands as ONE overlay transaction. So the reporter can see exactly what the AI
// changed, compare it against what Deepgram said, and undo the entire pass -- without approving it
// line by line first.
//
// WHY ONE TRANSACTION MATTERS. The overlay already groups operations into transactions and undo
// pops the last one. A pass applied as a single transaction is therefore undoable as a unit, and a
// human edit made afterwards is its own later transaction -- so undoing the AI pass cannot reach
// past a human correction and silently discard it. That property is inherited, not invented here.
//
// WHAT IT STILL WILL NOT DO. It applies only operations the existing validator already permits,
// against evidence the existing passes already require. It cannot change meaning, improve grammar,
// invent testimony or parentheticals, guess inaudible words, or manufacture oath, appearance or
// certification facts -- because it emits nothing of its own: it plans the operations the reporter's
// own acceptance path would have planned, and applies those.
import fs from "node:fs";
import path from "node:path";
import { depositionDirectory } from "./deposition-store.mjs";
import { runEntityPass } from "./entity-pass.mjs";
import { planRangeAcceptance } from "./range-acceptance-planner.mjs";
import { applyOverlay as applyOverlayToSegments, emptyOverlay as newOverlay } from "./reporter-overlay.mjs";
import { runSpeakerRangePass } from "./speaker-range-pass.mjs";
import { computeReviewStateHash as reviewStateHash, proposalWordIds } from "./review-state-hash.mjs";

export const AI_CORRECTION_STATUS = Object.freeze({
  APPLIED: "applied",
  NOTHING_TO_APPLY: "nothing-to-apply",
  ALREADY_CORRECTED: "already-corrected",
  NO_CREDENTIAL: "no-credential",
  TRANSCRIPT_MOVED: "transcript-moved",
  FAILED: "failed",
});

/**
 * Turns validated proposals into one batch of overlay operations.
 *
 * Conflicts are decided here rather than discovered during application. Two proposals whose word
 * ranges overlap cannot both be right about those words, and applying one then the other would let
 * the second silently overwrite the first. The earlier proposal wins and the later one is omitted
 * with a reason -- fail closed for that operation, not for the pass.
 *
 * Every operation is planned against ONE projection. Nothing is planned against the result of an
 * earlier operation in the same batch, so there is no intra-batch staleness to resolve: the whole
 * plan describes a single transition from the state that was analysed.
 */
export function planAiCorrectionBatch({ segments = [], names = [], ranges = [], speakerFor = () => null } = {}) {
  const claimed = new Map();   // wordId -> the proposal that already owns it
  const applied = [], omitted = [], operations = [];

  const claim = (proposal, wordIds, kind) => {
    const collision = wordIds.find(id => claimed.has(id));
    if (collision) {
      omitted.push({ kind, proposal, reason: "OVERLAPS_EARLIER_CORRECTION", conflictingWordId: collision });
      return false;
    }
    for (const id of wordIds) claimed.set(id, proposal);
    return true;
  };

  // Word corrections first: they are the narrowest claims, so letting them go first means a broad
  // speaker range cannot swallow the words a spelling correction needed.
  for (const proposal of names) {
    const wordId = proposal?.wordId;
    if (!wordId) { omitted.push({ kind: "name", proposal, reason: "NO_ANCHOR" }); continue; }
    if (!claim(proposal, [wordId], "name")) continue;
    operations.push({ op: "replace", wordId, text: proposal.proposedValue });
    applied.push({ kind: "name", wordId, before: proposal.originalValue ?? null, after: proposal.proposedValue,
      correctionType: proposal.correctionType ?? "text", confidence: proposal.confidenceScore ?? null,
      evidenceSource: proposal.evidenceSource ?? null });
  }

  for (const proposal of ranges) {
    const wordIds = proposalWordIds({ segments, proposal });
    if (!wordIds.length) { omitted.push({ kind: "speaker-range", proposal, reason: "ANCHOR_NOT_IN_TRANSCRIPT" }); continue; }
    const person = speakerFor(proposal.speakerIdentity);
    if (!person) { omitted.push({ kind: "speaker-range", proposal, reason: "IDENTITY_NOT_IN_ROSTER" }); continue; }
    if (!claim(proposal, wordIds, "speaker-range")) continue;

    // The planner reports refusal rather than throwing, and its reason is kept: an omitted
    // correction the reporter cannot account for is worse than one that never ran.
    const planned = planRangeAcceptance(segments, {
      startWordId: proposal.wordId,
      endWordId: proposal.endWordId ?? proposal.wordId,
      speakerIdentity: person.id,
      transcriptRole: person.defaultRole || null,
    });
    if (!planned?.ok) {
      omitted.push({ kind: "speaker-range", proposal, reason: planned?.reason ?? "NOT_PLANNABLE" });
      continue;
    }
    const planOperations = planned.operations ?? [];
    if (!planOperations.length) { omitted.push({ kind: "speaker-range", proposal, reason: "PLANNED_NOTHING" }); continue; }
    operations.push(...planOperations);
    applied.push({ kind: "speaker-range", wordId: proposal.wordId, endWordId: proposal.endWordId ?? proposal.wordId,
      wordCount: wordIds.length, before: proposal.currentSpeakerIdentity ?? null, after: person.id,
      correctionType: "speaker_assignment", confidence: proposal.confidenceScore ?? null,
      evidenceSource: proposal.evidenceSource ?? null, operations: planOperations.length });
  }

  return { operations, applied, omitted };
}

/** A record of exactly what one AI pass changed, sufficient to reconstruct before and after. */
export function correctionPassRecord({ passId, model, promptVersion, startedAt, reviewStateHash, applied, omitted, operations }) {
  return {
    schemaVersion: "1.0.0",
    recordType: "AI_CORRECTION_PASS",
    passId, model: model ?? null, promptVersion: promptVersion ?? null,
    appliedAt: new Date().toISOString(), startedAt: startedAt ?? null,
    // The state the operations were planned against. Anyone reconstructing this pass needs to know
    // which transcript it transformed, not merely that it happened.
    reviewStateHash: reviewStateHash ?? null,
    operationCount: operations.length,
    // The operations themselves, not merely how many. Undoing the pass as a unit requires proving
    // the overlay's last transaction IS this pass, and a count cannot prove that.
    operations,
    applied, omitted,
    appliedBy: "AI_CORRECTION_PASS",
  };
}

// The pass records live beside the proposal records but not among them: a proposal pass is a
// worklist (accepted/declined/failures) and an AI correction pass is a change to the transcript
// (applied/omitted/operations). Mixing them would make listCorrectionPasses read fields that are
// not there, and would blur the one distinction the audit trail exists to keep.
const AI_PASS_DIRECTORY = "ai-correction-passes";
const passDirectory = (root, { depositionId, storageRoot }) =>
  path.join(depositionDirectory(root, depositionId, { storageRoot }), "transcript", AI_PASS_DIRECTORY);

/** Every AI correction pass applied to this deposition, newest first. Reads only. */
export function listAiCorrectionPasses(root, { depositionId, storageRoot } = {}) {
  const directory = passDirectory(root, { depositionId, storageRoot });
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter(name => name.endsWith(".json"))
    .map(name => { try { return JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")); } catch { return null; } })
    .filter(Boolean)
    .sort((left, right) => String(right.appliedAt).localeCompare(String(left.appliedAt)));
}

/**
 * Whether the most recent AI pass can still be undone as a unit.
 *
 * Undo pops the LAST transaction, so "Undo AI Correction Pass" is honest only while the AI pass is
 * still the last transaction. Once the reporter has edited afterwards, their edit is what an undo
 * would reach -- so the control must stop offering itself rather than quietly removing their work.
 *
 * This compares the overlay's tail against the operations the pass recorded, which is stronger than
 * comparing counts: a later transaction of the same size would otherwise look like the pass.
 */
export function aiPassUndoState(root, { depositionId, storageRoot, listPasses = listAiCorrectionPasses, readOverlay } = {}) {
  let passes = [];
  try { passes = listPasses(root, { depositionId, storageRoot }) ?? []; } catch { passes = []; }
  const pass = passes[0] ?? null;
  if (!pass) return { pass: null, undoable: false, reason: "NO_AI_PASS" };

  let overlay = null;
  try { overlay = readOverlay?.(root, { depositionId, storageRoot }) ?? null; } catch { overlay = null; }
  const sizes = overlay?.transactionSizes ?? [];
  const operations = overlay?.operations ?? [];
  const lastSize = sizes.length ? sizes[sizes.length - 1] : 0;
  if (!lastSize || lastSize !== (pass.operations?.length ?? -1)) {
    return { pass, undoable: false, reason: "EDITED_SINCE" };
  }
  const tail = operations.slice(operations.length - lastSize);
  const same = JSON.stringify(tail) === JSON.stringify(pass.operations);
  return { pass, undoable: same, reason: same ? null : "EDITED_SINCE" };
}

/** Persists the record of one applied pass. Written after the operations land, never before. */
export function writeAiCorrectionPass(root, { depositionId, storageRoot, record } = {}) {
  const directory = passDirectory(root, { depositionId, storageRoot });
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${String(record.passId).replace(/[^A-Za-z0-9._-]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2));
  return record;
}

/**
 * Runs the AI passes and applies their validated corrections as ONE attributable batch.
 *
 * This is the difference between a queue and a batch, and it is the whole conversion. The passes
 * analyse one committed transcript state; the plan is built against that same state; every
 * operation lands in a single transaction guarded by the hash of the state it was planned against.
 *
 * If the transcript moved between analysis and application the pass REFUSES. It never rebases,
 * because rebasing means applying corrections to text nobody analysed -- and the reporter would
 * have no way to tell which of the 184 changes were about the transcript they now have.
 *
 * Dependencies are injected the way acceptRangeProposal injects them, so the orchestration can be
 * exercised against a real overlay without a network or a Claude key.
 */
export async function applyAiCorrectionPass(root, {
  depositionId, storageRoot, apiKey, model, passStartedAt = new Date().toISOString(), force = false,
  entityPass = runEntityPass, speakerRangePass = runSpeakerRangePass,
  getWorkingTranscript, readReporterOverlay, getSpeakerCandidates, appendReporterOperations,
  applyOverlay = applyOverlayToSegments, emptyOverlay = newOverlay, computeReviewStateHash = reviewStateHash,
  listPasses = listAiCorrectionPasses, writePassRecord = writeAiCorrectionPass,
} = {}) {
  if (!apiKey) {
    return { status: AI_CORRECTION_STATUS.NO_CREDENTIAL, applied: [], omitted: [], operationCount: 0, retryable: true,
      message: "No Anthropic API key is configured. The transcript is unchanged; add a key in Administrator Settings and run the correction again." };
  }

  const store = { depositionId, storageRoot };
  const before = computeReviewStateHash({
    transcript: getWorkingTranscript(root, store),
    overlay: readReporterOverlay(root, store),
  });

  // Repeating the pass against a transcript nobody has changed would buy the same corrections twice
  // and append them a second time. `force` is the reporter deliberately asking again.
  if (!force && listPasses(root, store).some(pass => pass?.reviewStateHash === before)) {
    return { status: AI_CORRECTION_STATUS.ALREADY_CORRECTED, applied: [], omitted: [], operationCount: 0, retryable: false,
      message: "This transcript has already been corrected in its current state. Nothing was changed." };
  }

  const options = { depositionId, storageRoot, apiKey, model, passStartedAt, limitChunks: null, additionalInstructions: "" };
  const [names, ranges] = await Promise.allSettled([entityPass(root, options), speakerRangePass(root, options)]);
  const failures = [];
  for (const [label, outcome] of [["names", names], ["speaker-ranges", ranges]]) {
    if (outcome.status === "rejected") failures.push(`${label}: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`);
  }
  if (names.status === "rejected" && ranges.status === "rejected") {
    return { status: AI_CORRECTION_STATUS.FAILED, applied: [], omitted: [], operationCount: 0, failures, retryable: true,
      message: "The AI correction pass could not run. The transcript is unchanged and nothing was applied; you can run it again." };
  }

  // Re-read AFTER analysis. The passes take time, and a transcript that moved while they ran is a
  // transcript the plan no longer describes.
  const transcript = getWorkingTranscript(root, store);
  const overlay = readReporterOverlay(root, store);
  const after = computeReviewStateHash({ transcript, overlay });
  if (after !== before) {
    return { status: AI_CORRECTION_STATUS.TRANSCRIPT_MOVED, applied: [], omitted: [], operationCount: 0, retryable: true,
      expected: before, actual: after,
      message: "The transcript changed while the AI was analysing it, so nothing was applied. Run the correction again against the current transcript." };
  }

  const projection = applyOverlay(transcript?.segments ?? [], overlay ?? emptyOverlay(depositionId));
  const candidates = getSpeakerCandidates(root, store)?.candidates ?? [];
  const batch = planAiCorrectionBatch({
    segments: projection.segments,
    names: names.status === "fulfilled" ? (names.value?.accepted ?? []) : [],
    ranges: ranges.status === "fulfilled" ? (ranges.value?.accepted ?? []) : [],
    speakerFor: id => candidates.find(person => person.id === id) ?? null,
  });

  if (!batch.operations.length) {
    return { status: AI_CORRECTION_STATUS.NOTHING_TO_APPLY, applied: [], omitted: batch.omitted, operationCount: 0, failures, retryable: false,
      message: "The AI found nothing it could correct with sufficient evidence. The transcript is unchanged." };
  }

  // ONE transaction, guarded by the state it was planned against. Undo pops a whole transaction, so
  // this is what makes the pass reversible as a unit; the guard is what makes it refuse rather than
  // rebase if the reporter edited something while it was thinking.
  appendReporterOperations(root, { ...store, operations: batch.operations, expectedReviewStateHash: before });

  const record = correctionPassRecord({
    passId: `ai-correction-${passStartedAt}`, model, promptVersion: null, startedAt: passStartedAt,
    reviewStateHash: before, applied: batch.applied, omitted: batch.omitted, operations: batch.operations,
  });
  writePassRecord(root, { ...store, record });

  return { status: AI_CORRECTION_STATUS.APPLIED, applied: batch.applied, omitted: batch.omitted,
    operationCount: batch.operations.length, passId: record.passId, failures, retryable: false,
    message: `AI correction complete — ${batch.applied.length} correction${batch.applied.length === 1 ? "" : "s"} applied in one pass. Review the corrected transcript.` };
}
