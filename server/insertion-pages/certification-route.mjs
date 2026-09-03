export function certificationRoute({ jurisdiction, signatureDisposition, oathAdministration, reviewElection }={}) {
  const form=oathAdministration?.selection ?? null;
  if (!jurisdiction || !form) return { key:null, available:false, reason:"CERTIFICATION_FACTS_INCOMPLETE" };
  if (jurisdiction === "texas-state") {
    if (!['requested','waived'].includes(signatureDisposition)) return { key:null, available:false, reason:"SIGNATURE_DISPOSITION_REQUIRED" };
    if (form === "AFFIRMATION") return { key:`TEXAS_STATE_AFFIRMATION_SIGNATURE_${signatureDisposition.toUpperCase()}`, available:true, reason:null };
    if (form === "OATH") return { key:`TEXAS_STATE_SIGNATURE_${signatureDisposition.toUpperCase()}`, available:true, reason:null };
    return { key:null, available:false, reason:"CERTIFICATION_FACTS_INCOMPLETE" };
  }
  if (jurisdiction === "federal") {
    const review=reviewElection?.status ?? "UNRESOLVED";
    if (!["OATH", "AFFIRMATION"].includes(form) || !["REQUESTED", "NOT_REQUESTED"].includes(review)) {
      return { key:null, available:false, reason:"CERTIFICATION_FACTS_INCOMPLETE" };
    }
    return { key:`FEDERAL_${form}_REVIEW_${review}`, available:true, reason:null };
  }
  return { key:null, available:false, reason:"CERTIFICATION_JURISDICTION_UNSUPPORTED" };
}
