// One button, two authorities, and a record that never confuses them.
//
// The reporter presses Correct Transcript once. Behind it two layers run in order:
//
//   1. DETERMINISTIC_FORMAT_PASS   corrections the deposition's own data proves. No model is
//                                  consulted and no Anthropic call is made.
//   2. AI_CORRECTION_PASS          names and speaker structure, where judgement is required.
//
// WHY DETERMINISTIC FIRST. Three reasons, and the third is the one that decided it.
//
// It cannot fail for a reason the AI layer causes -- no key, no network, no model. Running it first
// means the corrections the application can prove for itself land whatever happens afterwards.
//
// The AI layer then reads a cleaner transcript. An entity proposal is validated against the words
// as they currently read, and "U.S.A." is a better thing to reason about than "U. S. A.".
//
// And it leaves the AI transaction last, which is what the existing "Undo AI Correction Pass"
// control requires to offer itself honestly -- it proves the pass is still undoable by comparing
// the overlay's tail against the operations the pass recorded. Reversing the order would have
// silently disabled that control on every run.
//
// TWO TRANSACTIONS, NOT ONE. Each layer appends its own transaction and writes its own record. That
// is what lets an AI failure leave a successful deterministic pass standing: they are separate acts
// with separate authorities, and one button initiating both does not make them one correction.
// The audit history keeps saying which was which -- immutable ASR, deterministic correction, AI
// correction, and the reporter's own -- and a court asking who changed a word gets an answer.
//
// NEITHER LAYER AUTHORIZES THE OTHER. The deterministic pass may make only the format corrections
// its validator admits; the AI passes may make only the corrections theirs admit. Running under one
// button does not widen either vocabulary, and there is no path here that lets a proposal refused
// by one validator be applied by the other.
import fs from "node:fs";
import path from "node:path";
import { AI_CORRECTION_STATUS, applyAiCorrectionPass, listAiCorrectionPasses, writeAiCorrectionPass } from "./ai-correction.mjs";
import { depositionDirectory } from "./deposition-store.mjs";
import { formatPassRecord, planFormatCorrections } from "./format-pass.mjs";
import { applyOverlay as applyOverlayToSegments, emptyOverlay as newOverlay } from "./reporter-overlay.mjs";
import { computeReviewStateHash as reviewStateHash } from "./review-state-hash.mjs";

export const FORMAT_PASS_STATUS = Object.freeze({
  APPLIED: "applied",
  NOTHING_TO_APPLY: "nothing-to-apply",
  ALREADY_CORRECTED: "already-corrected",
  FAILED: "failed",
});

const isFormatPass = record => String(record?.recordType ?? "") === "DETERMINISTIC_FORMAT_PASS";

/**
 * The canonical identifiers this deposition's own record establishes.
 *
 * Only values the record actually holds. A missing cause number yields no canonical value, which
 * makes the identifier generator decline rather than invent one -- the deposition that has no
 * number on file is exactly the one where a guessed number would be worst.
 */
export function canonicalIdentifiers(canonical) {
  const raw = field => (field && typeof field === "object" && "value" in field ? field.value : field);
  const value = field => String(raw(field) ?? "").trim();
  return [value(canonical?.case?.causeNumber), value(canonical?.deposition?.causeNumber)]
    .filter(Boolean).filter((item, index, all) => all.indexOf(item) === index);
}

/** The deposition's own canonical record, or null. A record that cannot be read is not a record. */
export function readCanonicalRecord(root, { depositionId, storageRoot } = {}) {
  try {
    const file = path.join(depositionDirectory(root, depositionId, { storageRoot }), "intake", "canonical-deposition-record.json");
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch { return null; }
}

/**
 * The deterministic layer, applied as its own transaction with its own record.
 *
 * Fails closed: anything unexpected returns FAILED with nothing applied, because a format pass that
 * half-ran would leave the transcript in a state no record describes.
 */
export async function applyFormatPass(root, {
  depositionId, storageRoot, passStartedAt = new Date().toISOString(), force = false, canonicalValues = null,
  getWorkingTranscript, readReporterOverlay, readAsrEvidence = () => [], appendReporterOperations,
  readCanonical = readCanonicalRecord,
  applyOverlay = applyOverlayToSegments, emptyOverlay = newOverlay, computeReviewStateHash = reviewStateHash,
  listPasses = listAiCorrectionPasses, writePassRecord = writeAiCorrectionPass,
} = {}) {
  const store = { depositionId, storageRoot };
  try {
    const transcript = getWorkingTranscript(root, store);
    const overlay = readReporterOverlay(root, store);
    const before = computeReviewStateHash({ transcript, overlay });

    // Idempotence. Pressing the button again over an unchanged transcript must not append the same
    // corrections a second time. Checked against this pass's own records only -- an AI pass having
    // touched this state says nothing about whether the format pass has.
    if (!force && listPasses(root, store).filter(isFormatPass).some(pass =>
      pass?.reviewStateHash === before || pass?.resultingReviewStateHash === before)) {
      return { status: FORMAT_PASS_STATUS.ALREADY_CORRECTED, applied: [], omitted: [], operationCount: 0, reviewStateHash: before };
    }

    // The words as they currently read, in transcript order. Read from the projection, never from
    // stored text: a correction must be derived from what the transcript says now.
    const projection = applyOverlay(transcript?.segments ?? [], overlay ?? emptyOverlay(depositionId));
    const evidence = readAsrEvidence(root, store) ?? [];
    const byId = new Map();
    for (const document of evidence) for (const word of document?.words ?? []) byId.set(word.id, word);
    const words = [];
    for (const segment of projection.segments ?? []) {
      for (const id of segment.asrWordIds ?? []) {
        if (projection.deleted.has(id)) continue;
        const text = projection.replaced.get(id) ?? byId.get(id)?.punctuatedWord ?? byId.get(id)?.word ?? "";
        if (text) words.push({ id, text });
      }
    }

    // Derived from the deposition's own record unless the caller supplied them. A deposition with
    // no cause number on file yields no canonical value, and the identifier generator then declines
    // rather than reaching for something that looks like one.
    const identifiers = canonicalValues ?? canonicalIdentifiers(readCanonical(root, store));
    const plan = planFormatCorrections({ words, canonicalValues: identifiers });
    if (!plan.operations.length) {
      return { status: FORMAT_PASS_STATUS.NOTHING_TO_APPLY, applied: [], omitted: plan.omitted, operationCount: 0, reviewStateHash: before };
    }

    const written = appendReporterOperations(root, { ...store, operations: plan.operations, expectedReviewStateHash: before });
    // What LANDED, not what was planned. The overlay normalises operations on the way in, and a
    // record of the plan would not match the overlay's tail -- which is how an undo control decides
    // whether it may still offer itself.
    const sizes = written?.transactionSizes ?? [];
    const size = sizes.length ? sizes[sizes.length - 1] : 0;
    const stored = written?.operations ?? [];
    const landed = size ? stored.slice(stored.length - size) : plan.operations;

    const record = formatPassRecord({
      passId: `format-pass-${passStartedAt}`, startedAt: passStartedAt, reviewStateHash: before,
      resultingReviewStateHash: computeReviewStateHash({
        transcript: getWorkingTranscript(root, store), overlay: readReporterOverlay(root, store),
      }),
      applied: plan.applied, omitted: plan.omitted, operations: landed,
    });
    writePassRecord(root, { ...store, record });
    return { status: FORMAT_PASS_STATUS.APPLIED, applied: plan.applied, omitted: plan.omitted,
      operationCount: landed.length, passId: record.passId, reviewStateHash: before };
  } catch (error) {
    // FAIL CLOSED. Nothing was applied that this does not know about: the only write above is a
    // single guarded append, and a throw before it means no operation landed. A throw after it
    // means the record was not written, which the reporter sees as a pass that did not happen --
    // and the transcript still carries the corrections, visible and attributable in the overlay.
    return { status: FORMAT_PASS_STATUS.FAILED, applied: [], omitted: [], operationCount: 0,
      message: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Correct Transcript: the deterministic layer, then the AI layer, reported as one action.
 *
 * The reporter is told what each layer did, because "12 corrections" that mixes a proven
 * abbreviation with a model's judgement about a name is not something they can review. The two
 * counts stay separate all the way to the screen.
 */
export async function correctTranscript(root, options = {}) {
  const format = await applyFormatPass(root, options);

  // A deterministic failure fails the action closed. The AI layer is not run over a transcript
  // whose deterministic state is unknown -- that would be the second layer silently proceeding on
  // an assumption the first one just refused to make.
  if (format.status === FORMAT_PASS_STATUS.FAILED) {
    return { status: AI_CORRECTION_STATUS.FAILED, format, ai: null, applied: [], omitted: [], operationCount: 0, retryable: true,
      message: `The formatting pass could not run, so no corrections were applied: ${format.message}` };
  }

  // Against the state the deterministic pass left, which is why it is re-read inside rather than
  // passed down. An AI outcome of any kind leaves the deterministic transaction exactly where it is.
  const ai = await applyAiCorrectionPass(root, options);

  const applied = [...format.applied, ...(ai.applied ?? [])];
  const omitted = [...format.omitted, ...(ai.omitted ?? [])];
  const operationCount = format.operationCount + (ai.operationCount ?? 0);
  return {
    // The action's status is the AI layer's, because that is the one that can fail in ways the
    // reporter must act on. What the deterministic layer did is reported beside it, never folded in.
    status: ai.status, format, ai, applied, omitted, operationCount,
    passId: ai.passId ?? format.passId ?? null,
    failures: ai.failures ?? [], retryable: ai.retryable ?? false,
    message: describe(format, ai),
  };
}

function describe(format, ai) {
  const parts = [];
  if (format.operationCount) parts.push(`${format.applied.length} formatting correction${format.applied.length === 1 ? "" : "s"} the record proves`);
  if (ai.status === AI_CORRECTION_STATUS.APPLIED) parts.push(`${(ai.applied ?? []).length} AI correction${(ai.applied ?? []).length === 1 ? "" : "s"}`);
  if (!parts.length) return ai.message;
  // The AI layer's own message still leads when it has something the reporter must act on -- no
  // key, a transcript that moved, a pass that could not run. A count of formatting corrections
  // must never read as though the whole correction succeeded.
  const failed = [AI_CORRECTION_STATUS.FAILED, AI_CORRECTION_STATUS.NO_CREDENTIAL, AI_CORRECTION_STATUS.TRANSCRIPT_MOVED].includes(ai.status);
  return failed
    ? `${parts.join(" and ")} applied. ${ai.message}`
    : `Correction complete — ${parts.join(" and ")} applied in one action. Review the corrected transcript.`;
}
