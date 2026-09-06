// Reconciling the transcript against a human-corrected transcript of the same deposition.
//
// WHY THIS EXISTS. A reporter who already holds a corrected transcript of this deposition can
// settle questions the machine cannot -- who was speaking. Applying that knowledge through the
// ordinary overlay works, but it lands as an unattributed transaction, and an unattributed
// transaction is read as the reporter's own keystroke. On Heath Thomas that would have recorded the
// reporter as personally attributing twenty-three passages they had never looked at.
//
// So this is not a new editing capability. It is the missing PROVENANCE for one that already
// exists: the same `label` operation, bound to the document that authorized it.
//
// WHAT THE RECORD BINDS. The deposition, the source document by name AND by SHA-256, the review
// state that was analysed, the state the pass produced, the exact operations that landed, and every
// item that was refused with its reason. A court asking why a speaker changed gets the document,
// its hash, and the passage that said so -- not "the reporter edited it".
//
// SPEAKER IDENTITY ONLY. The pass emits `label` operations and nothing else. It cannot change a
// word, a paragraph boundary, an examination boundary, Q./A. or any timestamp, because those
// operations are not in its vocabulary -- withheld capability, not withheld permission. That is the
// same discipline the entity pass uses to stay inside spelling.
//
// AND IT DOES NOT READ THE DOCUMENT. Alignment to the corrected transcript happens outside, and
// what arrives here is a list of resolved reconciliations each carrying the designation the human
// transcript actually printed. This module decides whether each may be recorded, against the
// deposition's own state. Nothing here parses a .docx, and nothing here infers a speaker.
import { listAiCorrectionPasses, writeAiCorrectionPass } from "./ai-correction.mjs";
import { applyOverlay as applyOverlayToSegments, emptyOverlay as newOverlay } from "./reporter-overlay.mjs";
import { computeReviewStateHash as reviewStateHash } from "./review-state-hash.mjs";

export const RECONCILIATION_STATUS = Object.freeze({
  APPLIED: "applied",
  NOTHING_TO_APPLY: "nothing-to-apply",
  ALREADY_RECONCILED: "already-reconciled",
  NO_SOURCE: "no-source",
  TRANSCRIPT_MOVED: "transcript-moved",
  FAILED: "failed",
});

export const RECONCILIATION_REFUSALS = Object.freeze({
  NO_ANCHOR: "NO_ANCHOR",
  ANCHOR_NOT_IN_TRANSCRIPT: "ANCHOR_NOT_IN_TRANSCRIPT",
  NO_SOURCE_DESIGNATION: "NO_SOURCE_DESIGNATION",
  SPEAKER_NOT_A_PARTICIPANT: "SPEAKER_NOT_A_PARTICIPANT",
  SPEAKER_HAS_NO_ROLE: "SPEAKER_HAS_NO_ROLE",
  ALREADY_THAT_SPEAKER: "ALREADY_THAT_SPEAKER",
});

const RECORD_TYPE = "HUMAN_TRANSCRIPT_RECONCILIATION_PASS";
const isReconciliationPass = record => String(record?.recordType ?? "") === RECORD_TYPE;

/** A source is a named document and its hash. Absent either, there is nothing to attribute to. */
export function validateSource(source) {
  const name = String(source?.name ?? "").trim();
  const sha256 = String(source?.sha256 ?? "").trim().toLowerCase();
  if (!name || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  return { name, sha256 };
}

/**
 * The `label` operations a set of reconciliations justifies, and the record of what was refused.
 *
 * `transcriptRole` is DERIVED from the participant the deposition's own record holds, never taken
 * from the caller. A reconciliation says who spoke; what role that person holds is a fact the
 * canonical record already answers, and accepting it here would let a caller pair a name with a
 * role the record does not give them.
 */
export function planReconciliation({ segments = [], participants = [], reconciliations = [] } = {}) {
  const operations = [], applied = [], omitted = [];
  const byId = new Map(segments.map(segment => [segment.id, segment]));

  for (const item of reconciliations ?? []) {
    const segmentId = String(item?.segmentId ?? "").trim();
    const speakerIdentity = String(item?.speakerIdentity ?? "").trim();
    const designation = String(item?.sourceDesignation ?? "").trim();
    const refuse = reason => omitted.push({ reconciliation: item, reason });

    if (!segmentId) { refuse(RECONCILIATION_REFUSALS.NO_ANCHOR); continue; }
    const segment = byId.get(segmentId);
    if (!segment) { refuse(RECONCILIATION_REFUSALS.ANCHOR_NOT_IN_TRANSCRIPT); continue; }
    // The passage the human transcript printed. Without it the operation carries no evidence of its
    // own, and the pass record would attribute a change to a document that never mentioned it.
    if (!designation) { refuse(RECONCILIATION_REFUSALS.NO_SOURCE_DESIGNATION); continue; }
    if (!speakerIdentity) { refuse(RECONCILIATION_REFUSALS.SPEAKER_NOT_A_PARTICIPANT); continue; }
    const participant = (participants ?? []).find(person => String(person?.id ?? "") === speakerIdentity);
    if (!participant) { refuse(RECONCILIATION_REFUSALS.SPEAKER_NOT_A_PARTICIPANT); continue; }
    const transcriptRole = String(participant.defaultRole ?? "").trim();
    if (!transcriptRole) { refuse(RECONCILIATION_REFUSALS.SPEAKER_HAS_NO_ROLE); continue; }
    // Re-running over a transcript already reconciled must add nothing rather than append the same
    // determination again.
    if (segment.speakerIdentity === speakerIdentity && segment.transcriptRole === transcriptRole) {
      refuse(RECONCILIATION_REFUSALS.ALREADY_THAT_SPEAKER); continue;
    }

    operations.push({ op: "label", segmentId, speakerIdentity, transcriptRole });
    applied.push({ kind: "speaker-reconciliation", segmentId,
      before: segment.speakerIdentity ?? null, after: speakerIdentity, transcriptRole,
      sourceDesignation: designation, evidenceSource: "HUMAN_CORRECTED_TRANSCRIPT" });
  }
  return { operations, applied, omitted };
}

/** What one reconciliation pass changed, and the document that authorized every part of it. */
export function reconciliationPassRecord({ passId, startedAt, source, reviewStateHash: analysed, resultingReviewStateHash, applied, omitted, operations }) {
  return {
    schemaVersion: "1.0.0",
    recordType: RECORD_TYPE,
    passId,
    // No model, because none was consulted. The authority is the document below.
    model: null,
    source,
    appliedAt: new Date().toISOString(), startedAt: startedAt ?? null,
    reviewStateHash: analysed ?? null,
    resultingReviewStateHash: resultingReviewStateHash ?? null,
    operationCount: operations.length,
    operations,
    applied, omitted,
    appliedBy: RECORD_TYPE,
  };
}

/**
 * Applies one reconciliation as a single attributable transaction.
 *
 * Fails closed, and refuses without a source: a pass that cannot name the document it came from is
 * precisely the unattributed transaction this exists to prevent.
 */
export async function applyReconciliationPass(root, {
  depositionId, storageRoot, source, reconciliations = [], passStartedAt = new Date().toISOString(), force = false,
  getWorkingTranscript, readReporterOverlay, getSpeakerCandidates, appendReporterOperations,
  applyOverlay = applyOverlayToSegments, emptyOverlay = newOverlay, computeReviewStateHash = reviewStateHash,
  listPasses = listAiCorrectionPasses, writePassRecord = writeAiCorrectionPass,
} = {}) {
  const store = { depositionId, storageRoot };
  const document = validateSource(source);
  if (!document) {
    return { status: RECONCILIATION_STATUS.NO_SOURCE, applied: [], omitted: [], operationCount: 0,
      message: "A reconciliation must name its human-corrected source document and that document's SHA-256. Nothing was changed." };
  }

  try {
    const transcript = getWorkingTranscript(root, store);
    const overlay = readReporterOverlay(root, store);
    const before = computeReviewStateHash({ transcript, overlay });

    if (!force && listPasses(root, store).filter(isReconciliationPass).some(pass =>
      pass?.reviewStateHash === before || pass?.resultingReviewStateHash === before)) {
      return { status: RECONCILIATION_STATUS.ALREADY_RECONCILED, applied: [], omitted: [], operationCount: 0, reviewStateHash: before,
        message: "This transcript has already been reconciled in its current state. Nothing was changed." };
    }

    const projection = applyOverlay(transcript?.segments ?? [], overlay ?? emptyOverlay(depositionId));
    const participants = getSpeakerCandidates(root, store)?.candidates ?? [];
    const plan = planReconciliation({ segments: projection.segments ?? [], participants, reconciliations });
    if (!plan.operations.length) {
      return { status: RECONCILIATION_STATUS.NOTHING_TO_APPLY, applied: [], omitted: plan.omitted, operationCount: 0, reviewStateHash: before,
        message: "Nothing in this reconciliation could be applied to the transcript as it currently stands." };
    }

    // ONE transaction, guarded by the state the plan was built against. The guard is what makes a
    // transcript that moved during the audit refuse rather than rebase onto passages nobody aligned.
    const written = appendReporterOperations(root, { ...store, operations: plan.operations, expectedReviewStateHash: before });
    // What LANDED. The overlay normalises operations on the way in, and a record of the plan would
    // not match the overlay's tail -- which is how any undo control proves a pass is still undoable.
    const sizes = written?.transactionSizes ?? [];
    const size = sizes.length ? sizes[sizes.length - 1] : 0;
    const stored = written?.operations ?? [];
    const landed = size ? stored.slice(stored.length - size) : plan.operations;

    const record = reconciliationPassRecord({
      passId: `reconciliation-${passStartedAt}`, startedAt: passStartedAt, source: document,
      reviewStateHash: before,
      resultingReviewStateHash: computeReviewStateHash({
        transcript: getWorkingTranscript(root, store), overlay: readReporterOverlay(root, store),
      }),
      applied: plan.applied, omitted: plan.omitted, operations: landed,
    });
    writePassRecord(root, { ...store, record });

    return { status: RECONCILIATION_STATUS.APPLIED, applied: plan.applied, omitted: plan.omitted,
      operationCount: landed.length, passId: record.passId, reviewStateHash: before,
      message: `${plan.applied.length} speaker attribution${plan.applied.length === 1 ? "" : "s"} reconciled against ${document.name}.` };
  } catch (error) {
    // FAIL CLOSED. The only write before the record is one guarded append; a throw before it means
    // nothing landed, and a throw after it means no record was written -- which reads as a pass that
    // did not happen, while the operations remain visible and reversible in the overlay.
    return { status: RECONCILIATION_STATUS.FAILED, applied: [], omitted: [], operationCount: 0,
      message: error instanceof Error ? error.message : String(error) };
  }
}
