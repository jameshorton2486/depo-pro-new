function normalize(value) { return String(value || "").toLowerCase(); }
function coverage(transcript, terms) {
  const normalizedTranscript=normalize(transcript);
  return terms.length ? terms.filter(term => normalizedTranscript.includes(normalize(term))).length / terms.length : 1;
}
export function chooseAsrSource(original, processed, criticalTerms = []) {
  const originalCoverage = coverage(original.transcript, criticalTerms), processedCoverage = coverage(processed.transcript, criticalTerms);
  const originalWords = original.words?.length || 0, processedWords = processed.words?.length || 0;
  const confidenceGain = (processed.confidence || 0) - (original.confidence || 0);
  const passed = confidenceGain >= .02 && processedCoverage >= originalCoverage && (originalWords === 0 ? processedWords > 0 : processedWords >= originalWords * .94);
  return {
    winner: passed ? "processed" : "original",
    reason: passed ? "Candidate won the conservative ASR estimate: confidence improved without reducing critical-term coverage or meaningful word coverage." : "Candidate did not establish a conservative ASR advantage; the original remains selected.",
    metrics: { original:{confidence:original.confidence,criticalTermCoverage:originalCoverage,words:originalWords}, processed:{confidence:processed.confidence,criticalTermCoverage:processedCoverage,words:processedWords}, thresholds:{minimumConfidenceGain:.02,minimumWordRetention:.94} },
  };
}

function categoryRegressions(original, processed) {
  const names = new Set([...Object.keys(original.depositionMetrics || {}), ...Object.keys(processed.depositionMetrics || {})]);
  return [...names].filter(name => {
    const before = original.depositionMetrics?.[name], after = processed.depositionMetrics?.[name];
    return (before?.expected || 0) > 0 && (after?.missed || 0) > (before?.missed || 0);
  });
}

export function chooseMeasuredAsrSource(original, processed, { minimumAbsoluteWerGain = .005, maximumDeletionIncrease = 0 } = {}) {
  if (!original || !processed || original.referenceSha256 !== processed.referenceSha256) throw new Error("Measured ASR candidates must use the same human reference transcript.");
  if (!Number.isFinite(original.wer) || !Number.isFinite(processed.wer)) throw new Error("Measured ASR selection requires WER for both candidates.");
  const werGain = original.wer - processed.wer;
  const regressions = categoryRegressions(original, processed);
  const criticalTermRegression = (processed.criticalTermsMissed?.length || 0) > (original.criticalTermsMissed?.length || 0);
  const deletionIncrease = processed.deletions - original.deletions;
  const passed = werGain >= minimumAbsoluteWerGain && deletionIncrease <= maximumDeletionIncrease && !criticalTermRegression && regressions.length === 0;
  const blockers = [];
  if (werGain < minimumAbsoluteWerGain) blockers.push("WER improvement was below the required margin");
  if (deletionIncrease > maximumDeletionIncrease) blockers.push("deletions increased");
  if (criticalTermRegression) blockers.push("critical-term recognition regressed");
  if (regressions.length) blockers.push(`deposition-critical categories regressed: ${regressions.join(", ")}`);
  return {
    status: "complete", method: "human-reference-deposition-metrics-v1", measuredWer: true,
    winner: passed ? "processed" : "original",
    reason: passed ? "The processed candidate reduced measured WER without increasing deletions or regressing any deposition-critical category." : `The original remains selected: ${blockers.join("; ")}.`,
    candidateSet: ["original", "processed"],
    metrics: { original, processed, delta:{werGain,deletionIncrease}, thresholds:{minimumAbsoluteWerGain,maximumDeletionIncrease}, categoryRegressions:regressions },
  };
}
