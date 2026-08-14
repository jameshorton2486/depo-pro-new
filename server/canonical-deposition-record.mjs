export const CANONICAL_RECORD_VERSION="1.0.0";
export const FIELD_SOURCES=Object.freeze(["NOD_EXTRACTED","REPORTER_PROFILE","REPORTER_ENTERED","TRANSCRIPT_DERIVED","WORKFLOW_DERIVED","SYSTEM_GENERATED"]);
export const FIELD_STATES=Object.freeze(["EXTRACTED","CONFIRMED","CONFLICTING","MISSING","REPORTER_ADDED","DERIVED"]);

export function field(value=null,{source="REPORTER_ENTERED",state=value===null||value===""?"MISSING":"EXTRACTED",confidence=null,citations=[]}={}){
  if(!FIELD_SOURCES.includes(source))throw new Error(`Unsupported canonical field source: ${source}`);
  if(!FIELD_STATES.includes(state))throw new Error(`Unsupported canonical field state: ${state}`);
  return {value:value??null,source,state,confidence,citations};
}
const extracted=value=>field(value,{source:"NOD_EXTRACTED"});
const missing=(source="REPORTER_ENTERED")=>field(null,{source,state:"MISSING"});

export function createCanonicalDepositionRecord(input={}){
  const partyValues=Array.isArray(input.parties)?input.parties:[];
  const attorneyValues=Array.isArray(input.attorneys)?input.attorneys:[];
  const reporter=input.reporterProfile||{};
  const reporterField=value=>field(value,{source:"REPORTER_PROFILE"});
  return {
    schemaVersion:CANONICAL_RECORD_VERSION,
    recordType:"CANONICAL_DEPOSITION_DATA_RECORD",
    case:{jurisdictionType:extracted(input.jurisdictionType||input.jurisdiction),court:extracted(input.court),district:extracted(input.district),division:extracted(input.division),county:extracted(input.county),judicialDistrict:extracted(input.judicialDistrict),causeNumber:extracted(input.causeNumber),caseStyle:extracted(input.caseStyle),governingRules:extracted(input.governingRules||[])},
    parties:partyValues.map((party,index)=>typeof party==="string"?{id:`party-${index+1}`,name:extracted(party),normalizedName:missing("SYSTEM_GENERATED"),role:missing(),entityType:missing(),aliases:[],captionDisplayName:extracted(party)}:{id:party.id||`party-${index+1}`,name:extracted(party.name),normalizedName:extracted(party.normalizedName),role:extracted(party.role),entityType:extracted(party.entityType),aliases:(party.aliases||[]).map(alias=>({qualifier:extracted(alias.qualifier),name:extracted(alias.name)})),captionDisplayName:extracted(party.captionDisplayName||party.name)}),
    deposition:{witness:extracted(input.witness),representativeCapacity:extracted(input.representativeCapacity||input.deponentType),representedOrganization:extracted(input.representedOrganization),corporateTopics:extracted(input.corporateTopics||[]),proceedingType:extracted(input.proceedingType||"Oral deposition"),volumeNumber:missing("WORKFLOW_DERIVED"),depositionDate:extracted(input.depositionDate),scheduledStart:extracted(input.scheduledStart),actualStart:missing("TRANSCRIPT_DERIVED"),actualEnd:missing("TRANSCRIPT_DERIVED"),timeZone:extracted(input.timeZone),location:extracted(input.location),remote:extracted(input.remote??null),remotePlatform:extracted(input.remotePlatform),telephone:extracted(input.telephone??null),videotaped:extracted(input.videotaped??null),interpreted:extracted(input.interpreted??null),corporateRepresentative:extracted(input.corporateRepresentative??null),witnessSworn:missing("REPORTER_ENTERED"),reportingMethod:missing("REPORTER_PROFILE")},
    counsel:attorneyValues.map((attorney,index)=>({id:attorney.id||`attorney-${index+1}`,fullName:extracted(attorney.name||attorney.fullName),honorific:extracted(attorney.honorific),barNumber:extracted(attorney.barNumber),firm:extracted(attorney.firm),address:extracted(attorney.address),phone:extracted(attorney.phone),fax:extracted(attorney.fax),email:extracted(attorney.email),represents:extracted(Array.isArray(attorney.represents)?attorney.represents:[attorney.represents].filter(Boolean)),appearanceRole:extracted(attorney.appearanceRole),actualAppearance:missing("REPORTER_ENTERED"),remoteAppearance:missing("REPORTER_ENTERED")})),
    reporter:{profileId:reporterField(reporter.id),fullName:reporterField(reporter.name||input.courtReporterName),designations:reporterField(reporter.designations),csrNumber:reporterField(reporter.licenseNumber),csrState:reporterField(reporter.csrState),csrExpiration:reporterField(reporter.csrExpiration),notaryStatus:reporterField(reporter.notaryStatus),notaryState:reporterField(reporter.notaryState),firm:reporterField(reporter.company),firmRegistrationNumber:reporterField(reporter.firmRegistrationNumber),address:reporterField(reporter.address),phone:reporterField(reporter.phone),email:reporterField(reporter.email),officialStatus:reporterField(reporter.officialStatus)},
    participants:{otherAttendees:[],interpreters:[],videographers:[]},
    transcript:{volumes:[],pageCount:missing("TRANSCRIPT_DERIVED"),examinations:[],chronologicalEvents:[],requestedDocuments:[],certifiedQuestions:[]},
    exhibits:[],
    signature:{status:missing("REPORTER_ENTERED"),requestedDate:missing("REPORTER_ENTERED"),submittedToWitnessDate:missing("WORKFLOW_DERIVED"),returnDeadlineDays:missing("REPORTER_ENTERED"),dueDate:missing("WORKFLOW_DERIVED"),returnedDate:missing("REPORTER_ENTERED"),witnessSigned:missing("REPORTER_ENTERED"),errataReceived:missing("REPORTER_ENTERED"),errata:[]},
    certification:{variant:missing("WORKFLOW_DERIVED"),custodialAttorney:missing("REPORTER_ENTERED"),deliveryRecipient:missing("REPORTER_ENTERED"),attorneyTime:[],officerCharges:missing("REPORTER_ENTERED"),chargesResponsibleParty:missing("REPORTER_ENTERED"),serviceDate:missing("WORKFLOW_DERIVED"),serviceRecipients:[],clerkFiled:missing("REPORTER_ENTERED"),certificationDate:missing("REPORTER_ENTERED"),rule203Certified:missing("REPORTER_ENTERED"),disinterestedDeclaration:missing("REPORTER_ENTERED")},
    nonappearance:{applicable:field(false,{source:"WORKFLOW_DERIVED",state:"DERIVED"}),scheduledTime:missing("NOD_EXTRACTED"),waitedUntil:missing("REPORTER_ENTERED"),absentWitness:missing("REPORTER_ENTERED"),requestingParty:missing("REPORTER_ENTERED")},
    provenance:{createdAt:new Date().toISOString(),sources:Array.isArray(input.generated_from)?input.generated_from:[],manualReference:"Texas Court Reporters Certification Board Uniform Format Manual Examples (47 pages; figures 1-35A)"}
  };
}

export function canonicalBlockingGaps(record){
  const gaps=[];const visit=(value,path=[])=>{if(value&&typeof value==="object"&&!Array.isArray(value)){if("state" in value&&value.state==="MISSING")gaps.push(path.join("."));else for(const [key,child] of Object.entries(value))visit(child,[...path,key])}else if(Array.isArray(value))value.forEach((child,index)=>visit(child,[...path,String(index)]))};visit(record);return gaps;
}
