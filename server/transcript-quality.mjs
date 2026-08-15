import crypto from "node:crypto";

function words(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9' -]/g, " ").split(/\s+/).filter(Boolean);
}

const NEGATION_TERMS = ["no", "not", "never", "cannot", "can't", "didn't", "doesn't", "don't", "won't", "wasn't", "weren't"];
const SHORT_ANSWER_TERMS = ["yes", "no", "correct", "incorrect", "I don't know", "I do not know", "I don't recall", "I do not recall"];

function occurrences(haystack, needle) {
  if (!needle.length || needle.length > haystack.length) return 0;
  let count = 0;
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    if (needle.every((word, offset) => haystack[index + offset] === word)) count += 1;
  }
  return count;
}

function phraseMetrics(reference, hypothesis, terms = []) {
  const unique = [...new Set(terms.map(term => String(term).trim()).filter(Boolean))];
  let expected = 0, matched = 0;
  const missedTerms = [];
  for (const term of unique) {
    const needle = words(term), referenceCount = occurrences(reference, needle);
    if (!referenceCount) continue;
    const hypothesisCount = occurrences(hypothesis, needle), termMatched = Math.min(referenceCount, hypothesisCount);
    expected += referenceCount;
    matched += termMatched;
    if (termMatched < referenceCount) missedTerms.push(term);
  }
  const missed = expected - matched;
  return { expected, matched, missed, errorRate: expected ? missed / expected : null, missedTerms };
}

function matches(value, pattern) { return String(value || "").match(pattern) || []; }
function automaticTermGroups(referenceText) {
  const numberWords = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million";
  const months = "January|February|March|April|May|June|July|August|September|October|November|December";
  return {
    numbers: matches(referenceText, new RegExp(`\\b(?:\\d+(?:[.,]\\d+)*|${numberWords})\\b`, "gi")),
    dates: [
      ...matches(referenceText, new RegExp(`\\b(?:${months})\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?\\b`, "gi")),
      ...matches(referenceText, /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g),
    ],
    money: matches(referenceText, /(?:\$\s?\d+(?:[.,]\d+)*|\b\d+(?:[.,]\d+)*\s+dollars?\b)/gi),
    measurements: matches(referenceText, /\b\d+(?:\.\d+)?\s*(?:mg|milligrams?|grams?|kg|kilograms?|feet|foot|inches?|miles?|mph|percent|degrees?)\b/gi),
  };
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

export function compareTranscripts(referenceText, hypothesisText, criticalTerms = [], termGroups = {}) {
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
  const automatic = automaticTermGroups(referenceText);
  const groups = {
    properNames: termGroups.properNames || [],
    keyterms: termGroups.keyterms || criticalTerms,
    medicalTerms: termGroups.medicalTerms || [],
    technicalTerms: termGroups.technicalTerms || [],
    exhibitTerms: termGroups.exhibitTerms || [],
    numbers: [...automatic.numbers, ...(termGroups.numbers || [])],
    dates: [...automatic.dates, ...(termGroups.dates || [])],
    money: [...automatic.money, ...(termGroups.money || [])],
    measurements: [...automatic.measurements, ...(termGroups.measurements || [])],
    negations: [...NEGATION_TERMS, ...(termGroups.negations || [])],
    shortAnswers: [...SHORT_ANSWER_TERMS, ...(termGroups.shortAnswers || [])],
  };
  return {
    schemaVersion: 2,
    referenceSha256: crypto.createHash("sha256").update(String(referenceText || "")).digest("hex"),
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
    depositionMetrics: Object.fromEntries(Object.entries(groups).map(([name, terms]) => [name, phraseMetrics(reference, hypothesis, terms)])),
    comparedAt: new Date().toISOString(),
  };
}
