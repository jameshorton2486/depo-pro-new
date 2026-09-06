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
import { currentUtterances } from "./correction-chunker.mjs";
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
 * The corrected word, carrying the punctuation the word it replaces already had.
 *
 * FOUND IN THE REAL-CLAUDE QUALIFICATION. The entity pass may only propose values that appear in
 * the deposition's authoritative name list, and that list holds bare names. So "Oconco." became
 * "Okonkwo" and the sentence lost its full stop; "Kilbright," became "Kilbride" and the clause lost
 * its comma. One word in, one word out -- and the punctuation of a court record quietly deleted,
 * on every corrected name that carried any.
 *
 * Nothing is invented here. The surrounding characters come from the ASR evidence for that exact
 * word; only the name between them is the model's. If the proposal itself carries punctuation, it
 * is left alone and this does nothing.
 */
export function preservePunctuation(original, proposed) {
  if (typeof original !== "string" || !original || typeof proposed !== "string" || !proposed) return proposed;
  if (/[^\p{L}\p{N}'-]/u.test(proposed)) return proposed;
  const match = original.match(/^([^\p{L}\p{N}]*)[\s\S]*?([^\p{L}\p{N}]*)$/u);
  const [, prefix = "", suffix = ""] = match ?? [];
  return `${prefix}${proposed}${suffix}`;
}

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
export function planAiCorrectionBatch({ segments = [], names = [], ranges = [], speakerFor = () => null, textFor = () => null } = {}) {
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
    const was = textFor(wordId);
    operations.push({ op: "replace", wordId, text: preservePunctuation(was, proposal.proposedValue) });
    // What it replaced. The entity pass's schema has no originalValue field, so without resolving
    // the word's current text here the audit trail would record what every correction became and
    // not one thing it changed -- which is half of what makes it an audit trail.
    applied.push({ kind: "name", wordId, before: proposal.originalValue ?? was ?? null,
      after: preservePunctuation(was, proposal.proposedValue),
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
export function correctionPassRecord({ passId, model, promptVersion, startedAt, reviewStateHash, resultingReviewStateHash, applied, omitted, operations }) {
  return {
    schemaVersion: "1.0.0",
    recordType: "AI_CORRECTION_PASS",
    passId, model: model ?? null, promptVersion: promptVersion ?? null,
    appliedAt: new Date().toISOString(), startedAt: startedAt ?? null,
    // The state the operations were planned against. Anyone reconstructing this pass needs to know
    // which transcript it transformed, not merely that it happened.
    reviewStateHash: reviewStateHash ?? null,
    // And the state it produced. Without this, clicking Correct Transcript a second time on a
    // transcript the AI has just corrected looks like a new state and buys a second analysis --
    // the guard would only ever catch a double-click that changed nothing.
    resultingReviewStateHash: resultingReviewStateHash ?? null,
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
  // AI records only. The control is labelled "Undo AI Correction Pass" and a deterministic format
  // record standing at the head of the list would make it offer to undo something it does not name.
  const pass = passes.filter(isAiPass)[0] ?? null;
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

/**
 * Whether a pass record describes an AI pass.
 *
 * Records written before the deterministic pass existed carry no `recordType`, and they are AI
 * passes -- there was nothing else. Reading absence as "AI" keeps those records working; reading it
 * as "not AI" would silently un-undo every pass already on disk.
 */
const isAiPass = record => String(record?.recordType ?? "AI_CORRECTION_PASS") === "AI_CORRECTION_PASS";

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
  getWorkingTranscript, readReporterOverlay, getSpeakerCandidates, appendReporterOperations, readAsrEvidence = () => [],
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
  // Two states count as already corrected: the one a pass analysed, and the one it left behind.
  // The second is the case that actually happens -- the reporter looks at the corrected transcript
  // and presses the button again.
  //
  // Restricted to AI records. The deterministic format pass writes into the same directory, and it
  // runs FIRST in the one-click workflow -- so its `resultingReviewStateHash` is precisely the state
  // this pass is about to analyse. Counting it here made one click run the deterministic pass and
  // then tell the reporter their transcript was already corrected, with no AI pass having run at all.
  if (!force && listPasses(root, store).filter(isAiPass).some(pass =>
    pass?.reviewStateHash === before || pass?.resultingReviewStateHash === before)) {
    return { status: AI_CORRECTION_STATUS.ALREADY_CORRECTED, applied: [], omitted: [], operationCount: 0, retryable: false,
      message: "This transcript has already been corrected in its current state. Nothing was changed." };
  }

  const options = { depositionId, storageRoot, apiKey, model, passStartedAt, limitChunks: null, additionalInstructions: "" };
  const [names, ranges] = await Promise.allSettled([entityPass(root, options), speakerRangePass(root, options)]);

  // A pass that returns is not the same as a pass that ran. Each pass catches its own chunk errors
  // and still resolves, so a wholly failed analysis -- an unusable model, a revoked key, Anthropic
  // down -- arrives here as a clean result with an empty accepted list. Measured during the
  // synthetic qualification: a bad model name produced two HTTP 404s and the reporter was told
  // "The AI found nothing it could correct", which is a false statement about their transcript.
  //
  // So the test is per pass: every chunk failed and nothing was accepted means that pass failed.
  const ran = outcome => {
    if (outcome.status === "rejected") return false;
    const value = outcome.value ?? {};
    const failed = (value.failures ?? []).length;
    return !(failed > 0 && failed >= (value.chunksSubmitted ?? failed) && !(value.accepted ?? []).length);
  };
  const failures = [];
  for (const [label, outcome] of [["names", names], ["speaker-ranges", ranges]]) {
    if (outcome.status === "rejected") {
      failures.push(`${label}: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`);
    } else if (!ran(outcome)) {
      for (const failure of outcome.value?.failures ?? []) failures.push(`${label}: ${failure.message ?? failure.code ?? "chunk failed"}`);
    }
  }
  if (!ran(names) && !ran(ranges)) {
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
  // The words as they read right now -- the same view the passes were given. This is what lets the
  // audit trail say what each correction REPLACED, not merely what it became.
  const currentText = new Map();
  try {
    for (const utterance of currentUtterances({ transcript, evidence: readAsrEvidence(root, store), overlay })) {
      for (const word of utterance.words ?? []) currentText.set(word.id, word.text);
    }
  } catch { /* the before-text is a courtesy to the reader; its absence must not stop a correction */ }
  const batch = planAiCorrectionBatch({
    segments: projection.segments,
    names: ran(names) ? (names.value?.accepted ?? []) : [],
    ranges: ran(ranges) ? (ranges.value?.accepted ?? []) : [],
    speakerFor: id => candidates.find(person => person.id === id) ?? null,
    textFor: id => currentText.get(id) ?? null,
  });

  if (!batch.operations.length) {
    return { status: AI_CORRECTION_STATUS.NOTHING_TO_APPLY, applied: [], omitted: batch.omitted, operationCount: 0, failures, retryable: false,
      message: "The AI found nothing it could correct with sufficient evidence. The transcript is unchanged." };
  }

  // ONE transaction, guarded by the state it was planned against. Undo pops a whole transaction, so
  // this is what makes the pass reversible as a unit; the guard is what makes it refuse rather than
  // rebase if the reporter edited something while it was thinking.
  const written = appendReporterOperations(root, { ...store, operations: batch.operations, expectedReviewStateHash: before });

  // What LANDED, not what was planned. The overlay validates and normalises every operation on the
  // way in, so the planned objects and the stored ones are not identical -- and the undo control,
  // which proves the pass is still the last transaction by comparing them, never offered itself.
  // Found in the real-Claude qualification: four operations applied, "Undo AI Correction Pass"
  // absent, because it was comparing a plan against a record of that plan being carried out.
  const landedOps = (() => {
    const sizes = written?.transactionSizes ?? [];
    const size = sizes.length ? sizes[sizes.length - 1] : 0;
    const operations = written?.operations ?? [];
    return size ? operations.slice(operations.length - size) : batch.operations;
  })();

  const record = correctionPassRecord({
    passId: `ai-correction-${passStartedAt}`, model, promptVersion: null, startedAt: passStartedAt,
    reviewStateHash: before,
    resultingReviewStateHash: computeReviewStateHash({
      transcript: getWorkingTranscript(root, store), overlay: readReporterOverlay(root, store),
    }),
    applied: batch.applied, omitted: batch.omitted, operations: landedOps,
  });
  writePassRecord(root, { ...store, record });

  return { status: AI_CORRECTION_STATUS.APPLIED, applied: batch.applied, omitted: batch.omitted,
    operationCount: batch.operations.length, passId: record.passId, failures, retryable: false,
    message: `AI correction complete — ${batch.applied.length} correction${batch.applied.length === 1 ? "" : "s"} applied in one pass. Review the corrected transcript.` };
}
