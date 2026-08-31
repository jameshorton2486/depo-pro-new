// Applying reporter corrections to the extracted term lists, before Deepgram sees them.
//
// Scope: this changes transcription *inputs*. Correcting "Klaryx" here means Deepgram is told
// the right spelling and returns the right word in the first place. It is not a find-and-
// replace over an existing transcript -- that is transcript text, governed by the unratified
// ADR-0017 correction seam, and a global replace would break token-to-Deepgram-word anchoring.
//
// Pure on purpose: no fs, no fetch, no React. The browser imports it to preview a save and the
// test suite imports it to check the transform, so both are looking at the same function
// rather than at two implementations that agree until they don't.
import { KEYTERM_API_LIMIT, KEYTERM_PRODUCT_CAP, KEYTERM_TOKEN_BUDGET, estimateKeytermTokens } from "./keyterm-limits.mjs";
import { projectDeepgramKeyterms } from "./master-deposition-data.mjs";

const text = value => String(value ?? "").trim();
const foldCase = value => text(value).toLocaleLowerCase("en-US");

/**
 * Builds the review rows from a stored intake. Flagged rows sort first, because a flag is the
 * only reason the reporter is on this screen; everything else keeps extraction order so the
 * list does not reshuffle under them as they type.
 */
export function buildTermRows(intake) {
  const flags = new Map();
  for (const value of intake?.ufmData?.extraction_report?.low_confidence_spellings || []) {
    const entry = typeof value === "string" ? { term:value, note:"Low-confidence spelling" } : value;
    const key = foldCase(entry?.term);
    if (key) flags.set(key, text(entry?.note) || text(entry?.reason) || "Low-confidence spelling");
  }
  const rows = [];
  const seen = new Set();
  const push = (term, source) => {
    const value = text(term);
    if (!value) return;
    const key = `${source}:${foldCase(value)}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ term:value, source, flag:flags.get(foldCase(value)) || null, correction:"" });
  };
  if(intake?.masterData?.recordType==="MASTER_DEPOSITION_DATA_RECORD"){
    for(const entry of intake.masterData.terminology||[])push(entry?.canonical,entry?.deepgramEligible===false?"ufm":"keyterm");
    return rows.sort((a, b) => Number(Boolean(b.flag)) - Number(Boolean(a.flag)));
  }
  const wire = Array.isArray(intake?.deepgramArtifact?.wire) ? intake.deepgramArtifact.wire : intake?.keyterms;
  for (const term of Array.isArray(wire) ? wire : []) push(term, "keyterm");
  for (const entry of intake?.ufmData?.ufm_registry?.entries || intake?.ufmData?.entries || []) push(entry?.term ?? entry?.surface ?? entry, "ufm");
  return rows.sort((a, b) => Number(Boolean(b.flag)) - Number(Boolean(a.flag)));
}

/**
 * Validates a set of corrections and, if it holds, returns the intake to write.
 *
 * Returns `{ ok:false, problems:[...] }` rather than throwing, because every problem it can
 * find is one the reporter must see in the table before saving. authoritativeKeyterms throws
 * on all three of these at transcription time, which is far too late to be useful.
 */
export function applyTermCorrections(intake, rows) {
  const problems = [];
  const corrections = [];
  for (const row of rows || []) {
    const original = text(row?.term);
    const corrected = text(row?.correction);
    // An empty or whitespace-only correction is the default and means "the extraction was
    // right". It must cost the reporter nothing, so it is not an error and not a change.
    if (!original || !corrected || corrected === original) continue;
    corrections.push({ source:row.source === "ufm" ? "ufm" : "keyterm", original, corrected });
  }

  const wire = [];
  const byFold = new Map();
  const masterMode=intake?.masterData?.recordType==="MASTER_DEPOSITION_DATA_RECORD";
  const source = masterMode ? projectDeepgramKeyterms(intake.masterData).wire : (Array.isArray(intake?.deepgramArtifact?.wire) ? intake.deepgramArtifact.wire : intake?.keyterms);
  const correctionFor = new Map(corrections.filter(item => item.source === "keyterm").map(item => [foldCase(item.original), item.corrected]));
  for (const value of Array.isArray(source) ? source : []) {
    const original = text(value);
    if (!original) continue;
    const resolved = correctionFor.get(foldCase(original)) ?? original;
    const key = foldCase(resolved);
    // Deduplicating here would be the quiet failure: the reporter corrects two terms into the
    // same spelling, the list silently shortens, and the term they thought they fixed is gone.
    // authoritativeKeyterms throws on a duplicate anyway, so surfacing it is the only option
    // that does not either lose a term or fail at transcription time.
    if (byFold.has(key)) problems.push({ code:"DUPLICATE_TERM", term:resolved, message:`"${resolved}" collides with "${byFold.get(key)}". Two terms cannot differ only by capitalization.` });
    else { byFold.set(key, resolved); wire.push(resolved); }
  }

  const estimatedTokens = estimateKeytermTokens(wire);
  if (wire.length > KEYTERM_API_LIMIT) problems.push({ code:"API_LIMIT", message:`${wire.length} keyterms exceeds Deepgram's ${KEYTERM_API_LIMIT}-term API limit.` });
  else if (wire.length > KEYTERM_PRODUCT_CAP) problems.push({ code:"PRODUCT_CAP", message:`${wire.length} keyterms exceeds Depo-Pro's ${KEYTERM_PRODUCT_CAP}-term cap. Remove terms or record an override reason before transcribing.` });
  if (estimatedTokens > KEYTERM_TOKEN_BUDGET) problems.push({ code:"TOKEN_BUDGET", message:`The corrected set is estimated at ${estimatedTokens} tokens, over the ${KEYTERM_TOKEN_BUDGET}-token submission budget.` });
  if (problems.length) return { ok:false, problems, wire, estimatedTokens, corrections };

  const ufmCorrection = new Map(corrections.filter(item => item.source === "ufm").map(item => [foldCase(item.original), item.corrected]));
  const entries = (intake?.ufmData?.ufm_registry?.entries || []).map(entry => {
    const corrected = ufmCorrection.get(foldCase(entry?.term));
    return corrected ? { ...entry, term:corrected, extractedTerm:entry.extractedTerm ?? entry.term } : entry;
  });

  // wire, terms, and the top-level keyterms array must move together. authoritativeKeyterms
  // reads deepgramArtifact.wire and falls back to keyterms, so a divergence between them is
  // not cosmetic -- it decides which spelling Deepgram is actually sent.
  const terms = (intake?.deepgramArtifact?.terms || []).map(item => {
    const corrected = correctionFor.get(foldCase(item?.term));
    return corrected ? { ...item, term:corrected, extractedTerm:item.extractedTerm ?? item.term } : item;
  });

  if(masterMode){
    const allCorrections=new Map(corrections.map(item=>[foldCase(item.original),item.corrected]));
    const terminology=(intake.masterData.terminology||[]).map(entry=>{const corrected=allCorrections.get(foldCase(entry?.canonical));return corrected?{...entry,canonical:corrected,extractedTerm:entry.extractedTerm??entry.canonical}:entry});
    const next={...intake,masterData:{...intake.masterData,terminology}};
    const projection=projectDeepgramKeyterms(next.masterData);
    if(corrections.length)next.reporterTermCorrections=[...(intake?.reporterTermCorrections||[]),...corrections];
    return {ok:true,problems:[],wire:projection.wire,estimatedTokens:projection.estimated_tokens,corrections,intake:next};
  }
  const next = {
    ...intake,
    keyterms:wire,
    deepgramArtifact:{ ...(intake?.deepgramArtifact || {}), wire, terms, term_count:wire.length, estimated_tokens:estimatedTokens },
    ufmData:{ ...(intake?.ufmData || {}), ufm_registry:{ ...(intake?.ufmData?.ufm_registry || {}), entries, entry_count:entries.length } },
  };
  // The extraction's own output is preserved beside the corrections rather than overwritten.
  // What Claude produced and what the reporter changed are separate facts, and the record has
  // to be able to show both.
  if (corrections.length) next.reporterTermCorrections = [...(intake?.reporterTermCorrections || []), ...corrections];
  return { ok:true, problems:[], wire, estimatedTokens, corrections, intake:next };
}
