export function addCanonicalOath(record) {
  record.openingRecord ??= { schemaVersion:"1.0.0", oathAdministrations:[], interpreterAdministrations:[], stipulationEvents:[], closingAttestations:[], auditEvents:[] };
  record.openingRecord.oathAdministrations.push({ id:"fixture-oath", kind:"OATH_ADMINISTRATION", selection:"OATH", spokenText:"Do you solemnly swear that the testimony you are about to give will be the truth, the whole truth, and nothing but the truth?", response:"Yes", occurredAt:"2026-01-02T15:00:00.000Z", verificationSource:"SYSTEM_CLOCK", officer:{role:"COURT_REPORTER",name:"Fixture Reporter",credential:"CSR 1",issuingJurisdiction:"Texas",authorityBasis:"Fixture authority"}, witnessLocation:{city:"Austin",county:"Travis",state:"Texas",country:"United States"}, sourceAnchor:"fixture:opening:oath", justification:"Test fixture oath administration.", recordedAt:"2026-01-02T15:00:00.000Z", recordedBy:"Test fixture" });
  return record;
}
