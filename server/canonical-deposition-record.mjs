import { COUNSEL_SIDES } from "../app/manual-intake.mjs";

export const CANONICAL_RECORD_VERSION="1.0.0";
export const FIELD_SOURCES=Object.freeze(["NOD_EXTRACTED","REPORTER_PROFILE","REPORTER_ENTERED","TRANSCRIPT_DERIVED","WORKFLOW_DERIVED","SYSTEM_GENERATED"]);
export const FIELD_STATES=Object.freeze(["EXTRACTED","CONFIRMED","CONFLICTING","MISSING","REPORTER_ADDED","DERIVED"]);

// Presence is declared by the caller, never inferred from the value.
//
// This read `state = value===null||value==="" ? "MISSING" : "EXTRACTED"`, which asked the value
// whether it had been supplied. A boolean false, an empty array and a zero all answered yes, so a
// checkbox nobody ticked was recorded as a finding of the source document: `remote: false,
// state: EXTRACTED, source: NOD_EXTRACTED` on a record whose Notice said the deposition WAS remote.
// Measured on one real record, 25 of 51 Notice-attributed fields named the Notice for something it
// never supplied.
//
// There is no default. Every default here is a guess about provenance, and the previous guess was
// wrong about half the time, so a caller that has not decided must say so rather than be answered
// for. `supplied:false` also drops the value: nothing was supplied, so there is nothing to carry,
// whatever shape the caller happened to pass.
export function field(value=null,{source="REPORTER_ENTERED",state,supplied,confidence=null,citations=[]}={}){
  if(!FIELD_SOURCES.includes(source))throw new Error(`Unsupported canonical field source: ${source}`);
  if(state===undefined&&supplied===undefined)throw new Error("A canonical field must declare state or supplied; presence cannot be inferred from the value.");
  const resolved=state??(supplied?"EXTRACTED":"MISSING");
  if(!FIELD_STATES.includes(resolved))throw new Error(`Unsupported canonical field state: ${resolved}`);
  return {value:supplied===false?null:(value??null),source,state:resolved,confidence,citations};
}

// A form cannot tell "left empty" from "answered as empty", so an absent key, null and an empty
// string all count as unsupplied. That is the conservative direction: an unanswered field reads as
// MISSING and can raise a finding, rather than as an answer nobody gave. A boolean that genuinely
// arrives is supplied, including false -- what must not happen is a false manufactured from absence.
export const isSupplied=value=>value!==undefined&&value!==null&&value!=="";
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
function sideField(value) {
  if (value === undefined || value === null || value === "") return missing("REPORTER_ENTERED");
  if (!COUNSEL_SIDES.includes(value)) {
    throw new Error(`Counsel side ${JSON.stringify(value)} is not one of: ${COUNSEL_SIDES.join(", ")}.`);
  }
  return field(value, { source:"REPORTER_ENTERED", state:"REPORTER_ADDED" });
}

export function counselEntry(attorney = {}, index = 0, { source = "NOD_EXTRACTED" } = {}) {
  const supplied = value => {
    const present = value !== null && value !== undefined && value !== "" && !(Array.isArray(value) && !value.length);
    if (source === "NOD_EXTRACTED") return field(value ?? null, { source, supplied: isSupplied(value) });
    return field(value ?? null, { source, state:present ? "REPORTER_ADDED" : "MISSING" });
  };
  const represents = Array.isArray(attorney.represents) ? attorney.represents : [attorney.represents].filter(Boolean);
  return {
    id:attorney.id || `attorney-${index + 1}`,
    fullName:supplied(attorney.name || attorney.fullName), honorific:supplied(attorney.honorific),
    barNumber:supplied(attorney.barNumber), firm:supplied(attorney.firm), address:supplied(attorney.address),
    phone:supplied(attorney.phone), fax:supplied(attorney.fax), email:supplied(attorney.email),
    represents:supplied(represents), appearanceRole:supplied(attorney.appearanceRole),
    // The side counsel appears for. Always the reporter's answer: nothing in the extraction schema
    // asks a Notice for it, so a NOD_EXTRACTED source here would cite a document that never stated
    // it -- the same reason actualAppearance below is fixed to REPORTER_ENTERED.
    //
    // Refused, never coerced and never defaulted. A side outside the list would print under FOR on
    // a certified appearance page, and 'Other' is a real answer a reporter can choose rather than
    // something this decides on their behalf.
    side:sideField(attorney.side),
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
    if (source === "NOD_EXTRACTED") return field(value ?? null, { source, citations, supplied: isSupplied(value) });
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
      ? field(name.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim(), { supplied: true, source: "SYSTEM_GENERATED", state: "DERIVED" })
      : field(null, { supplied: true, source: "SYSTEM_GENERATED", state: "MISSING" }),
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
  const reporterField=value=>field(value,{source:"REPORTER_PROFILE",supplied:isSupplied(value)});
  // Provenance is per field, not per record.
  //
  // This was one flag stamped on every field: a Notice was filed, therefore all 51 of these claimed
  // the Notice as their source -- including a date the reporter typed, a time zone hardcoded in the
  // UI, and a deponent type that was nothing but the first option in a select. `extractedFields`
  // names the keys the extraction actually produced; everything else is attributed to whoever did
  // supply it, which for a setup form is the reporter.
  const fromExtraction=new Set(Array.isArray(input.extractedFields)?input.extractedFields:[]);
  const sourceFor=key=>noticeSupplied&&fromExtraction.has(key)?"NOD_EXTRACTED":"REPORTER_ENTERED";
  const extracted=(key,value)=>field(value,{source:sourceFor(key),supplied:isSupplied(value)});
  return {
    schemaVersion:CANONICAL_RECORD_VERSION,
    recordType:"CANONICAL_DEPOSITION_DATA_RECORD",
    case:{jurisdictionType:extracted("jurisdictionType",input.jurisdictionType??input.jurisdiction),court:extracted("court",input.court),district:extracted("district",input.district),division:extracted("division",input.division),county:extracted("county",input.county),judicialDistrict:extracted("judicialDistrict",input.judicialDistrict),causeNumber:extracted("causeNumber",input.causeNumber),caseStyle:extracted("caseStyle",input.caseStyle),governingRules:extracted("governingRules",input.governingRules)},
    parties:partyValues.map((party,index)=>typeof party==="string"?{id:`party-${index+1}`,name:extracted("parties",party),normalizedName:missing("SYSTEM_GENERATED"),role:missing(),entityType:missing(),aliases:[],captionDisplayName:extracted("parties",party)}:{id:party.id||`party-${index+1}`,name:extracted("parties",party.name),normalizedName:extracted("parties",party.normalizedName),role:extracted("parties",party.role),entityType:extracted("parties",party.entityType),aliases:(party.aliases||[]).map(alias=>({qualifier:extracted("parties",alias.qualifier),name:extracted("parties",alias.name)})),captionDisplayName:extracted("parties",party.captionDisplayName??party.name)}),
    deposition:{witness:extracted("witness",input.witness),representativeCapacity:extracted("representativeCapacity",input.representativeCapacity??input.deponentType),representedOrganization:extracted("representedOrganization",input.representedOrganization),corporateTopics:extracted("corporateTopics",input.corporateTopics),proceedingType:extracted("proceedingType",input.proceedingType),volumeNumber:missing("WORKFLOW_DERIVED"),depositionDate:extracted("depositionDate",input.depositionDate),scheduledStart:extracted("scheduledStart",input.scheduledStart),actualStart:missing("TRANSCRIPT_DERIVED"),actualEnd:missing("TRANSCRIPT_DERIVED"),timeZone:extracted("timeZone",input.timeZone),location:extracted("location",input.location),remote:extracted("remote",input.remote),remotePlatform:extracted("remotePlatform",input.remotePlatform),telephone:extracted("telephone",input.telephone),videotaped:extracted("videotaped",input.videotaped),interpreted:extracted("interpreted",input.interpreted),corporateRepresentative:extracted("corporateRepresentative",input.corporateRepresentative),witnessSworn:missing("REPORTER_ENTERED"),reportingMethod:missing("REPORTER_PROFILE")},
    counsel:attorneyValues.map((attorney,index)=>counselEntry(attorney,index,{source:sourceFor("attorneys")})),
    reporter:{profileId:reporterField(reporter.id),fullName:reporterField(reporter.name||input.courtReporterName),designations:reporterField(reporter.designations),csrNumber:reporterField(reporter.licenseNumber),csrState:reporterField(reporter.csrState),csrExpiration:reporterField(reporter.csrExpiration),notaryStatus:reporterField(reporter.notaryStatus),notaryState:reporterField(reporter.notaryState),firm:reporterField(reporter.company),firmRegistrationNumber:reporterField(reporter.firmRegistrationNumber),firmRegistrationWaiver:reporterField(reporter.firmRegistrationWaiver),address:reporterField(reporter.address),phone:reporterField(reporter.phone),email:reporterField(reporter.email),officialStatus:reporterField(reporter.officialStatus)},
    participants:{otherAttendees:[],interpreters:[],videographers:[]},
    transcript:{volumes:[],pageCount:missing("TRANSCRIPT_DERIVED"),examinations:[],chronologicalEvents:[],requestedDocuments:[],certifiedQuestions:[]},
    exhibits:[],
    signature:{status:missing("REPORTER_ENTERED"),requestedDate:missing("REPORTER_ENTERED"),submittedToWitnessDate:missing("WORKFLOW_DERIVED"),returnDeadlineDays:missing("REPORTER_ENTERED"),dueDate:missing("WORKFLOW_DERIVED"),returnedDate:missing("REPORTER_ENTERED"),witnessSigned:missing("REPORTER_ENTERED"),errataReceived:missing("REPORTER_ENTERED"),errata:[]},
    // certificationDate and furtherCertificationDate are two dates, not one printed twice. The
    // certificate says so itself: certification-2 closes "Further certification requirements
    // pursuant to Rule 203 of TRCP will be certified to after they have occurred", then opens a
    // FURTHER CERTIFICATION UNDER RULE 203 TRCP section that certification-3 finishes with its own
    // signature block. The first signs transcript accuracy, disinterest and the appearance recital;
    // the second signs the Rule 203.3 facts -- return, delivery to the custodial attorney, charges,
    // service and filing -- which by that sentence postdate it. Collapsing them would print the
    // preparation date against acts that had not happened yet.
    certification:{variant:missing("WORKFLOW_DERIVED"),custodialAttorney:missing("REPORTER_ENTERED"),deliveryRecipient:missing("REPORTER_ENTERED"),attorneyTime:[],officerCharges:missing("REPORTER_ENTERED"),chargesResponsibleParty:missing("REPORTER_ENTERED"),serviceDate:missing("WORKFLOW_DERIVED"),serviceRecipients:[],clerkFiled:missing("REPORTER_ENTERED"),certificationDate:missing("REPORTER_ENTERED"),furtherCertificationDate:missing("REPORTER_ENTERED"),rule203Certified:missing("REPORTER_ENTERED"),disinterestedDeclaration:missing("REPORTER_ENTERED")},
    nonappearance:{applicable:field(false,{source:"WORKFLOW_DERIVED",state:"DERIVED"}),scheduledTime:missing("NOD_EXTRACTED"),waitedUntil:missing("REPORTER_ENTERED"),absentWitness:missing("REPORTER_ENTERED"),requestingParty:missing("REPORTER_ENTERED")},
    provenance:{createdAt:new Date().toISOString(),sources:Array.isArray(input.generated_from)?input.generated_from:[],manualReference:"Texas Court Reporters Certification Board Uniform Format Manual Examples (47 pages; figures 1-35A)"}
  };
}

export function canonicalBlockingGaps(record){
  const gaps=[];const visit=(value,path=[])=>{if(value&&typeof value==="object"&&!Array.isArray(value)){if("state" in value&&value.state==="MISSING")gaps.push(path.join("."));else for(const [key,child] of Object.entries(value))visit(child,[...path,key])}else if(Array.isArray(value))value.forEach((child,index)=>visit(child,[...path,String(index)]))};visit(record);return gaps;
}
