import { getCanonicalFinalizationStatus } from "./canonical-finalization.mjs";
import { getFinalArtifactProjection } from "./final-artifact-provenance.mjs";

export const REPORTER_FINALIZATION_PROJECTION_VERSION = "1.0.0";

/**
 * Read-only composition for the future reporter UI. All decisions are delegated to the
 * authoritative Phase C-E modules; this projection supplies labels and relationships only.
 */
export async function getReporterFinalizationProjection(root, { depositionId, storageRoot, evaluatedAt = new Date().toISOString() } = {}) {
  let canonical;
  try { canonical = await getCanonicalFinalizationStatus(root, { depositionId, storageRoot }); }
  catch (error) {
    if (/Deposition was not found/.test(String(error instanceof Error ? error.message : error))) return { schemaVersion: REPORTER_FINALIZATION_PROJECTION_VERSION, recordType: "REPORTER_FINALIZATION_PROJECTION", depositionId, evaluatedAt, state: "UNKNOWN_DEPOSITION", readiness: null, transcriptCompletion: { state: "NOT_RECORDED", eventId: null }, currentFinalVersionId: null, latestFinalVersionId: null, versions: [] };
    throw error;
  }
  const versions = await Promise.all(canonical.history.finalizations.map(async event => {
    const artifacts = await getFinalArtifactProjection(root, { depositionId, storageRoot, finalVersionId: event.finalVersionId });
    return {
      finalVersionId: event.finalVersionId,
      finalizationEventId: event.id,
      sequence: event.sequence,
      finalizedAt: event.recordedAt,
      predecessorFinalVersionId: event.predecessorFinalVersionId,
      bindingDigest: event.bindingDigest,
      relationship: canonical.currentFinalVersion?.id === event.id ? "CURRENT" : "HISTORICAL",
      artifacts,
    };
  }));
  const completion = canonical.transcriptCompletion;
  return {
    schemaVersion: REPORTER_FINALIZATION_PROJECTION_VERSION,
    recordType: "REPORTER_FINALIZATION_PROJECTION",
    depositionId,
    evaluatedAt,
    state: canonical.state,
    readiness: { ready: canonical.readiness.ready, profile: canonical.readiness.profile, evaluationDigest: canonical.readiness.evaluationDigest, blockers: canonical.readiness.blockers },
    transcriptCompletion: completion ? { state: completion.current ? "CURRENT" : "STALE", eventId: completion.event.id, recordedAt: completion.event.recordedAt } : { state: "NOT_RECORDED", eventId: null },
    currentFinalVersionId: canonical.currentFinalVersion?.finalVersionId ?? null,
    latestFinalVersionId: canonical.latestFinalVersion?.finalVersionId ?? null,
    versions,
    source: { readinessPolicyVersion: canonical.readiness.schemaVersion, readinessEvaluationDigest: canonical.readiness.evaluationDigest, transcriptModelHash: canonical.readiness.source.transcriptModelHash, reviewStateHash: canonical.readiness.source.reviewStateHash },
  };
}
