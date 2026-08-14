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
