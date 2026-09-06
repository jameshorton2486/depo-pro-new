/** Presentation only: these controls mirror exact server-owned projection states. */
export function workflowControls(projection) {
  return {
    showCompletion: ["NOT_RECORDED", "STALE"].includes(projection?.transcriptCompletion?.state),
    showCreateFinal: projection?.state === "FINALIZATION_READY",
  };
}

export function versionControls(version) {
  return {
    showGenerate: version?.artifacts?.generationEligibility === "PERMITTED",
    showDownloads: version?.artifacts?.verified === true,
    historicalGenerationProhibited: version?.artifacts?.generationEligibility === "PROHIBITED_HISTORICAL_REGENERATION",
    integrityFailure: version?.artifacts?.status === "ARTIFACT_INTEGRITY_FAILURE",
  };
}
