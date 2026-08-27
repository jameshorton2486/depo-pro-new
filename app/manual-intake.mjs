// Creating a deposition when there is no Notice to read.
//
// Continue to Deposition Setup was disabled until Claude analysed a Notice, so with no Anthropic
// key no deposition could be created at all -- and a walk-in has no notice to analyse even when
// the key is present. The live-deposition path added in PR #52 sits behind the same gate, so a
// proceeding a reporter is about to record could not be set up from the document it does not have.
//
// This produces the SAME object the extraction path produces, so there is one submit path, one
// draft shape, one store, and one participant authority. What differs is where the values came
// from -- and that difference is carried by provenance, not by a separate record.
//
// PROVENANCE. Nothing here stamps a source. createCanonicalDepositionRecord already decides it:
// `sourceFor` returns NOD_EXTRACTED only when a notice was supplied AND the key is named in
// extractedFields, and REPORTER_ENTERED otherwise. So the correct behaviour on this path is not
// to switch a tag but to refrain from claiming a notice: no notice file, and an empty ufmData so
// extractedFieldKeys finds nothing. A manual route that fabricated either would make the
// canonical record cite a Notice as the source of words a reporter typed.

// Relative, not the "@/" alias: this module is imported by node --test as well as by the bundler,
// and the alias only resolves in the bundler. The cap stays in server/keyterm-limits.mjs -- there
// is one cap, and a manual intake is not a reason for a second.
import { KEYTERM_PRODUCT_CAP } from "../server/keyterm-limits.mjs";

const text = value => typeof value === "string" ? value.trim() : "";

// `represents` arrives as a string from ManualIntakeForm -- one text field per counsel row -- and
// as an array from the extraction path and from tests. Assuming the array shape threw
// "(attorney.represents ?? []).map is not a function" on the first real submit, because the unit
// test fed it a shape the actual caller never produces. Accepting both is what makes the module
// usable by its real caller rather than only by its test.
const asList = value => Array.isArray(value)
  ? value.map(text).filter(Boolean)
  : text(value) ? [text(value)] : [];

/**
 * The side counsel appears for. Its own fact, and not any of the three it sits near:
 *
 * - `represents` holds PARTY NAMES, and has correction-log entries against it. A side put there
 *   would change what those corrections corrected.
 * - `appearanceRole` (QUESTIONING_ATTORNEY / DEFENDING_ATTORNEY) is examination POSTURE. An
 *   attorney can defend a deposition while appearing for an intervenor. Both facts are needed and
 *   neither derives from the other. Do not merge them.
 * - PARTY_ROLES in canonical-deposition-record.mjs is the role of a PARTY, not of counsel, and is
 *   a different list for that reason. A party is a plaintiff; counsel appears for one.
 *
 * Texas practice is routinely more than two sides -- intervenors in subrogation and probate,
 * third-party defendants in construction defect, ad litem appointments for minors and missing
 * heirs, and petitioner/respondent in family, probate and appellate matters.
 */
export const COUNSEL_SIDES = Object.freeze([
  "Plaintiff", "Defendant", "Intervenor", "Third-Party Defendant", "Cross-Defendant",
  "Counter-Defendant", "Non-Party Witness", "Ad Litem", "Petitioner", "Respondent", "Other",
]);

export const MANUAL_REQUIRED_FIELDS = Object.freeze([
  { key:"caseStyle", label:"Case style", message:"Enter the case style, as it appears in the caption." },
  { key:"witness", label:"Witness", message:"Enter the name of the witness being deposed." },
  { key:"causeNumber", label:"Cause number", message:"Enter the cause number." },
  { key:"depositionDate", label:"Deposition date", message:"Enter the date this deposition is taken." },
  { key:"deponentType", label:"Deponent type", message:"Choose what kind of witness this is." },
]);

/**
 * Refuses rather than fills in. A deposition created with a blank cause number would carry that
 * blank onto a caption and a certificate, where nothing downstream can tell an unanswered field
 * from one that was answered with nothing.
 */
export function validateManualIntake(fields = {}) {
  return MANUAL_REQUIRED_FIELDS
    .filter(field => !text(fields[field.key]))
    .map(field => ({ code:`MANUAL_INTAKE_${field.key.toUpperCase()}_REQUIRED`, field:field.key, message:field.message }));
}

/**
 * Keyterms a manual intake can honestly produce: the proper names it was given.
 *
 * This is deliberately narrower than extraction. A Notice supplies medical terminology, place
 * names and case-specific jargon that no amount of reading a setup form can recover. Names are
 * what a form knows, so names are what this returns, and the reporter adds the rest in the review
 * table rather than the application inventing it.
 *
 * Order is witness, then counsel, then firms, then parties: the ordered keyterm list is
 * significant to Deepgram, and the witness is the voice most of the transcript belongs to.
 */
export function deriveManualKeyterms({ witness, attorneys = [], parties = [] } = {}) {
  const terms = [];
  const seen = new Set();
  const push = value => {
    const term = text(value);
    // A single initial or a bare honorific is noise on the wire, not a keyterm.
    if (term.length < 3) return;
    const key = term.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    terms.push(term);
  };
  push(witness);
  for (const attorney of attorneys) push(attorney?.name);
  for (const attorney of attorneys) push(attorney?.firm);
  for (const party of parties) push(typeof party === "string" ? party : party?.name);
  return terms.slice(0, KEYTERM_PRODUCT_CAP);
}

/**
 * The intake object, in the shape the extraction path produces.
 *
 * `ufmData` is empty and stays empty. extractedFieldKeys reads it to decide which keys the
 * extraction actually produced; an empty object means none, which is true and is what keeps every
 * field REPORTER_ENTERED.
 *
 * Counsel are returned as objects with stable ids, not as prose. The examiner is stored on the
 * assembly as a canonical counsel id, so counsel captured as a name would leave examiner
 * selection with nothing to reference.
 */
export function manualIntakeAnalysis(fields = {}) {
  const attorneys = (fields.attorneys ?? [])
    .filter(attorney => text(attorney?.name))
    .map((attorney, index) => ({
      id: text(attorney.id) || `attorney-${index + 1}`,
      name: text(attorney.name),
      firm: text(attorney.firm),
      represents: asList(attorney.represents),
      side: text(attorney.side),
      sideOther: text(attorney.sideOther),
    }));
  const parties = (fields.parties ?? [])
    .filter(party => text(typeof party === "string" ? party : party?.name))
    .map((party, index) => typeof party === "string"
      ? { id:`party-${index + 1}`, name:text(party) }
      : { id:text(party.id) || `party-${index + 1}`, name:text(party.name), role:text(party.role) });

  const keyterms = deriveManualKeyterms({ witness:fields.witness, attorneys, parties });
  return {
    caseStyle: text(fields.caseStyle),
    witness: text(fields.witness),
    causeNumber: text(fields.causeNumber),
    depositionDate: text(fields.depositionDate),
    deponentType: text(fields.deponentType),
    parties,
    attorneys,
    keyterms,
    deepgramArtifact: { terms:keyterms, term_count:keyterms.length, estimated_tokens:0, wire:keyterms },
    // Empty, and load-bearing: see the provenance note at the top of this file.
    ufmData: {},
    // Not a hedge about the typing. The reporter stated these facts directly, which is a stronger
    // source than an extraction -- but "confidence" here describes an extraction's self-report,
    // and there was no extraction, so the honest value is the one that claims nothing.
    confidence: "reporter-entered",
    warnings: ["Entered manually. No Notice was analysed, so keyterms cover the names supplied here and not case terminology."],
    manualEntry: true,
  };
}
