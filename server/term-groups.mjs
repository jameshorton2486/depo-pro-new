// Server-owned, versioned definitions of the term groups that gate measured ASR selection.
// The browser names a set by id; it never supplies the terms. Same contract as the RX
// profile catalog: an identifier crosses the wire, the parameters are resolved here.
//
// This matters because the groups are not decoration. chooseMeasuredAsrSource refuses a
// processed candidate that regresses any group, so a caller able to narrow the groups is a
// caller able to weaken the gate -- quietly, and in the direction of accepting worse audio.

const NEGATION_TERMS = Object.freeze(["no", "not", "never", "cannot", "can't", "didn't", "doesn't", "don't", "won't", "wasn't", "weren't"]);
const SHORT_ANSWER_TERMS = Object.freeze(["yes", "no", "correct", "incorrect", "I don't know", "I do not know", "I don't recall", "I do not recall"]);

// UFM registry categories mapped onto comparison groups. A category absent from this map is
// deliberately unscored; add it here rather than at a call site, so the mapping stays part
// of the set's version.
const UFM_CATEGORY_GROUPS = Object.freeze({
  person:"properNames", party:"properNames", organization:"properNames", firm:"properNames", place:"properNames",
  medical:"medicalTerms", pharmaceutical:"medicalTerms",
  technical:"technicalTerms", product:"technicalTerms",
  exhibit:"exhibitTerms",
});

export const TERM_GROUP_SETS = Object.freeze({
  "deposition-core-v1": Object.freeze({
    id:"deposition-core-v1", version:"1.0.0",
    description:"Deposition-critical recognition groups: negations and short answers, plus case terms drawn from the UFM registry and intake keyterms.",
    negations:NEGATION_TERMS, shortAnswers:SHORT_ANSWER_TERMS, ufmCategoryGroups:UFM_CATEGORY_GROUPS,
  }),
});

export function resolveTermGroupSet(id) {
  const set = TERM_GROUP_SETS[String(id || "")];
  if (!set) throw new Error(`Unsupported term group set: ${id}`);
  return set;
}

// Builds the group payload for compareTranscripts. `ufmEntries` and `keyterms` come from the
// deposition's own intake record, read server-side -- never from a request body.
export function buildTermGroups(setId, { ufmEntries = [], keyterms = [] } = {}) {
  const set = resolveTermGroupSet(setId);
  const groups = { properNames:[], medicalTerms:[], technicalTerms:[], exhibitTerms:[], keyterms:[], negations:[...set.negations], shortAnswers:[...set.shortAnswers] };
  for (const entry of ufmEntries) {
    const group = set.ufmCategoryGroups[String(entry?.category || "")], canonical = String(entry?.canonical || "").trim();
    if (group && canonical) groups[group].push(canonical);
  }
  for (const item of keyterms) {
    const term = String(item?.term ?? item ?? "").trim();
    if (term) groups.keyterms.push(term);
  }
  return { termGroupSetId:set.id, termGroupSetVersion:set.version, groups };
}
