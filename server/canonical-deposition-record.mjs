export const CANONICAL_RECORD_VERSION="1.0.0";
export const FIELD_SOURCES=Object.freeze(["NOD_EXTRACTED","REPORTER_PROFILE","REPORTER_ENTERED","TRANSCRIPT_DERIVED","WORKFLOW_DERIVED","SYSTEM_GENERATED"]);
export const FIELD_STATES=Object.freeze(["EXTRACTED","CONFIRMED","CONFLICTING","MISSING","REPORTER_ADDED","DERIVED"]);

export function field(value=null,{source="REPORTER_ENTERED",state=value===null||value===""?"MISSING":"EXTRACTED",confidence=null,citations=[]}={}){
  if(!FIELD_SOURCES.includes(source))throw new Error(`Unsupported canonical field source: ${source}`);
  if(!FIELD_STATES.includes(state))throw new Error(`Unsupported canonical field state: ${state}`);
  return {value:value??null,source,state,confidence,citations};
}
const missing=(source="REPORTER_ENTERED")=>field(null,{source,state:"MISSING"});

/**
 * One counsel entry, carrying the provenance of whoever supplied it.
 *
 * The source is a parameter because it is a claim about a court record. Counsel read off the
 * Notice are NOD_EXTRACTED; counsel a reporter typed are REPORTER_ENTERED, and a record has to
 * be able to show which is which. Writing typed names as extracted would assert the Notice said
 * something it never said -- worse than the hand-edit an endpoint replaces, because a hand-edit
 * at least leaves a modification time.
 *
 * REPORTER_ENTERED and REPORTER_ADDED are not new vocabulary; both were already declared in
 * FIELD_SOURCES and FIELD_STATES and simply unused on counsel.
 */
export function counselEntry(attorney = {}, index = 0, { source = "NOD_EXTRACTED" } = {}) {
  const supplied = value => {
    const present = value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && !value.length);
    if (source === "NOD_EXTRACTED") return field(value ?? null, { source });
    return field(value ?? null, { source, state:present ? "REPORTER_ADDED" : "MISSING" });
  };
  const represents = Array.isArray(attorney.represents) ? attorney.represents : [attorney.represents].filter(Boolean);
  return {
    id:attorney.id || `attorney-${index + 1}`,
    fullName:supplied(attorney.name || attorney.fullName), honorific:supplied(attorney.honorific),
    barNumber:supplied(attorney.barNumber), firm:supplied(attorney.firm), address:supplied(attorney.address),
    phone:supplied(attorney.phone), fax:supplied(attorney.fax), email:supplied(attorney.email),
    represents:supplied(represents), appearanceRole:supplied(attorney.appearanceRole),
    // Appearance is the reporter's observation whatever the Notice said, so it is never extracted.
    actualAppearance:attorney.actualAppearance === undefined || attorney.actualAppearance === null
      ? missing("REPORTER_ENTERED")
      : field(attorney.actualAppearance, { source:"REPORTER_ENTERED", state:"REPORTER_ADDED" }),
    remoteAppearance:missing("REPORTER_ENTERED"),
  };
}

export const PARTY_ROLES = Object.freeze(["PLAINTIFF", "DEFENDANT", "INTERVENOR", "THIRD_PARTY", "OTHER"]);
export const PARTY_ENTITY_TYPES = Object.freeze(["PERSON", "ORGANIZATION"]);

/**
 * One party to the case.
 *
 * A party is a fact about the lawsuit. It is NOT a fact about who was in the room, and nothing
 * here may be read as one: a defendant who never appeared is still a defendant, and a party who
 * testified is a speaker because of the appearance record, never because of this list. The two are
 * kept apart deliberately -- getSpeakerCandidates does not read parties[] at all -- because
 * inferring attendance from party status is how someone who was never deposed ends up attributed
 * with testimony.
 *
 * Aliases carry their qualifier rather than being flattened, because "a/k/a" and "d/b/a" are legal
 * claims of different kinds and a caption that collapses them misstates the style of the case.
 */
export function partyEntry(party = {}, index = 0, { source = "NOD_EXTRACTED" } = {}) {
  const supplied = (value, citations = []) => {
    const present = value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && !value.length);
    if (source === "NOD_EXTRACTED") return field(value ?? null, { source, citations });
    return field(value ?? null, { source, state: present ? "REPORTER_ADDED" : "MISSING", citations });
  };
  const name = String(party.name ?? "").trim();
  const role = String(party.role ?? "").trim().toUpperCase().replaceAll(" ", "_");
  const entityType = String(party.entityType ?? "").trim().toUpperCase();
  if (role && !PARTY_ROLES.includes(role)) throw new Error(`Unsupported party role: ${party.role}`);
  if (entityType && !PARTY_ENTITY_TYPES.includes(entityType)) throw new Error(`Unsupported party entity type: ${party.entityType}`);

  return {
    id: party.id || `party-${index + 1}`,
    name: supplied(name || null, party.citations ?? []),
    // Derived from the name by a rule, so it is SYSTEM_GENERATED whatever supplied the name.
    normalizedName: name
      ? field(name.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim(), { source: "SYSTEM_GENERATED", state: "DERIVED" })
      : field(null, { source: "SYSTEM_GENERATED", state: "MISSING" }),
    role: supplied(role || null),
    entityType: supplied(entityType || null),
    aliases: (party.aliases ?? []).map(alias => ({ qualifier: supplied(alias.qualifier ?? null), name: supplied(alias.name ?? null) })),
    captionDisplayName: supplied(party.captionDisplayName || name || null),
  };
}

/**
 * Builds the canonical record, attributing every document-sourced field to whoever actually
 * supplied it.
 *
 * `noticeSupplied` is not a detail. Every field here used to be marked NOD_EXTRACTED regardless,
 * so a deposition created without a Notice still claimed one as its source -- the Etminan record
 * carries intake.notice = null and twelve populated fields asserting NOD_EXTRACTED, all of them
 * typed by a reporter. That is false provenance on a certified record, and it is worse than a
 * blank: it tells a reader the document said something no document said.
 *
 * The distinction also has to survive to be useful. Extracted-but-unconfirmed and
 * reporter-confirmed are different states, because a Notice states what was NOTICED, not what
 * occurred -- counsel noticed for videoconference may appear in person.
 */
export function createCanonicalDepositionRecord(input={},{noticeSupplied=false}={}){
  const partyValues=Array.isArray(input.parties)?input.parties:[];
  const attorneyValues=Array.isArray(input.attorneys)?input.attorneys:[];
  const reporter=input.reporterProfile||{};
  const reporterField=value=>field(value,{source:"REPORTER_PROFILE"});
  // Shadows the module-level helper for the length of this record, so every field below is
  // attributed by the same rule without each call site having to remember.
  const documentSource=noticeSupplied?"NOD_EXTRACTED":"REPORTER_ENTERED";
  const extracted=value=>field(value,{source:documentSource});
  return {
    schemaVersion:CANONICAL_RECORD_VERSION,
    recordType:"CANONICAL_DEPOSITION_DATA_RECORD",
    case:{jurisdictionType:extracted(input.jurisdictionType||input.jurisdiction),court:extracted(input.court),district:extracted(input.district),division:extracted(input.division),county:extracted(input.county),judicialDistrict:extracted(input.judicialDistrict),causeNumber:extracted(input.causeNumber),caseStyle:extracted(input.caseStyle),governingRules:extracted(input.governingRules||[])},
    parties:partyValues.map((party,index)=>typeof party==="string"?{id:`party-${index+1}`,name:extracted(party),normalizedName:missing("SYSTEM_GENERATED"),role:missing(),entityType:missing(),aliases:[],captionDisplayName:extracted(party)}:{id:party.id||`party-${index+1}`,name:extracted(party.name),normalizedName:extracted(party.normalizedName),role:extracted(party.role),entityType:extracted(party.entityType),aliases:(party.aliases||[]).map(alias=>({qualifier:extracted(alias.qualifier),name:extracted(alias.name)})),captionDisplayName:extracted(party.captionDisplayName||party.name)}),
    deposition:{witness:extracted(input.witness),representativeCapacity:extracted(input.representativeCapacity||input.deponentType),representedOrganization:extracted(input.representedOrganization),corporateTopics:extracted(input.corporateTopics||[]),proceedingType:extracted(input.proceedingType||"Oral deposition"),volumeNumber:missing("WORKFLOW_DERIVED"),depositionDate:extracted(input.depositionDate),scheduledStart:extracted(input.scheduledStart),actualStart:missing("TRANSCRIPT_DERIVED"),actualEnd:missing("TRANSCRIPT_DERIVED"),timeZone:extracted(input.timeZone),location:extracted(input.location),remote:extracted(input.remote??null),remotePlatform:extracted(input.remotePlatform),telephone:extracted(input.telephone??null),videotaped:extracted(input.videotaped??null),interpreted:extracted(input.interpreted??null),corporateRepresentative:extracted(input.corporateRepresentative??null),witnessSworn:missing("REPORTER_ENTERED"),reportingMethod:missing("REPORTER_PROFILE")},
    counsel:attorneyValues.map((attorney,index)=>counselEntry(attorney,index,{source:documentSource})),
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
