export function certificationRoute({ jurisdiction, signatureDisposition, oathAdministration, reviewElection }={}) {
  const form=oathAdministration?.selection ?? null;
  if (!jurisdiction || !form) return { key:null, available:false, reason:"CERTIFICATION_FACTS_INCOMPLETE" };
  if (jurisdiction === "texas-state") {
    if (form !== "OATH") return { key:null, available:false, reason:"TEXAS_AFFIRMATION_TEMPLATE_UNAVAILABLE" };
    if (!['requested','waived'].includes(signatureDisposition)) return { key:null, available:false, reason:"SIGNATURE_DISPOSITION_REQUIRED" };
    return { key:`TEXAS_STATE_SIGNATURE_${signatureDisposition.toUpperCase()}`, available:true, reason:null };
  }
  if (jurisdiction === "federal") {
    const review=reviewElection?.status ?? "UNRESOLVED";
    return { key:`FEDERAL_${form}_REVIEW_${review}`, available:false, reason:"FEDERAL_TEMPLATE_UNAPPROVED" };
  }
  return { key:null, available:false, reason:"CERTIFICATION_JURISDICTION_UNSUPPORTED" };
}
