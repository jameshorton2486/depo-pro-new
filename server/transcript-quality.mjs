function words(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9' -]/g, " ").split(/\s+/).filter(Boolean);
}

const DEFAULT_MAX_COMPARISON_WORDS = 5_000;
function comparisonWordLimit() {
  const value = Number(process.env.MAX_TRANSCRIPT_COMPARISON_WORDS ?? DEFAULT_MAX_COMPARISON_WORDS);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_MAX_COMPARISON_WORDS;
}

function distance(reference, hypothesis) {
  const width=hypothesis.length+1;
  let previous={cost:Int32Array.from({length:width},(_,i)=>i),s:new Int32Array(width),d:new Int32Array(width),i:Int32Array.from({length:width},(_,i)=>i)};
  let current={cost:new Int32Array(width),s:new Int32Array(width),d:new Int32Array(width),i:new Int32Array(width)};
  for(let r=1;r<=reference.length;r++){
    current.cost[0]=r;current.s[0]=0;current.d[0]=r;current.i[0]=0;
    for(let h=1;h<width;h++){
      if(reference[r-1]===hypothesis[h-1]){current.cost[h]=previous.cost[h-1];current.s[h]=previous.s[h-1];current.d[h]=previous.d[h-1];current.i[h]=previous.i[h-1];continue}
      const substitution=previous.cost[h-1]+1,deletion=previous.cost[h]+1,insertion=current.cost[h-1]+1;
      if(substitution<=deletion&&substitution<=insertion){current.cost[h]=substitution;current.s[h]=previous.s[h-1]+1;current.d[h]=previous.d[h-1];current.i[h]=previous.i[h-1]}
      else if(deletion<=insertion){current.cost[h]=deletion;current.s[h]=previous.s[h];current.d[h]=previous.d[h]+1;current.i[h]=previous.i[h]}
      else{current.cost[h]=insertion;current.s[h]=current.s[h-1];current.d[h]=current.d[h-1];current.i[h]=current.i[h-1]+1}
    }
    [previous,current]=[current,previous];
  }
  const last=hypothesis.length;return{cost:previous.cost[last],s:previous.s[last],d:previous.d[last],i:previous.i[last]};
}

export function compareTranscripts(referenceText, hypothesisText, criticalTerms = []) {
  const reference = words(referenceText);
  const hypothesis = words(hypothesisText);
  const limit=comparisonWordLimit();
  if(reference.length>limit||hypothesis.length>limit)throw new RangeError(`Transcript comparison is limited to ${limit} words per transcript. Compare smaller aligned excerpts.`);
  const result = distance(reference, hypothesis);
  const terms = [...new Set(criticalTerms.map(term => String(term).trim()).filter(Boolean))];
  const normalizedHypothesis = ` ${hypothesis.join(" ")} `;
  const critical = terms.map(term => ({ term, present: normalizedHypothesis.includes(` ${words(term).join(" ")} `) }));
  const expected = critical.filter(item => ` ${reference.join(" ")} `.includes(` ${words(item.term).join(" ")} `));
  const missed = expected.filter(item => !item.present);
  return {
    schemaVersion: 1,
    referenceWords: reference.length,
    hypothesisWords: hypothesis.length,
    substitutions: result.s,
    deletions: result.d,
    insertions: result.i,
    errors: result.cost,
    wer: reference.length ? result.cost / reference.length : null,
    criticalLegalErrorRate: expected.length ? missed.length / expected.length : null,
    criticalTermsExpected: expected.length,
    criticalTermsMissed: missed.map(item => item.term),
    comparedAt: new Date().toISOString(),
  };
}
