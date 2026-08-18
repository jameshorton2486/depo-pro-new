import crypto from "node:crypto";
import { TERM_GROUP_SETS } from "./term-groups.mjs";

function words(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9' -]/g, " ").split(/\s+/).filter(Boolean);
}

// Sourced from the term-group catalog so the set definition has one home. These two are
// applied unconditionally: a caller can add to them but never narrow them.
const { negations: NEGATION_TERMS, shortAnswers: SHORT_ANSWER_TERMS } = TERM_GROUP_SETS["deposition-core-v1"];

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

// Measured, not chosen: a full four-hour deposition against another run of the same audio --
// 12,185 reference words against 12,174 -- compares in 1,064 ms. `distance` keeps two rows
// rather than the whole matrix, so memory is O(hypothesis) and only time is quadratic; at these
// sizes that is about 148M inner iterations. 5,000 refused a comparison the machine does in a
// second. The bound still exists because the cost is quadratic and a long enough transcript
// would eventually hurt, and it still refuses rather than truncating: a WER over the first
// 5,000 words, reported as the transcript's, would be a quality claim about text nobody read.
export const DEFAULT_MAX_COMPARISON_WORDS = 25_000;
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

// Tokenization integrity, as a qualification gate rather than a diagnostic.
//
// A word error rate cannot see this. Two runs of the same audio can score almost identically and
// differ in whether six seconds of speech arrived as one addressable unit or as six -- and every
// capability this application has downstream of the ASR depends on the second: audio seek, split
// precision, correction anchoring, and the granularity a correction pass can propose at. A
// single token spanning a caption is not a transcription error, it is a structural one, and it
// is invisible to every measure that counts words.
//
// Reports the distribution rather than judging against a threshold. Legitimate long tokens exist
// -- a hyphenated compound, a spelled-out cause number -- and a constant picked from intuition
// would either miss the real anomalies or bury them in false ones. The caller reads the shape and
// decides; percentiles are supplied so a threshold can be chosen from the population it grades.
//
// Keyterms are carried into the report because a count is not a mechanism. If the collapsed
// tokens sit next to keyterm boundaries -- a keyterm adjacent to a proper noun, two in sequence
// -- that points at which keyterms to change rather than merely at how many.
export function tokenizationIntegrity(words = [], { keyterms = [] } = {}) {
  const usable = words.filter(word => Number.isFinite(word?.start) && Number.isFinite(word?.end));
  const durations = usable.map(word => Number((word.end - word.start).toFixed(3))).sort((a, b) => a - b);
  const lengths = words.map(word => String(word?.punctuatedWord ?? word?.word ?? "").length).sort((a, b) => a - b);
  const at = (sorted, fraction) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] : null);
  const terms = keyterms.map(term => String(term).toLowerCase()).filter(Boolean);

  // A token holding more than one canonical entity is the shape that matters, and it is checkable
  // without a threshold: the keyterms are the entities this run was told to expect.
  const concatenatedEntities = words
    .map(word => {
      const text = String(word?.punctuatedWord ?? word?.word ?? "");
      const bare = text.toLowerCase().replace(/[^a-z0-9]/g, "");
      const contained = terms.filter(term => term.length > 3 && bare.includes(term.replace(/[^a-z0-9]/g, "")));
      return contained.length > 1 ? { id:word.id, text, entities:contained, seconds:Number(((word.end ?? 0) - (word.start ?? 0)).toFixed(3)) } : null;
    })
    .filter(Boolean);

  return {
    words: words.length,
    duration: { p50:at(durations, 0.5), p95:at(durations, 0.95), p99:at(durations, 0.99), max:durations.at(-1) ?? null },
    length: { p50:at(lengths, 0.5), p95:at(lengths, 0.95), p99:at(lengths, 0.99), max:lengths.at(-1) ?? null },
    longestByDuration: [...usable].sort((a, b) => (b.end - b.start) - (a.end - a.start)).slice(0, 10)
      .map(word => ({ id:word.id, text:word.punctuatedWord ?? word.word, seconds:Number((word.end - word.start).toFixed(3)) })),
    longestByLength: [...words].sort((a, b) => String(b?.punctuatedWord ?? "").length - String(a?.punctuatedWord ?? "").length).slice(0, 10)
      .map(word => ({ id:word.id, text:word.punctuatedWord ?? word.word, characters:String(word.punctuatedWord ?? word.word ?? "").length })),
    concatenatedEntities,
    keytermCount: terms.length,
  };
}

/**
 * Compares tokenization between two runs of the same audio.
 *
 * Word count alone hides this: a run can lose eleven words overall while collapsing six seconds
 * of one passage into a single token. Segmentation is compared over matching time windows so a
 * local collapse is visible against an unchanged total.
 */
export function tokenizationDelta(baseline = [], candidate = [], { windowSeconds = 30 } = {}) {
  const bucket = words => {
    const counts = new Map();
    for (const word of words) {
      if (!Number.isFinite(word?.start)) continue;
      const key = Math.floor(word.start / windowSeconds);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const before = bucket(baseline), after = bucket(candidate);
  const windows = [...new Set([...before.keys(), ...after.keys()])].sort((a, b) => a - b);
  const collapsed = windows
    .map(key => ({ fromSeconds:key * windowSeconds, baseline:before.get(key) ?? 0, candidate:after.get(key) ?? 0 }))
    .filter(row => row.baseline > 0 && row.candidate < row.baseline)
    .map(row => ({ ...row, lost:row.baseline - row.candidate }))
    .sort((a, b) => b.lost - a.lost);
  return { windowSeconds, totalBaseline:baseline.length, totalCandidate:candidate.length, collapsed:collapsed.slice(0, 10) };
}
