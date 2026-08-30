import { KEYTERM_PRODUCT_CAP, KEYTERM_TOKEN_BUDGET, estimateKeytermTokens } from "./keyterm-limits.mjs";
import { normalizeCauseNumber } from "./cause-number.mjs";

export const MASTER_DATA_VERSION = "1.0.0";
export const MASTER_DATA_RECORD_TYPE = "MASTER_DEPOSITION_DATA_RECORD";

const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const text = value => typeof value === "string" && value.trim() ? value.trim() : null;
const array = value => Array.isArray(value) ? value : [];
const first = (...values) => values.map(text).find(Boolean) ?? null;

function evidence(value, { sourceType="NOD", sourceDocument=null, citation=null, confidence=null, status } = {}) {
  const supplied = value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && !value.length);
  return { value:supplied ? value : null, status:status ?? (supplied ? "EXTRACTED" : "MISSING"), sourceType:supplied ? sourceType : null, sourceDocument:supplied ? sourceDocument : null, citation:supplied ? citation : null, confidence:supplied ? confidence : null };
}

function terminology(data) {
  const byName = new Map();
  const add = (name, input={}) => {
    const canonical=text(name); if(!canonical)return;
    const key=canonical.toLocaleLowerCase("en-US"),current=byName.get(key)??{};
    // The UFM registry is the shared vocabulary inventory. `in_keyterms:false` in Claude's
    // legacy projection meant "not chosen for that separate five-term list", not "the reporter
    // forbids this term from Deepgram". Spoken registry entries therefore start eligible and the
    // reporter can opt them out in the unified data sheet.
    const eligible=input.deepgramEligible??(input.in_keyterms===true?true:undefined)??current.deepgramEligible??(input.spoken!==false);
    byName.set(key,{ canonical, category:input.category??current.category??"other", asrVariants:array(input.asr_variants??input.asrVariants??current.asrVariants), spoken:input.spoken??current.spoken??true, deepgramEligible:eligible, priority:input.tier??current.priority??6, source:input.source??current.source??null, confidence:input.confidence??current.confidence??null, reason:input.reason??current.reason??null });
  };
  for(const entry of array(data?.ufm_registry?.entries))add(entry.canonical??entry.term,entry);
  for(const entry of array(data?.deepgram_keyterms?.terms))add(entry.term,{...entry,deepgramEligible:true});
  return [...byName.values()];
}

export function masterDataFromExtraction(data={}, { sourceDocument=null }={}) {
  const setup=object(data.setup),caption=object(data.caption),logistics=object(data.logistics),confidence=text(setup.confidence);
  const parties=array(setup.parties).map((party,index)=>typeof party==="string"?{id:`party-${index+1}`,name:evidence(party,{sourceDocument,confidence}),role:evidence(null),entityType:evidence(null)}:{id:party.id??`party-${index+1}`,name:evidence(party.name,{sourceDocument,confidence}),role:evidence(party.role,{sourceDocument,confidence}),entityType:evidence(party.entityType,{sourceDocument,confidence})});
  // `side` is the reporter's answer and never the document's. Nothing in the extraction schema asks
  // a Notice which side counsel appears for, so a cell citing the Notice for it would name a
  // document that never stated it -- the same rule createCanonicalDepositionRecord applies when it
  // fixes side to REPORTER_ENTERED whatever source the rest of the row carries. It is carried here
  // because without it nothing downstream has a side at all, and the appearance page refuses:
  // build-pages throws APPEARANCE_SIDE_MISSING rather than guess what prints after FOR.
  const reporterAnswer=value=>evidence(text(value),{sourceType:"REPORTER",status:text(value)?"CONFIRMED":"MISSING"});
  const counsel=array(setup.attorneys).map((attorney,index)=>({id:attorney.id??`attorney-${index+1}`,fullName:evidence(attorney.name,{sourceDocument,confidence}),firm:evidence(attorney.firm,{sourceDocument,confidence}),address:evidence(attorney.address,{sourceDocument,confidence}),phone:evidence(attorney.phone,{sourceDocument,confidence}),email:evidence(attorney.email,{sourceDocument,confidence}),barNumber:evidence(attorney.barNumber,{sourceDocument,confidence}),represents:evidence(array(attorney.represents),{sourceDocument,confidence}),appearanceRole:evidence(attorney.appearanceRole,{sourceDocument,confidence}),side:reporterAnswer(attorney.side),sideOther:reporterAnswer(attorney.sideOther),actualAppearance:evidence(null,{sourceType:"REPORTER"})}));
  return {
    schemaVersion:MASTER_DATA_VERSION, recordType:MASTER_DATA_RECORD_TYPE, profile:"TEXAS_FREELANCE_DEPOSITION",
    case:{caseStyle:evidence(setup.caseStyle,{sourceDocument,confidence}),causeNumber:evidence(normalizeCauseNumber(setup.causeNumber),{sourceDocument,confidence}),jurisdiction:evidence(setup.jurisdiction,{sourceDocument,confidence}),court:evidence(first(setup.court,caption.court),{sourceDocument,confidence}),district:evidence(caption.district,{sourceDocument,confidence}),division:evidence(caption.division,{sourceDocument,confidence}),county:evidence(caption.county,{sourceDocument,confidence}),judicialDistrict:evidence(caption.judicial_district??caption.judicialDistrict,{sourceDocument,confidence}),appellateCauseNumber:evidence(caption.appellate_cause_number,{sourceDocument,confidence})},
    parties,
    deposition:{witness:evidence(setup.witness,{sourceDocument,confidence}),representativeCapacity:evidence(setup.deponentType,{sourceDocument,confidence}),proceedingType:evidence(logistics.proceeding_type??logistics.deposition_type,{sourceDocument,confidence}),scheduledDate:evidence(setup.depositionDate??logistics.deposition_date,{sourceDocument,confidence}),scheduledStart:evidence(logistics.start_time??logistics.scheduled_start,{sourceDocument,confidence}),timeZone:evidence(logistics.time_zone??logistics.timeZone,{sourceDocument,confidence}),location:evidence(logistics.location,{sourceDocument,confidence}),remote:evidence(logistics.remote,{sourceDocument,confidence}),remotePlatform:evidence(logistics.remote_platform??logistics.platform,{sourceDocument,confidence}),videotaped:evidence(logistics.videotaped,{sourceDocument,confidence}),interpreted:evidence(logistics.interpreted,{sourceDocument,confidence}),corporateRepresentative:evidence(logistics.corporate_representative??logistics.corporateRepresentative,{sourceDocument,confidence}),recordingMethod:evidence(null,{sourceType:"REPORTER_PROFILE"}),actualStart:evidence(null,{sourceType:"TRANSCRIPT"}),actualEnd:evidence(null,{sourceType:"TRANSCRIPT"}),volumeNumber:evidence(null,{sourceType:"WORKFLOW"})},
    counsel,
    participants:{expected:array(data.speaker_map),actual:[]},
    terminology:terminology(data),
    transcript:{examinations:[],index:[],exhibits:[],certifiedQuestions:[],requestedInformation:[]},
    signature:{status:evidence(null,{sourceType:"REPORTER"})},
    certification:{costResponsibleParty:evidence(null,{sourceType:"REPORTER"}),firmRegistrationNumber:evidence(null,{sourceType:"REPORTER_PROFILE"})},
    conflicts:array(data.collisions), anomalies:array(data.anomalies),
    provenance:{promptVersion:text(data.prompt_version)??"case_terms/v2",generatedFrom:array(data.generated_from),sourceDocument,extractionReport:object(data.extraction_report)}
  };
}

export function projectDeepgramKeyterms(masterData) {
  const candidates=array(masterData?.terminology).filter(term=>term?.deepgramEligible!==false&&text(term?.canonical)).sort((a,b)=>(a.priority??6)-(b.priority??6));
  const wire=[],seen=new Set();
  for(const item of candidates){const term=text(item.canonical),key=term.toLocaleLowerCase("en-US");if(seen.has(key))continue;const next=[...wire,term];if(next.length>KEYTERM_PRODUCT_CAP||estimateKeytermTokens(next)>KEYTERM_TOKEN_BUDGET)continue;seen.add(key);wire.push(term)}
  return {schemaVersion:"1.0.0",sourceRecordType:MASTER_DATA_RECORD_TYPE,wire,term_count:wire.length,estimated_tokens:estimateKeytermTokens(wire)};
}

const value = cell => cell?.value ?? null;
export function projectTexasFreelanceUfm(masterData) {
  const counsel=array(masterData?.counsel).filter(item=>value(item.actualAppearance)!==false).map(item=>({attorney_name:value(item.fullName),attorney_address:value(item.address),party_represented:value(item.represents)}));
  return {schemaVersion:"1.0.0",profile:"TEXAS_FREELANCE_DEPOSITION",sourceRecordType:MASTER_DATA_RECORD_TYPE,fields:{court_name_number:value(masterData?.case?.court),county:value(masterData?.case?.county),state:value(masterData?.case?.jurisdiction),case_style:value(masterData?.case?.caseStyle),cause_number:value(masterData?.case?.causeNumber),appellate_cause_number:value(masterData?.case?.appellateCauseNumber),proceeding_type:value(masterData?.deposition?.proceedingType),proceeding_time:value(masterData?.deposition?.scheduledStart),proceeding_date:value(masterData?.deposition?.scheduledDate),proceeding_location:value(masterData?.deposition?.location),volume_number:value(masterData?.deposition?.volumeNumber),recording_method:value(masterData?.deposition?.recordingMethod),witness_name:value(masterData?.deposition?.witness),attorneys:counsel,cost_responsible_party:value(masterData?.certification?.costResponsibleParty),firm_registration_number:value(masterData?.certification?.firmRegistrationNumber)}};
}

// The one place that decides which canonical keys may name the Notice as their source.
//
// It reads the cell each key came from and claims the document only where that cell still says
// EXTRACTED. A reporter who edits a field on the setup screen turns its cell into CONFIRMED, so the
// key drops out here and the record attributes the value to them -- which is the whole point of
// having a review step. Nothing else may supply `extractedFields`: two lists that can disagree is
// two answers to "what did the document say", and a certified record can only carry one.
//
// Keys are the canonical record's own field names, not the master record's, because
// createCanonicalDepositionRecord looks them up by its key. `jurisdictionType` reads
// `case.jurisdiction`; a mismatch here is silent and shows up only as a field that can never claim
// its source.
export function canonicalInputFromMaster(masterData) {
  const c=masterData?.case??{},d=masterData?.deposition??{};
  const cells={caseStyle:c.caseStyle,causeNumber:c.causeNumber,jurisdictionType:c.jurisdiction,court:c.court,district:c.district,division:c.division,county:c.county,judicialDistrict:c.judicialDistrict,witness:d.witness,representativeCapacity:d.representativeCapacity,proceedingType:d.proceedingType,depositionDate:d.scheduledDate,scheduledStart:d.scheduledStart,timeZone:d.timeZone,location:d.location,remote:d.remote,remotePlatform:d.remotePlatform,videotaped:d.videotaped,interpreted:d.interpreted,corporateRepresentative:d.corporateRepresentative};
  const extractedFields=Object.entries(cells).filter(([,item])=>item?.status==="EXTRACTED"&&value(item)!==null).map(([key])=>key);
  const parties=array(masterData?.parties).map(item=>({id:item.id,name:value(item.name),role:value(item.role),entityType:value(item.entityType)}));
  // side and sideOther pass through unstamped: counselEntry fixes them to REPORTER_ENTERED itself,
  // so they are unaffected by whether the counsel group claims the Notice, and dropping them here
  // is what left the appearance page with nothing to print after FOR.
  const attorneys=array(masterData?.counsel).map(item=>({id:item.id,name:value(item.fullName),firm:value(item.firm),address:value(item.address),phone:value(item.phone),email:value(item.email),barNumber:value(item.barNumber),represents:value(item.represents),appearanceRole:value(item.appearanceRole),side:value(item.side),sideOther:value(item.sideOther)}));
  // Party and counsel rows are stamped as a group by the record builder, so the group claims the
  // document only when at least one row in it is still an unedited extraction. Manual intake builds
  // every cell CONFIRMED, so neither list claims a Notice it was never read from.
  if(array(masterData?.parties).some(item=>item?.name?.status==="EXTRACTED"))extractedFields.push("parties");
  if(array(masterData?.counsel).some(item=>item?.fullName?.status==="EXTRACTED"))extractedFields.push("attorneys");
  return {caseStyle:value(c.caseStyle),causeNumber:value(c.causeNumber),jurisdictionType:value(c.jurisdiction),court:value(c.court),district:value(c.district),division:value(c.division),county:value(c.county),judicialDistrict:value(c.judicialDistrict),witness:value(d.witness),deponentType:value(d.representativeCapacity),proceedingType:value(d.proceedingType),depositionDate:value(d.scheduledDate),scheduledStart:value(d.scheduledStart),timeZone:value(d.timeZone),location:value(d.location),remote:value(d.remote),remotePlatform:value(d.remotePlatform),videotaped:value(d.videotaped),interpreted:value(d.interpreted),corporateRepresentative:value(d.corporateRepresentative),parties,attorneys,extractedFields};
}
