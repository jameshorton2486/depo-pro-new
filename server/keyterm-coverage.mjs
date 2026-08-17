// Building the Deepgram keyterm set from the people and parties this deposition actually has.
//
// Measured against the reporter-corrected Etminan transcript, keyterm presence tracks
// recognition closely: Vargas was a keyterm and came back 56 of 58; Bentley was not and came
// back 0 of 36, in 12,185 words, while the ASR heard "Dennis Valley". Twelve keyterms were sent
// and not one was an attorney -- the extraction produced party surnames and medical vocabulary,
// and the people who speak most were never named.
//
// This is an improvement, not a fix. Etminan WAS a keyterm and still came back 4 of 11.
//
// Surname-only terms cannot repair a multi-part name: the plaintiff was rendered "Rico, Laura,
// Alessandro, Vargas", so full names go in as phrases alongside their parts.
import { KEYTERM_API_LIMIT, KEYTERM_PRODUCT_CAP, KEYTERM_TOKEN_BUDGET, estimateKeytermTokens } from "./keyterm-limits.mjs";

const text = value => String(value ?? "").trim();
const fold = value => text(value).toLocaleLowerCase("en-US");
// Particles that are part of a surname rather than a separate name, and suffixes that are not
// names at all. Splitting on whitespace alone turns "de la Cruz" into three useless terms.
const PARTICLES = new Set(["de","del","de la","la","van","von","der","den","bin","ibn","al","st","st.","mc","mac","da","dos","das","di","du"]);
const SUFFIXES = new Set(["jr","jr.","sr","sr.","ii","iii","iv","v","md","m.d.","phd","ph.d.","esq","esq.","llc","llp","inc","inc.","pllc","co","co.","ltd","ltd."]);
const HONORIFICS = new Set(["mr","mr.","ms","ms.","mrs","mrs.","dr","dr.","miss","prof","prof."]);
// Ordinary English words that appear inside organisation names. Submitted alone they spend a
// slot and boost a common word, which can pull recognition toward it elsewhere in six hours of
// testimony. Applied only to single tokens: the phrase "Standing Seam Specialty Company" is
// still submitted whole, because that sequence is distinctive even though its parts are not.
// This is a heuristic, and the term review table is where a reporter overrides it.
const GENERIC_ORG_WORDS = new Set(["law","legal","company","companies","specialty","standing","seam","group","associates","partners","firm","offices","office","services","solutions","center","centre","clinic","hospital","medical","holdings","enterprises","industries","systems","international","national","american","corporation"]);

/** Splits a personal name into the parts worth submitting: the full phrase, plus each name token. */
export function nameTerms(value) {
  const cleaned = text(value).replace(/,/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const tokens = cleaned.split(" ").filter(token => {
    const key = fold(token);
    return key && !HONORIFICS.has(key) && !SUFFIXES.has(key.replace(/[^a-z.]/g, ""));
  });
  if (!tokens.length) return [];
  // A middle initial is written but not spoken. "Dennis J. Bentley" as a phrase can never match
  // what the microphone heard, so the phrase is built from the tokens a person actually says.
  // Particles stay in it -- "Maria de la Cruz" is spoken whole -- but are not submitted alone.
  const spoken = tokens.filter(token => token.replace(/[^A-Za-z]/g, "").length > 1);
  if (!spoken.length) return [];
  const phrase = spoken.join(" ");
  const parts = spoken.filter(token => !PARTICLES.has(fold(token)) && !GENERIC_ORG_WORDS.has(fold(token).replace(/[^a-z]/g, "")));
  return [...new Set([phrase, ...parts])].filter(Boolean);
}

const value = field => (field && typeof field === "object" && "value" in field ? field.value : field);

/**
 * Collects candidate keyterms from the canonical record, each carrying where it came from.
 *
 * Provenance travels with the term because the source documents disagree with themselves: this
 * Notice writes "STANDING SEAM & SPECIALTY COMPANY, INC." in the caption and "Standing Steam"
 * in the certificate of service. A reporter cannot judge a term without seeing which field it
 * came from.
 */
export function collectKeytermCandidates({ canonical = {}, extracted = [] } = {}) {
  const candidates = [];
  const add = (term, source, detail) => { const cleaned = text(term); if (cleaned) candidates.push({ term:cleaned, source, detail }); };

  for (const party of canonical.parties || []) {
    const name = value(party?.name) ?? value(party?.captionDisplayName);
    for (const term of nameTerms(name)) add(term, "party", text(name));
  }
  for (const attorney of canonical.counsel || []) {
    const name = value(attorney?.fullName);
    for (const term of nameTerms(name)) add(term, "counsel", text(name));
    const firm = value(attorney?.firm);
    for (const term of nameTerms(firm)) add(term, "firm", text(firm));
  }
  const witness = value(canonical.deposition?.witness);
  for (const term of nameTerms(witness)) add(term, "witness", text(witness));
  const reporter = value(canonical.reporter?.fullName);
  for (const term of nameTerms(reporter)) add(term, "reporter", text(reporter));
  for (const term of extracted) add(term, "extraction", "Claude document analysis");
  return candidates;
}

/**
 * Orders, deduplicates and caps the candidate set.
 *
 * Order is by source priority, not by score: the people who speak are the people whose names
 * must survive the cap. Truncation is never silent -- everything dropped is returned, because a
 * set that quietly loses the examining attorney is the defect this exists to prevent.
 */
const PRIORITY = ["witness", "counsel", "party", "reporter", "firm", "extraction"];

export function buildKeytermSet({ canonical = {}, extracted = [], cap = KEYTERM_PRODUCT_CAP } = {}) {
  const candidates = collectKeytermCandidates({ canonical, extracted });
  const byFold = new Map();
  for (const candidate of candidates) {
    const key = fold(candidate.term);
    const existing = byFold.get(key);
    if (!existing) { byFold.set(key, { ...candidate, sources:[candidate.source], details:[candidate.detail] }); continue; }
    if (!existing.sources.includes(candidate.source)) existing.sources.push(candidate.source);
    if (candidate.detail && !existing.details.includes(candidate.detail)) existing.details.push(candidate.detail);
    if (PRIORITY.indexOf(candidate.source) < PRIORITY.indexOf(existing.source)) existing.source = candidate.source;
  }
  const ordered = [...byFold.values()].sort((a, b) => PRIORITY.indexOf(a.source) - PRIORITY.indexOf(b.source));
  const kept = ordered.slice(0, cap), dropped = ordered.slice(cap);
  const wire = kept.map(item => item.term);
  const estimatedTokens = estimateKeytermTokens(wire);

  const problems = [];
  if (wire.length > KEYTERM_API_LIMIT) problems.push({ code:"API_LIMIT", message:`${wire.length} keyterms exceeds Deepgram's ${KEYTERM_API_LIMIT}-term API limit.` });
  if (dropped.length) problems.push({ code:"CAP_EXCEEDED", dropped:dropped.map(item => item.term), message:`${candidates.length ? ordered.length : 0} candidate terms exceed the ${cap}-term cap; ${dropped.length} were not submitted. Review and remove terms rather than accepting the truncation.` });
  if (estimatedTokens > KEYTERM_TOKEN_BUDGET) problems.push({ code:"TOKEN_BUDGET", message:`The set is estimated at ${estimatedTokens} tokens, over the ${KEYTERM_TOKEN_BUDGET}-token submission budget.` });

  return { wire, estimatedTokens, cap, terms:kept, dropped, problems };
}
